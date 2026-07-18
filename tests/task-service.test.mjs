import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { createStateStore } from "../src/state-store.mjs";
import { createTaskService } from "../src/task-service.mjs";

const fakeKimi = fileURLToPath(new URL("./fixtures/fake-kimi.mjs", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function createRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "kimi-partner-service-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "tests@example.com"]);
  git(root, ["config", "user.name", "Kimi Partner Tests"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "card.css"), ".card { color: black; }\n");
  await writeFile(path.join(root, "notes.md"), "notes\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  return root;
}

function serviceHarness({ stateRoot, ids = ["task-1", "task-2", "task-3"] } = {}) {
  const launched = [];
  const killed = [];
  let index = 0;
  const processAlive = (pid) => Number.isInteger(pid) && pid >= 9000;
  const service = createTaskService({
    stateRoot,
    idFactory: () => ids[index++],
    processAlive,
    resolveExecutable: async () => fakeKimi,
    resolveModelAlias: async () => "kimi-code/k3",
    launchWorker: async ({ taskId }) => {
      const pid = 9000 + launched.length;
      launched.push({ taskId, pid });
      return pid;
    },
    getProcessCommand: async (pid) => `/usr/bin/node /plugin/dist/mcp-server.mjs --worker ${launched.find((entry) => entry.pid === pid)?.taskId} --state-root ${stateRoot}`,
    killProcessGroup: async (pid, signal) => killed.push({ pid, signal }),
    workerEntrypoint: "/plugin/dist/mcp-server.mjs",
  });
  return { service, launched, killed, processAlive };
}

test("start validates, records a baseline, locks the project, and returns quickly", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-service-state-"));
  const repo = await createRepo();
  const { service, launched } = serviceHarness({ stateRoot });
  const startedAt = Date.now();

  const result = await service.start({
    project_path: repo,
    task: "Improve the card",
    acceptance_criteria: ["Keep the text"],
    allowed_paths: ["src"],
  });

  assert.ok(Date.now() - startedAt < 1000);
  assert.equal(result.taskId, "task-1");
  assert.equal(result.status, "queued");
  assert.equal(result.modelAlias, "kimi-code/k3");
  assert.equal(result.maxRuntimeMinutes, 30);
  assert.deepEqual(result.allowedPaths, ["src"]);
  assert.deepEqual(result.preexistingDirtyFiles, []);
  assert.deepEqual(launched, [{ taskId: "task-1", pid: 9000 }]);

  const stored = await createStateStore({ stateRoot }).readTask("task-1");
  assert.equal(stored.workerPid, 9000);
  assert.equal(stored.kimiExecutable, fakeKimi);
  assert.equal(stored.modelAlias, "kimi-code/k3");
  assert.equal(stored.maxRuntimeMs, 30 * 60 * 1000);
  assert.equal(stored.attempts.length, 1);
});

test("start refuses an overlapping dirty path unless explicitly acknowledged", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-dirty-state-"));
  const repo = await createRepo();
  await writeFile(path.join(repo, "src", "card.css"), ".card { color: user-change; }\n");
  const { service, launched } = serviceHarness({ stateRoot });

  await assert.rejects(
    service.start({ project_path: repo, task: "x", allowed_paths: ["src"] }),
    /dirty|overlap|card\.css/i,
  );
  assert.equal(launched.length, 0);

  const accepted = await service.start({
    project_path: repo,
    task: "x",
    allowed_paths: ["src"],
    allow_dirty_overlap: true,
  });
  assert.deepEqual(accepted.dirtyOverlapFiles, ["src/card.css"]);
});

test("start refuses a second active writer for the same Git root", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-duplicate-state-"));
  const repo = await createRepo();
  const { service } = serviceHarness({ stateRoot });

  await service.start({ project_path: repo, task: "first", allowed_paths: ["src"] });
  await assert.rejects(
    service.start({ project_path: repo, task: "second", allowed_paths: ["src"] }),
    /task-1|active/i,
  );
});

test("get waits for a state change and reports missing tasks safely", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-get-state-"));
  const repo = await createRepo();
  const { service } = serviceHarness({ stateRoot });
  await service.start({ project_path: repo, task: "x", allowed_paths: ["src"] });
  const store = createStateStore({ stateRoot });

  setTimeout(() => {
    void store.updateTask("task-1", (task) => ({
      ...task,
      status: "running",
      phase: "running",
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    }));
  }, 50);
  const result = await service.get({ task_id: "task-1", wait_ms: 1000 });
  assert.equal(result.status, "running");
  await assert.rejects(service.get({ task_id: "missing" }), /not found/i);
});

test("continue requires a terminal task and captured session, then appends an attempt", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-cont-service-"));
  const repo = await createRepo();
  const { service, launched } = serviceHarness({ stateRoot });
  await service.start({ project_path: repo, task: "x", allowed_paths: ["src"] });
  const store = createStateStore({ stateRoot });
  const completed = await store.updateTask("task-1", (task) => ({
    ...task,
    status: "completed",
    phase: "completed",
  }));
  await store.releaseProjectLock(completed.gitRoot, "task-1");

  await assert.rejects(
    service.continue({ task_id: "task-1", feedback: "Add focus" }),
    /session/i,
  );
  await store.updateTask("task-1", (task) => ({ ...task, sessionId: "session-1" }));
  const result = await service.continue({
    task_id: "task-1",
    feedback: "Add a visible focus ring",
    acceptance_criteria: ["Keyboard focus is visible"],
  });

  assert.equal(result.status, "continuing");
  assert.equal(result.attempts.at(-1).number, 2);
  assert.equal(result.attempts.at(-1).kind, "continuation");
  assert.deepEqual(result.acceptanceCriteria, ["Keyboard focus is visible"]);
  assert.deepEqual(launched.at(-1), { taskId: "task-1", pid: 9001 });
});

test("cancel verifies process identity and refuses terminal tasks", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-cancel-state-"));
  const repo = await createRepo();
  const { service, killed } = serviceHarness({ stateRoot });
  await service.start({ project_path: repo, task: "x", allowed_paths: ["src"] });

  const cancelling = await service.cancel({ task_id: "task-1" });
  assert.equal(cancelling.status, "cancelling");
  assert.deepEqual(killed, [{ pid: 9000, signal: "SIGTERM" }]);

  const store = createStateStore({ stateRoot });
  await store.updateTask("task-1", (task) => ({ ...task, status: "completed", phase: "completed" }));
  await assert.rejects(service.cancel({ task_id: "task-1" }), /cannot cancel|completed/i);
});
