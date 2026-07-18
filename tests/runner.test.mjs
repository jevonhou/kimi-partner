import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  buildContinuationPrompt,
  buildInitialPrompt,
  resolveDefaultModelAlias,
  resolveKimiExecutable,
  runKimiAttempt,
} from "../src/kimi-runner.mjs";
import { captureBaseline } from "../src/git-baseline.mjs";
import { createStateStore } from "../src/state-store.mjs";
import { runWorker } from "../src/worker.mjs";

const fakeKimi = fileURLToPath(new URL("./fixtures/fake-kimi.mjs", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

async function createRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "kimi-partner-runner-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "tests@example.com"]);
  git(root, ["config", "user.name", "Kimi Partner Tests"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "card.css"), ".card { color: black; }\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  return root;
}

test("runner resolves an explicit executable and rejects a missing override", async () => {
  await chmod(fakeKimi, 0o755);
  assert.equal(await resolveKimiExecutable({ explicitPath: fakeKimi }), fakeKimi);
  await assert.rejects(
    resolveKimiExecutable({ explicitPath: path.join(tmpdir(), "missing-kimi") }),
    /not executable|not found/i,
  );
});

test("prompts preserve scope and forbid dangerous repository actions", () => {
  const task = {
    task: "Improve the card",
    allowedPaths: ["src/card.css"],
    contextFiles: ["Design.md"],
    acceptanceCriteria: ["Keep the text"],
  };
  const initial = buildInitialPrompt(task);
  const continuation = buildContinuationPrompt(task, "The focus ring is missing.");

  for (const prompt of [initial, continuation]) {
    assert.match(prompt, /src\/card\.css/);
    assert.match(prompt, /do not commit/i);
    assert.match(prompt, /do not push/i);
    assert.match(prompt, /do not deploy/i);
    assert.match(prompt, /outside the Git root/i);
    assert.match(prompt, /do not install/i);
    assert.match(prompt, /do not use network|download/i);
    assert.match(prompt, /Codex/i);
  }
  assert.match(continuation, /focus ring is missing/i);
});

test("model resolution pins the configured Kimi model alias", async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-home-"));
  await mkdir(path.join(homeDirectory, ".kimi-code"));
  await writeFile(path.join(homeDirectory, ".kimi-code", "config.toml"), [
    'default_model = "kimi-code/k3"',
    "",
    "[models.kimi-code-k3]",
    'model = "k3"',
  ].join("\n"));

  assert.equal(await resolveDefaultModelAlias({ homeDirectory }), "kimi-code/k3");
});

test("runner invokes fake Kimi without a shell and captures session, summary, and logs", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-attempt-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-attempt-state-"));
  const argvFile = path.join(taskDirectory, "argv.json");
  const envFile = path.join(taskDirectory, "env.json");
  await writeFile(path.join(projectPath, "index.css"), "body {}\n");

  const result = await runKimiAttempt({
    taskId: "task-runner",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "Make the page clearer",
    modelAlias: "kimi-code/k3",
    taskDirectory,
    env: {
      ...process.env,
      FAKE_KIMI_ARGV_FILE: argvFile,
      FAKE_KIMI_ENV_FILE: envFile,
      FAKE_KIMI_EDIT_FILE: "index.css",
      FAKE_KIMI_EDIT_CONTENT: "button { color: blue; }\n",
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.sessionId, "fake-session-123");
  assert.equal(result.summary, "Fake Kimi completed.");
  assert.equal(result.malformedEventCount, 0);
  assert.match(await readFile(path.join(projectPath, "index.css"), "utf8"), /color: blue/);

  const argv = JSON.parse(await readFile(argvFile, "utf8"));
  assert.ok(argv.includes("--output-format"));
  assert.ok(argv.includes("stream-json"));
  assert.equal(argv[argv.indexOf("--model") + 1], "kimi-code/k3");
  assert.ok(!argv.includes("--auto"));
  assert.ok(!argv.includes("--yolo"));
  assert.deepEqual(JSON.parse(await readFile(envFile, "utf8")), { thinkingKeep: "all" });
});

test("runner terminates a task that exceeds its runtime limit", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-timeout-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-timeout-state-"));

  const result = await runKimiAttempt({
    taskId: "task-timeout",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "wait",
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 50,
    taskDirectory,
    env: { ...process.env, FAKE_KIMI_DELAY_MS: "2000" },
  });

  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.match(result.error, /time limit|timed out/i);
});

test("runner blocks a reported write outside the allowed paths before it executes", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-policy-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-policy-state-"));
  const forbidden = path.join(projectPath, "notes.md");
  const event = {
    type: "message",
    role: "assistant",
    tool_calls: [{ function: { name: "Write", arguments: JSON.stringify({ path: forbidden, content: "bad" }) } }],
  };

  const result = await runKimiAttempt({
    taskId: "task-policy",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "write outside scope",
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 2000,
    policy: { gitRoot: projectPath, allowedPaths: ["src"] },
    taskDirectory,
    env: {
      ...process.env,
      FAKE_KIMI_TOOL_CALL: JSON.stringify(event),
      FAKE_KIMI_DELAY_MS: "1000",
      FAKE_KIMI_EDIT_FILE: "notes.md",
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.policyViolation?.code, "WRITE_OUTSIDE_ALLOWED_PATHS");
  await assert.rejects(readFile(forbidden, "utf8"), /ENOENT/);
});

test("runner blocks a shell command that targets a path outside the Git root", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-policy-"));
  const tempTarget = path.join(tmpdir(), `kimi-partner-forbidden-${Date.now()}.txt`);
  const forbiddenCommands = [
    { command: `ls '${tempTarget}'`, target: tempTarget },
    { command: "ls '/Users/example/outside-project'", target: "/Users/example/outside-project" },
    { command: "ls '/Applications/Kimi Partner.app'", target: "/Applications/Kimi Partner.app" },
    { command: "ls //server/share", target: "//server/share" },
    { command: "cd /t?p/", target: "/t?p/" },
    { command: "cd /t*p/", target: "/t*p/" },
    { command: "cd /[t]mp/", target: "/[t]mp/" },
    { command: String.raw`cd /t\mp/`, target: String.raw`/t\mp/` },
    { command: "cd /U?ers/", target: "/U?ers/" },
    { command: "cd /Applic*tions/", target: "/Applic*tions/" },
    { command: String.raw`cd /\/server/`, target: String.raw`/\/server/` },
  ];

  for (const [index, { command, target }] of forbiddenCommands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-policy-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };

    const result = await runKimiAttempt({
      taskId: `task-shell-policy-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "read outside files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: {
        ...process.env,
        FAKE_KIMI_TOOL_CALL: JSON.stringify(event),
        FAKE_KIMI_DELAY_MS: "1000",
      },
    });

    assert.equal(result.success, false, command);
    assert.equal(result.policyViolation?.code, "SHELL_PATH_OUTSIDE_GIT_ROOT", command);
    assert.equal(result.policyViolation?.target, target, command);
  }
});

test("runner allows project-local Node script files", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-validation-"));
  const commands = ["node scripts/validate-project.mjs", "node --check scripts/validate-project.mjs"];
  for (const [index, command] of commands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-validation-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };
    const result = await runKimiAttempt({
      taskId: `task-shell-validation-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "validate project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
    });

    assert.equal(result.success, true, command);
    assert.equal(result.policyViolation, null, command);
  }
});

