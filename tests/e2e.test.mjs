import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { buildBundle } from "../scripts/build.mjs";
import { createTaskService } from "../src/task-service.mjs";

const fakeKimi = fileURLToPath(new URL("./fixtures/fake-kimi.mjs", import.meta.url));
const bundlePath = fileURLToPath(new URL("../dist/mcp-server.mjs", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function waitForTerminal(service, taskId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const task = await service.get({ task_id: taskId, wait_ms: 500 });
    if (["completed", "failed", "cancelled"].includes(task.status)) return task;
  }
  throw new Error(`timed out waiting for ${taskId}`);
}

test("default detached worker completes and continues a fake Kimi task end to end", async () => {
  await chmod(fakeKimi, 0o755);
  await buildBundle({ outfile: bundlePath });
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-e2e-state-"));
  const repo = await mkdtemp(path.join(tmpdir(), "kimi-partner-e2e-repo-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "tests@example.com"]);
  git(repo, ["config", "user.name", "Kimi Partner Tests"]);
  await mkdir(path.join(repo, "src"));
  await writeFile(path.join(repo, "src", "card.css"), ".card { color: black; }\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "baseline"]);

  const previousEditFile = process.env.FAKE_KIMI_EDIT_FILE;
  const previousEditContent = process.env.FAKE_KIMI_EDIT_CONTENT;
  process.env.FAKE_KIMI_EDIT_FILE = "src/card.css";
  process.env.FAKE_KIMI_EDIT_CONTENT = ".card { outline: 2px solid blue; }\n";
  try {
    const service = createTaskService({
      stateRoot,
      workerEntrypoint: bundlePath,
      resolveExecutable: async () => fakeKimi,
    });
    const started = await service.start({
      project_path: repo,
      task: "Add a visible focus treatment",
      allowed_paths: ["src"],
      acceptance_criteria: ["Focus treatment is visible"],
    });
    const completed = await waitForTerminal(service, started.taskId);
    assert.equal(completed.status, "completed", completed.error);
    assert.equal(completed.sessionId, "fake-session-123");
    assert.deepEqual(completed.changeReceipt.changedFiles, ["src/card.css"]);

    const continued = await service.continue({
      task_id: started.taskId,
      feedback: "Keep the focus treatment but increase contrast.",
    });
    assert.equal(continued.status, "continuing");
    const refined = await waitForTerminal(service, started.taskId);
    assert.equal(refined.status, "completed", refined.error);
    assert.equal(refined.sessionId, "fake-session-123");
    assert.equal(refined.attempts.length, 2);
  } finally {
    if (previousEditFile === undefined) delete process.env.FAKE_KIMI_EDIT_FILE;
    else process.env.FAKE_KIMI_EDIT_FILE = previousEditFile;
    if (previousEditContent === undefined) delete process.env.FAKE_KIMI_EDIT_CONTENT;
    else process.env.FAKE_KIMI_EDIT_CONTENT = previousEditContent;
    await rm(stateRoot, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});
