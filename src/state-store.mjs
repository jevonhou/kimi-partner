import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_STATE_ROOT = path.join(homedir(), ".codex", "kimi-partner");
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) {
    throw new Error("invalid task ID");
  }
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

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is a best-effort portability safeguard.
  } finally {
    await handle?.close();
  }
}

async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, filePath);
  await syncDirectory(directory);
}

async function readJson(filePath, notFoundMessage) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(notFoundMessage);
    if (error instanceof SyntaxError) throw new Error(`invalid JSON state at ${filePath}`);
    throw error;
  }
}

function lockNameForRoot(gitRoot) {
  return createHash("sha256").update(gitRoot).digest("hex");
}

export function createStateStore({
  stateRoot = DEFAULT_STATE_ROOT,
  processAlive = defaultProcessAlive,
} = {}) {
  const tasksRoot = path.join(stateRoot, "tasks");
  const locksRoot = path.join(stateRoot, "locks");

  const taskDirectory = (taskId) => {
    assertTaskId(taskId);
    return path.join(tasksRoot, taskId);
  };
  const statePath = (taskId) => path.join(taskDirectory(taskId), "state.json");
  const lockPath = (gitRoot) => path.join(locksRoot, `${lockNameForRoot(gitRoot)}.json`);

  async function createTask(task) {
    assertTaskId(task?.id);
    const directory = taskDirectory(task.id);
    await mkdir(tasksRoot, { recursive: true, mode: 0o700 });
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`task already exists: ${task.id}`);
      throw error;
    }
    await atomicWriteJson(statePath(task.id), task);
    return task;
  }

  async function readTask(taskId) {
    assertTaskId(taskId);
    return readJson(statePath(taskId), `task not found: ${taskId}`);
  }

  async function updateTask(taskId, updater) {
    const current = await readTask(taskId);
    const next = await updater(current);
    if (!next || next.id !== taskId) throw new Error("task update must preserve task ID");
    await atomicWriteJson(statePath(taskId), next);
    return next;
  }

  async function writeExclusiveJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function acquireProjectLock(gitRoot, lock) {
    const filePath = lockPath(gitRoot);
    const payload = {
      ...lock,
      gitRoot,
      ownerPid: lock.ownerPid ?? process.pid,
      createdAt: lock.createdAt ?? new Date().toISOString(),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeExclusiveJson(filePath, payload);
        return payload;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readJson(filePath, "project lock disappeared");
        const activePid = existing.workerPid ?? existing.ownerPid;
        if (processAlive(activePid)) {
          const activeError = new Error(`project already has an active task: ${existing.taskId}`);
          activeError.code = "ACTIVE_PROJECT_TASK";
          activeError.activeTaskId = existing.taskId;
          throw activeError;
        }
        await unlink(filePath).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
      }
    }
    throw new Error("unable to acquire project lock");
  }

  async function updateProjectLock(gitRoot, taskId, updates) {
    const filePath = lockPath(gitRoot);
    const existing = await readJson(filePath, "project lock not found");
    if (existing.taskId !== taskId) throw new Error("project lock belongs to another task");
    const next = { ...existing, ...updates, taskId, gitRoot };
    await atomicWriteJson(filePath, next);
    return next;
  }

  async function releaseProjectLock(gitRoot, taskId) {
    const filePath = lockPath(gitRoot);
    let existing;
    try {
      existing = await readJson(filePath, "project lock not found");
    } catch (error) {
      if (/not found/.test(error.message)) return false;
      throw error;
    }
    if (existing.taskId !== taskId) return false;
    await unlink(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return true;
  }

  async function removeTaskForTests(taskId) {
    await rm(taskDirectory(taskId), { recursive: true, force: true });
  }

  return {
    stateRoot,
    taskDirectory,
    statePath,
    createTask,
    readTask,
    updateTask,
    acquireProjectLock,
    updateProjectLock,
    releaseProjectLock,
    removeTaskForTests,
  };
}