test("runner rejects every Node inline-evaluation option", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-inline-eval-"));
  const commands = [
    "node -e 'console.log(1)'",
    "node --eval 'console.log(1)'",
    "node --eval='console.log(1)'",
    "node -p '1 + 1'",
    "node --print '1 + 1'",
    "node --print='1 + 1'",
    "node -pe '1 + 1'",
    "node -ep '1 + 1'",
    "nodejs -e 'console.log(1)'",
    "./node -p '1 + 1'",
    "printf 'console.log(1)' | node",
    "echo 'console.log(1)' | node -",
    "node <<'JS'\nconsole.log(1)\nJS",
    "node --input-type=module <<'JS'\nconsole.log(1)\nJS",
  ];

  for (const [index, command] of commands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-inline-eval-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };
    const result = await runKimiAttempt({
      taskId: `task-shell-inline-eval-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "validate project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
    });

    assert.equal(result.success, false, command);
    assert.equal(result.policyViolation?.code, "NODE_INLINE_EVAL_NOT_ALLOWED", command);
  }
});

test("runner rejects shell expansion inside node eval arguments", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-eval-expansion-"));
  const commands = [
    'node -e "$(cat /tmp/x)"',
    'node -e "$(cat</tmp/x)"',
    'node --eval "$(cat /tmp/x)"',
    'node --eval="$(cat /tmp/x)"',
    "node -e $(cat /tmp/x)",
    'node -e "`cat /tmp/x`"',
  ];

  for (const [index, command] of commands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-eval-expansion-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };
    const result = await runKimiAttempt({
      taskId: `task-shell-eval-expansion-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "validate project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
    });

    assert.equal(result.success, false, command);
    assert.equal(result.policyViolation?.code, "NODE_EVAL_SHELL_EXPANSION_NOT_ALLOWED", command);
  }
});

