import { execFile as execFileCallback, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

import { captureBaseline, findDirtyOverlaps } from "./git-baseline.mjs";
import { resolveDefaultModelAlias, resolveKimiExecutable } from "./kimi-runner.mjs";
import { createStateStore } from "./state-store.mjs";
import { validateStartInput } from "./validation.mjs";

const execFile = promisify(execFileCallback);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CANCELLABLE_STATUSES = new Set(["queued", "preflight", "running", "continuing", "cancelling"]);
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function nowIso() {
  return new Date().toISOString();
}

function defaultIdFactory() {
  return `kp-${randomUUID()}`;
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function defaultLaunchWorker({ taskId, stateRoot, workerEntrypoint }) {
  const child = spawn(
    process.execPath,
    [workerEntrypoint, "--worker", taskId, "--state-root", stateRoot],
    {
      detached: true,
      stdio: "ignore",
      shell: false,
      env: process.env,
    },
  );
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return child.pid;
}

async function defaultGetProcessCommand(pid) {
  const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function defaultKillProcessGroup(pid, signal) {
  process.kill(-pid, signal);
}

function requireTaskId(value) {
  if (typeof value !== "string" || !TASK_ID_RE.test(value)) {
    throw new Error("task_id must be a valid task ID");
  }
  return value;
}

function requireFeedback(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("feedback must be a non-empty string");
  }
  return value.trim();
}

function normalizeAcceptance(value, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim())) {
    throw new Error("acceptance_criteria must be an array of non-empty strings");
  }
  return value.map((entry) => entry.trim());
}

function normalizeGetWait(value) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 30_000) {
    throw new Error("wait_ms must be an integer between 0 and 30000");
  }
  return value;
}

function normalizeLongWait(value) {
  if (value === undefined) return 300_000;
  if (!Number.isInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error("wait_ms must be an integer between 1000 and 300000");
  }
  return value;
}

