import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { validateStartInput } from "../src/validation.mjs";
import {
  captureBaseline,
  compareBaseline,
  findDirtyOverlaps,
} from "../src/git-baseline.mjs";
import { createStateStore } from "../src/state-store.mjs";

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function createRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "kimi-partner-core-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "tests@example.com"]);
  git(root, ["config", "user.name", "Kimi Partner Tests"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "card.css"), ".card { color: black; }\n");
  await writeFile(path.join(root, "notes.md"), "original notes\n");
  await writeFile(path.join(root, "package.json"), '{"private":true}\n');
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  return root;
}

test("validation accepts a Git subdirectory and normalizes scoped paths", async () => {
  const root = await createRepo();
  const result = await validateStartInput({
    project_path: path.join(root, "src"),
    task: "  Improve the card  ",
    acceptance_criteria: ["  Keep the text  "],
    allowed_paths: ["src/./card.css"],
    context_files: ["package.json"],
  });

  assert.equal(result.gitRoot, await realpath(root));
  assert.equal(result.task, "Improve the card");
  assert.deepEqual(result.acceptanceCriteria, ["Keep the text"]);
  assert.deepEqual(result.allowedPaths, ["src/card.css"]);
  assert.deepEqual(result.contextFiles, ["package.json"]);
  assert.equal(result.allowDirtyOverlap, false);
  assert.equal(result.allowDependencyInstall, false);
  assert.equal(result.maxRuntimeMs, 30 * 60 * 1000);
});

test("validation accepts bounded runtime and explicit dependency-install permission", async () => {
  const root = await createRepo();
  const result = await validateStartInput({
    project_path: root,
    task: "x",
    allowed_paths: ["src"],
    max_runtime_minutes: 45,
    allow_dependency_install: true,
  });
  assert.equal(result.maxRuntimeMs, 45 * 60 * 1000);
  assert.equal(result.allowDependencyInstall, true);

  await assert.rejects(
    validateStartInput({ project_path: root, task: "x", allowed_paths: ["src"], max_runtime_minutes: 0 }),
    /max_runtime_minutes/i,
  );
});

test("validation rejects empty scopes, traversal, absolute paths, and symlink escape", async () => {
  const root = await createRepo();
  const outside = await mkdtemp(path.join(tmpdir(), "kimi-partner-outside-"));
  await symlink(outside, path.join(root, "outside-link"));

  await assert.rejects(
    validateStartInput({ project_path: root, task: "x", allowed_paths: [] }),
    /allowed_paths/i,
  );
  await assert.rejects(
    validateStartInput({ project_path: root, task: "x", allowed_paths: ["../escape"] }),
    /outside|relative/i,
  );
  await assert.rejects(
    validateStartInput({ project_path: root, task: "x", allowed_paths: [path.join(root, "src")] }),
    /relative/i,
  );
  await assert.rejects(
    validateStartInput({ project_path: root, task: "x", allowed_paths: ["outside-link/file.css"] }),
    /outside/i,
  );
});

test("baseline distinguishes Kimi changes from unchanged pre-existing work", async () => {
  const root = await createRepo();
  await writeFile(path.join(root, "notes.md"), "user work in progress\n");
  const before = await captureBaseline(root);

  await writeFile(path.join(root, "src", "card.css"), ".card { color: rebeccapurple; }\n");
  await writeFile(path.join(root, "package.json"), '{"private":true,"scripts":{}}\n');
  const receipt = await compareBaseline(before, root, ["src"]);

  assert.deepEqual(receipt.changedFiles, ["package.json", "src/card.css"]);
  assert.deepEqual(receipt.unchangedPreexistingFiles, ["notes.md"]);
  assert.deepEqual(receipt.preexistingFilesChangedAgain, []);
  assert.deepEqual(receipt.outOfScopeFiles, ["package.json"]);
  assert.deepEqual(receipt.finalDirtyFiles, ["notes.md", "package.json", "src/card.css"]);
});

test("baseline reports edits to an already dirty allowed file and file lifecycle changes", async () => {
  const root = await createRepo();
  await writeFile(path.join(root, "src", "card.css"), ".card { color: blue; }\n");
  const before = await captureBaseline(root);

  await writeFile(path.join(root, "src", "card.css"), ".card { color: green; }\n");
  await writeFile(path.join(root, "src", "new.css"), ".new {}\n");
  git(root, ["mv", "notes.md", "notes-renamed.md"]);
  const receipt = await compareBaseline(before, root, ["src", "notes.md", "notes-renamed.md"]);

  assert.deepEqual(receipt.preexistingFilesChangedAgain, ["src/card.css"]);
  assert.deepEqual(
    receipt.changedFiles,
    ["notes-renamed.md", "notes.md", "src/card.css", "src/new.css"],
  );
  assert.deepEqual(receipt.outOfScopeFiles, []);
});

test("dirty overlap detection respects path segment boundaries", async () => {
  const root = await createRepo();
  await mkdir(path.join(root, "src-old"));
  await writeFile(path.join(root, "src", "card.css"), ".card { color: blue; }\n");
  await writeFile(path.join(root, "src-old", "legacy.css"), ".legacy {}\n");
  const baseline = await captureBaseline(root);

  assert.deepEqual(findDirtyOverlaps(baseline, ["src"]), ["src/card.css"]);
  assert.deepEqual(findDirtyOverlaps(baseline, ["."]), ["src-old/legacy.css", "src/card.css"]);
});

test("state store creates, reads, and atomically updates tasks", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-state-"));
  const store = createStateStore({ stateRoot, processAlive: () => false });
  await store.createTask({ id: "task-1", status: "queued", attempts: [] });

  assert.equal((await store.readTask("task-1")).status, "queued");
  const updated = await store.updateTask("task-1", (task) => ({ ...task, status: "running" }));
  assert.equal(updated.status, "running");
  assert.equal((await store.readTask("task-1")).status, "running");
  await assert.rejects(store.readTask("missing"), /not found/i);

  const raw = await readFile(path.join(stateRoot, "tasks", "task-1", "state.json"), "utf8");
  assert.equal(JSON.parse(raw).status, "running");
});

test("project locks reject live owners and recover stale owners", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-lock-"));
  const root = await createRepo();
  const liveStore = createStateStore({ stateRoot, processAlive: (pid) => pid === 1234 });

  await liveStore.acquireProjectLock(root, { taskId: "task-live", workerPid: 1234 });
  await assert.rejects(
    liveStore.acquireProjectLock(root, { taskId: "task-next", workerPid: 5678 }),
    /task-live|active/i,
  );

  const staleStore = createStateStore({ stateRoot, processAlive: () => false });
  const recovered = await staleStore.acquireProjectLock(root, {
    taskId: "task-recovered",
    workerPid: 5678,
  });
  assert.equal(recovered.taskId, "task-recovered");
  assert.equal(await staleStore.releaseProjectLock(root, "wrong-task"), false);
  assert.equal(await staleStore.releaseProjectLock(root, "task-recovered"), true);
});