test("runner blocks external absolute paths inside node eval string literals", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-js-string-policy-"));
  const forbiddenCases = [
    { target: "/tmp/x", command: 'node -e \'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/tmp/x", command: 'node -p \'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/tmp/x", command: 'node --print \'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/tmp/x", command: 'node --print=\'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/tmp/x", command: 'node -pe \'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/tmp/x", command: 'node -ep \'require("fs").readFileSync("/tmp/x")\'' },
    { target: "/Users/x", command: 'node -e \'require("fs").readFileSync("/Users/x")\'' },
    { target: "/Applications/x", command: 'node -e \'require("fs").readFileSync("/Applications/x")\'' },
    { target: "//server/share", command: 'node -e \'require("fs").readFileSync("//server/share")\'' },
  ];

  for (const [index, { command }] of forbiddenCases.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-js-string-policy-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };

    const result = await runKimiAttempt({
      taskId: `task-shell-js-string-policy-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "read project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: {
        ...process.env,
        FAKE_KIMI_TOOL_CALL: JSON.stringify(event),
      },
    });

    assert.equal(result.success, false, command);
    assert.equal(result.policyViolation?.code, "NODE_INLINE_EVAL_NOT_ALLOWED", command);
  }

  const dynamicCommands = [
    'node -e \'require("fs").readFileSync(require("path").join(require("os").homedir(),"secret"))\'',
    'node -p \'require("fs").readFileSync(process.env.HOME + "/secret")\'',
  ];
  for (const [index, command] of dynamicCommands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-js-dynamic-path-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };
    const result = await runKimiAttempt({
      taskId: `task-shell-js-dynamic-path-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "read project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
    });

    assert.equal(result.success, false, command);
    assert.equal(result.policyViolation?.code, "NODE_INLINE_EVAL_NOT_ALLOWED", command);
  }
});

test("runner rejects obfuscated external paths in Node inline evaluation", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-js-lexer-policy-"));
  const commands = [
    'node -e \'let x=1; x++ / 2; require("fs").readFileSync("/tmp/x")\'',
    String.raw`node -e 'require("fs").readFileSync("\u{2f}tmp/x")'`,
  ];
  const violations = [];

  for (const [index, command] of commands.entries()) {
    const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-js-lexer-policy-state-"));
    const event = {
      role: "assistant",
      tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
    };
    const result = await runKimiAttempt({
      taskId: `task-shell-js-lexer-policy-${index}`,
      attempt: 1,
      executable: fakeKimi,
      projectPath,
      prompt: "read project files",
      modelAlias: "kimi-code/k3",
      maxRuntimeMs: 2000,
      policy: { gitRoot: projectPath, allowedPaths: ["src"] },
      taskDirectory,
      env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
    });
    violations.push(result.policyViolation ?? null);
  }

  assert.deepEqual(
    violations.map((violation) => violation?.code ?? null),
    ["NODE_INLINE_EVAL_NOT_ALLOWED", "NODE_INLINE_EVAL_NOT_ALLOWED"],
  );
});

test("runner rejects template interpolation inside node eval arguments", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-template-eval-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-shell-template-eval-state-"));
  const command = "node -e 'require(\"fs\").readFileSync(`${\"/\"}tmp/x`)'";
  const event = {
    role: "assistant",
    tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command }) } }],
  };

  const result = await runKimiAttempt({
    taskId: "task-shell-template-eval",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "validate project files",
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 2000,
    policy: { gitRoot: projectPath, allowedPaths: ["src"] },
    taskDirectory,
    env: { ...process.env, FAKE_KIMI_TOOL_CALL: JSON.stringify(event) },
  });

  assert.equal(result.success, false);
  assert.equal(result.policyViolation?.code, "NODE_EVAL_TEMPLATE_INTERPOLATION_NOT_ALLOWED");
});