function presentTask(task, { compactActive = false } = {}) {
  const isTerminal = TERMINAL_STATUSES.has(task.status);
  if (compactActive && !isTerminal) {
    return {
      taskId: task.id,
      status: task.status,
      phase: task.phase,
      detail: "active",
      isTerminal: false,
      updatedAt: task.updatedAt,
      suggestedPollMs: 60_000,
    };
  }
  return {
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    gitRoot: task.gitRoot,
    allowedPaths: task.allowedPaths,
    contextFiles: task.contextFiles,
    acceptanceCriteria: task.acceptanceCriteria,
    preexistingDirtyFiles: task.baseline?.dirtyFiles ?? [],
    dirtyOverlapFiles: task.dirtyOverlapFiles ?? [],
    workerPid: task.workerPid ?? null,
    sessionId: task.sessionId ?? null,
    modelAlias: task.modelAlias ?? null,
    maxRuntimeMinutes: task.maxRuntimeMs ? task.maxRuntimeMs / 60_000 : null,
    allowDependencyInstall: task.allowDependencyInstall ?? false,
    summary: task.summary ?? null,
    error: task.error ?? null,
    exitCode: task.exitCode ?? null,
    processSignal: task.processSignal ?? null,
    malformedEventCount: task.malformedEventCount ?? 0,
    changeReceipt: task.changeReceipt ?? null,
    attempts: task.attempts ?? [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
    detail: isTerminal ? "terminal" : "full",
    isTerminal,
    suggestedPollMs: isTerminal ? 0 : 60_000,
  };
}

export function createTaskService({
  stateRoot,
  idFactory = defaultIdFactory,
  processAlive = defaultProcessAlive,
  resolveExecutable = (options) => resolveKimiExecutable(options),
  resolveModelAlias = (options) => resolveDefaultModelAlias(options),
  launchWorker = defaultLaunchWorker,
  getProcessCommand = defaultGetProcessCommand,
  killProcessGroup = defaultKillProcessGroup,
  workerEntrypoint = process.argv[1],
  waitPollIntervalMs = 1_000,
  sleep = delay,
  now = Date.now,
} = {}) {
  const store = createStateStore({ stateRoot, processAlive });

  async function launchPersistedTask(taskId, gitRoot) {
    let workerPid;
    try {
      workerPid = await launchWorker({
        taskId,
        stateRoot: store.stateRoot,
        workerEntrypoint,
      });
      if (!Number.isInteger(workerPid) || workerPid <= 0) {
        throw new Error("worker launch did not return a valid process ID");
      }
      const updated = await store.updateTask(taskId, (current) => ({
        ...current,
        workerPid,
        updatedAt: nowIso(),
      }));
      await store.updateProjectLock(gitRoot, taskId, { workerPid }).catch(() => {});
      return updated;
    } catch (error) {
      await store.updateTask(taskId, (current) => ({
        ...current,
        status: "failed",
        phase: "failed",
        error: `Unable to launch Kimi worker: ${error.message}`,
        completedAt: nowIso(),
        updatedAt: nowIso(),
      })).catch(() => {});
      await store.releaseProjectLock(gitRoot, taskId).catch(() => {});
      throw error;
    }
  }

  async function start(input) {
    const validated = await validateStartInput(input);
    const baseline = await captureBaseline(validated.gitRoot);
    const dirtyOverlapFiles = findDirtyOverlaps(baseline, validated.allowedPaths);
    if (dirtyOverlapFiles.length && !validated.allowDirtyOverlap) {
      const error = new Error(`allowed paths overlap existing dirty files: ${dirtyOverlapFiles.join(", ")}`);
      error.code = "DIRTY_OVERLAP";
      error.dirtyOverlapFiles = dirtyOverlapFiles;
      throw error;
    }
    const kimiExecutable = await resolveExecutable({});
    const modelAlias = await resolveModelAlias({});
    const taskId = idFactory();
    requireTaskId(taskId);
    const createdAt = nowIso();

    await store.acquireProjectLock(validated.gitRoot, { taskId, ownerPid: process.pid });
    try {
      await store.createTask({
        id: taskId,
        status: "queued",
        phase: "queued",
        gitRoot: validated.gitRoot,
        task: validated.task,
        acceptanceCriteria: validated.acceptanceCriteria,
        allowedPaths: validated.allowedPaths,
        contextFiles: validated.contextFiles,
        allowDirtyOverlap: validated.allowDirtyOverlap,
        allowDependencyInstall: validated.allowDependencyInstall,
        maxRuntimeMs: validated.maxRuntimeMs,
        dirtyOverlapFiles,
        baseline,
        kimiExecutable,
        modelAlias,
        workerPid: null,
        attempts: [{
          number: 1,
          kind: "initial",
          status: "queued",
          createdAt,
        }],
        createdAt,
        updatedAt: createdAt,
      });
    } catch (error) {
      await store.releaseProjectLock(validated.gitRoot, taskId).catch(() => {});
      throw error;
    }
    return presentTask(await launchPersistedTask(taskId, validated.gitRoot));
  }

  async function readWithWait(taskId, waitMs, { terminalOnly = false } = {}) {
    let task = await store.readTask(taskId);
    if (!waitMs || TERMINAL_STATUSES.has(task.status)) return task;

    const initialUpdatedAt = task.updatedAt;
    const deadline = now() + waitMs;
    while (now() < deadline) {
      await sleep(Math.min(waitPollIntervalMs, Math.max(1, deadline - now())));
      task = await store.readTask(taskId);
      if (TERMINAL_STATUSES.has(task.status)) break;
      if (!terminalOnly && task.updatedAt !== initialUpdatedAt) break;
    }
    return task;
  }

  async function get(input) {
    const taskId = requireTaskId(input?.task_id);
    const waitMs = normalizeGetWait(input?.wait_ms);
    return presentTask(await readWithWait(taskId, waitMs), { compactActive: true });
  }

  async function wait(input) {
    const taskId = requireTaskId(input?.task_id);
    const waitMs = normalizeLongWait(input?.wait_ms);
    return presentTask(await readWithWait(taskId, waitMs, { terminalOnly: true }), { compactActive: true });
  }

  async function continueTask(input) {
    const taskId = requireTaskId(input?.task_id);
    const feedback = requireFeedback(input?.feedback);
    let task = await store.readTask(taskId);
    if (!TERMINAL_STATUSES.has(task.status)) {
      throw new Error(`task cannot continue while status is ${task.status}`);
    }
    if (!task.sessionId) {
      throw new Error("task has no captured Kimi session ID and cannot be continued safely");
    }
    const acceptanceCriteria = normalizeAcceptance(input?.acceptance_criteria, task.acceptanceCriteria);
    const attemptNumber = (task.attempts.at(-1)?.number ?? 0) + 1;
    const createdAt = nowIso();

    await store.acquireProjectLock(task.gitRoot, { taskId, ownerPid: process.pid });
    try {
      task = await store.updateTask(taskId, (current) => ({
        ...current,
        status: "continuing",
        phase: "continuing",
        error: null,
        completedAt: null,
        acceptanceCriteria,
        workerPid: null,
        updatedAt: createdAt,
        attempts: [...current.attempts, {
          number: attemptNumber,
          kind: "continuation",
          feedback,
          status: "queued",
          createdAt,
        }],
      }));
    } catch (error) {
      await store.releaseProjectLock(task.gitRoot, taskId).catch(() => {});
      throw error;
    }
    return presentTask(await launchPersistedTask(taskId, task.gitRoot));
  }

  async function cancel(input) {
    const taskId = requireTaskId(input?.task_id);
    let task = await store.readTask(taskId);
    if (!CANCELLABLE_STATUSES.has(task.status) || TERMINAL_STATUSES.has(task.status)) {
      throw new Error(`cannot cancel task with status ${task.status}`);
    }
    if (!Number.isInteger(task.workerPid) || task.workerPid <= 0) {
      throw new Error("task has no active worker process to cancel");
    }

    const command = await getProcessCommand(task.workerPid);
    const expectedEntrypoint = path.basename(workerEntrypoint);
    if (!command.includes("--worker") || !command.includes(taskId) || !command.includes(expectedEntrypoint)) {
      throw new Error("refusing to cancel because the stored process identity does not match this task");
    }

    const requestedAt = nowIso();
    task = await store.updateTask(taskId, (current) => ({
      ...current,
      status: "cancelling",
      phase: "cancelling",
      cancellationRequestedAt: requestedAt,
      updatedAt: requestedAt,
    }));
    await killProcessGroup(task.workerPid, "SIGTERM");
    return presentTask(task);
  }

  return {
    store,
    start,
    get,
    wait,
    continue: continueTask,
    cancel,
  };
}