test("runner blocks dependency installation even when the command has leading whitespace", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-install-policy-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-install-policy-state-"));
  const event = {
    role: "assistant",
    tool_calls: [{ function: { name: "Bash", arguments: JSON.stringify({ command: "  npm install puppeteer" }) } }],
  };

  const result = await runKimiAttempt({
    taskId: "task-install-policy",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "install",
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 2000,
    policy: { gitRoot: projectPath, allowedPaths: ["src"], allowDependencyInstall: false },
    taskDirectory,
    env: {
      ...process.env,
      FAKE_KIMI_TOOL_CALL: JSON.stringify(event),
      FAKE_KIMI_DELAY_MS: "1000",
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.policyViolation?.code, "DEPENDENCY_INSTALL_NOT_ALLOWED");
});

test("runner tolerates malformed events but reports a non-zero exit as failure", async () => {
  await chmod(fakeKimi, 0o755);
  const projectPath = await mkdtemp(path.join(tmpdir(), "kimi-partner-malformed-"));
  const taskDirectory = await mkdtemp(path.join(tmpdir(), "kimi-partner-malformed-state-"));

  const malformed = await runKimiAttempt({
    taskId: "task-malformed",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "x",
    taskDirectory,
    env: { ...process.env, FAKE_KIMI_MALFORMED: "1" },
  });
  assert.equal(malformed.success, true);
  assert.equal(malformed.malformedEventCount, 1);

  const failed = await runKimiAttempt({
    taskId: "task-failed",
    attempt: 1,
    executable: fakeKimi,
    projectPath,
    prompt: "x",
    taskDirectory,
    env: { ...process.env, FAKE_KIMI_EXIT_CODE: "7", FAKE_KIMI_STDERR: "simulated failure" },
  });
  assert.equal(failed.success, false);
  assert.equal(failed.exitCode, 7);
  assert.match(failed.error, /simulated failure|code 7/i);
});

test("worker persists a completed task, Git receipt, and Kimi session", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-worker-state-"));
  const repo = await createRepo();
  const store = createStateStore({ stateRoot });
  const baseline = await captureBaseline(repo);
  const now = new Date().toISOString();
  await store.createTask({
    id: "task-worker",
    status: "queued",
    phase: "queued",
    gitRoot: repo,
    task: "Improve card color",
    acceptanceCriteria: ["Keep layout"],
    allowedPaths: ["src"],
    contextFiles: [],
    baseline,
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 30_000,
    kimiExecutable: fakeKimi,
    workerEnv: {
      FAKE_KIMI_EDIT_FILE: "src/card.css",
      FAKE_KIMI_EDIT_CONTENT: ".card { background: white; }\n",
    },
    attempts: [{ number: 1, kind: "initial", status: "queued", createdAt: now }],
    createdAt: now,
    updatedAt: now,
  });
  await store.acquireProjectLock(repo, { taskId: "task-worker", workerPid: process.pid });

  await runWorker({ taskId: "task-worker", stateRoot });
  const task = await store.readTask("task-worker");

  assert.equal(task.status, "completed");
  assert.equal(task.phase, "completed");
  assert.equal(task.sessionId, "fake-session-123");
  assert.deepEqual(task.changeReceipt.changedFiles, ["src/card.css"]);
  assert.equal(task.attempts[0].status, "completed");
  assert.equal(await store.releaseProjectLock(repo, "task-worker"), false);
});

test("worker resumes the captured Kimi session for continuation", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-cont-state-"));
  const repo = await createRepo();
  const argvFile = path.join(stateRoot, "continuation-argv.json");
  const store = createStateStore({ stateRoot });
  const now = new Date().toISOString();
  await store.createTask({
    id: "task-continuation",
    status: "queued",
    phase: "queued",
    gitRoot: repo,
    task: "Improve card color",
    acceptanceCriteria: [],
    allowedPaths: ["src"],
    contextFiles: [],
    baseline: await captureBaseline(repo),
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 30_000,
    sessionId: "existing-session-456",
    kimiExecutable: fakeKimi,
    workerEnv: { FAKE_KIMI_ARGV_FILE: argvFile },
    attempts: [{
      number: 2,
      kind: "continuation",
      feedback: "Add a focus ring",
      status: "queued",
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  });
  await store.acquireProjectLock(repo, { taskId: "task-continuation", workerPid: process.pid });

  await runWorker({ taskId: "task-continuation", stateRoot });
  const argv = JSON.parse(await readFile(argvFile, "utf8"));
  const sessionIndex = argv.indexOf("--session");
  assert.equal(argv[sessionIndex + 1], "existing-session-456");
  assert.equal(argv[argv.indexOf("--model") + 1], "kimi-code/k3");
  assert.match(argv[argv.indexOf("--prompt") + 1], /focus ring/i);
});

test("worker fails a task when Kimi changes a Git file outside the allowed paths", async () => {
  await chmod(fakeKimi, 0o755);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "kimi-partner-outscope-state-"));
  const repo = await createRepo();
  const store = createStateStore({ stateRoot });
  const now = new Date().toISOString();
  await store.createTask({
    id: "task-outscope",
    status: "queued",
    phase: "queued",
    gitRoot: repo,
    task: "Improve card",
    acceptanceCriteria: [],
    allowedPaths: ["src"],
    contextFiles: [],
    baseline: await captureBaseline(repo),
    modelAlias: "kimi-code/k3",
    maxRuntimeMs: 30_000,
    kimiExecutable: fakeKimi,
    workerEnv: {
      FAKE_KIMI_EDIT_FILE: "notes.md",
      FAKE_KIMI_EDIT_CONTENT: "out of scope\n",
    },
    attempts: [{ number: 1, kind: "initial", status: "queued", createdAt: now }],
    createdAt: now,
    updatedAt: now,
  });
  await store.acquireProjectLock(repo, { taskId: "task-outscope", workerPid: process.pid });

  await runWorker({ taskId: "task-outscope", stateRoot });
  const task = await store.readTask("task-outscope");
  assert.equal(task.status, "failed");
  assert.deepEqual(task.changeReceipt.outOfScopeFiles, ["notes.md"]);
  assert.match(task.error, /outside|scope/i);
});
