import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;
const TERMINATION_GRACE_MS = 2_000;

async function isExecutable(filePath) {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveKimiExecutable({
  explicitPath,
  env = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (await isExecutable(resolved)) return resolved;
    throw new Error(`Kimi executable not found or not executable: ${resolved}`);
  }

  const candidates = [];
  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, "kimi"));
  }
  candidates.push(path.join(homeDirectory, ".kimi-code", "bin", "kimi"));
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  throw new Error("Kimi Code was not found in PATH or ~/.kimi-code/bin/kimi");
}

export async function resolveDefaultModelAlias({ homeDirectory = homedir() } = {}) {
  const configPath = path.join(homeDirectory, ".kimi-code", "config.toml");
  let config;
  try {
    config = await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read Kimi model configuration at ${configPath}: ${error.message}`);
  }
  const match = config.match(/^\s*default_model\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m);
  if (!match?.[1]?.trim()) {
    throw new Error(`Kimi default_model is missing from ${configPath}`);
  }
  return match[1].trim();
}

function listSection(title, values, fallback = "None supplied") {
  const lines = values?.length ? values.map((value) => `- ${value}`) : [`- ${fallback}`];
  return `${title}:\n${lines.join("\n")}`;
}

function safetyRules(task) {
  return [
    "Safety and collaboration rules:",
    "- Work only inside the allowed paths. Read context files before editing when supplied.",
    "- Do not commit. Do not push. Do not publish. Do not deploy.",
    "- Do not reset, clean, or delete unrelated files. Preserve all pre-existing user work.",
    "- Do not create or modify anything outside the Git root, including temporary directories and user configuration.",
    task.allowDependencyInstall
      ? "- Dependency installation is explicitly allowed only when necessary for the acceptance criteria; do not change unrelated dependencies."
      : "- Do not install or update dependencies, package managers, runtimes, or global tools.",
    "- Do not use network downloads, curl, wget, or external asset fetching. If verification needs them, report the limitation instead.",
    "- You may run project-local build, test, lint, type-check, and browser verification commands.",
    "- If anything is ambiguous, choose the smallest reversible in-scope change and do not expand scope.",
    "- Codex owns final review. Report changed files, commands run, evidence, limitations, and anything Codex still needs to verify.",
  ].join("\n");
}

export function buildInitialPrompt(task) {
  return [
    "You are Kimi, an implementation partner working under Codex orchestration.",
    "",
    "Task:",
    task.task,
    "",
    listSection("Allowed paths relative to the Git root", task.allowedPaths),
    "",
    listSection("Formal context files to read first", task.contextFiles),
    "",
    listSection("Acceptance criteria", task.acceptanceCriteria),
    "",
    safetyRules(task),
  ].join("\n");
}

export function buildContinuationPrompt(task, feedback) {
  return [
    "Codex reviewed your previous implementation and is returning evidence-backed feedback.",
    "",
    "Review feedback:",
    feedback,
    "",
    listSection("Allowed paths relative to the Git root", task.allowedPaths),
    "",
    listSection("Current acceptance criteria", task.acceptanceCriteria),
    "",
    safetyRules(task),
  ].join("\n");
}

function findSessionId(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSessionId(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (["session_id", "sessionId"].includes(key) && typeof entry === "string" && entry) {
      return entry;
    }
  }
  for (const entry of Object.values(value)) {
    const found = findSessionId(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractText(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => extractText(entry, depth + 1)).filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof value !== "object") return null;
  for (const key of ["content", "message", "result", "summary", "text", "output"]) {
    if (Object.hasOwn(value, key)) {
      const extracted = extractText(value[key], depth + 1);
      if (extracted) return extracted;
    }
  }
  return null;
}

function createBoundedWriter(handle, limit) {
  let written = 0;
  let chain = Promise.resolve();
  return {
    write(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (written >= limit) return;
      const slice = buffer.subarray(0, Math.max(0, limit - written));
      written += slice.length;
      chain = chain.then(() => handle.write(slice));
    },
    async finish() {
      await chain;
      await handle.sync();
      await handle.close();
    },
  };
}

function appendTail(current, chunk, limit) {
  const next = `${current}${chunk}`;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function relativePathAllowed(relativePath, allowedPaths = []) {
  const portable = relativePath.split(path.sep).join("/");
  return allowedPaths.some((allowed) => allowed === "." || portable === allowed || portable.startsWith(`${allowed}/`));
}

function toolCallsFrom(event) {
  if (!event || typeof event !== "object") return [];
  if (Array.isArray(event.tool_calls)) return event.tool_calls;
  if (Array.isArray(event.toolCalls)) return event.toolCalls;
  return [];
}

function parseToolArguments(toolCall) {
  const raw = toolCall?.function?.arguments ?? toolCall?.arguments ?? toolCall?.input;
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function isJavaScriptRegexLiteral(candidate) {
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return false;

  let escaped = false;
  let inCharacterClass = false;
  let hasRegexSyntax = false;
  for (let index = 1; index < candidate.length; index += 1) {
    const character = candidate[index];
    if (escaped) {
      escaped = false;
      hasRegexSyntax = true;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      hasRegexSyntax = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (!inCharacterClass && character === "/") {
      const suffix = candidate.slice(index + 1);
      return hasRegexSyntax && /^(?:[dgimsuvy]*)(?:$|[),.;]|\.(?:exec|match|replace|search|split|test)\b)/.test(suffix);
    }
    if (!inCharacterClass && /[?*+(){}|^$]/.test(character)) hasRegexSyntax = true;
  }
  return false;
}

function shellAbsolutePaths(command) {
  const found = [];
  const pattern = /(?:^|[\s=])(?:"(\/[^"\n]+)"|'(\/[^'\n]+)'|(\/[^\s"';&|<>]+))/g;
  for (const match of command.matchAll(pattern)) {
    const candidate = match[1] ?? match[2] ?? match[3];
    if (candidate === "//" || isJavaScriptRegexLiteral(candidate)) continue;
    found.push(candidate);
  }
  return found;
}

function normalizeMacTempPath(candidate) {
  return candidate === "/tmp" || candidate.startsWith("/tmp/")
    ? `/private${candidate}`
    : candidate;
}

function inspectPolicy(event, policy) {
  if (!policy?.gitRoot) return null;
  for (const toolCall of toolCallsFrom(event)) {
    const name = String(toolCall?.function?.name ?? toolCall?.name ?? "");
    const args = parseToolArguments(toolCall);
    if (/^(write|edit|strreplace|writefile|strreplacefile)$/i.test(name)) {
      const rawPath = args.path ?? args.file_path ?? args.filename;
      if (typeof rawPath !== "string" || !rawPath.trim()) continue;
      const absolute = path.resolve(policy.gitRoot, rawPath);
      if (!isInside(policy.gitRoot, absolute)) {
        return { code: "WRITE_OUTSIDE_GIT_ROOT", tool: name, target: rawPath };
      }
      const relative = path.relative(policy.gitRoot, absolute);
      if (!relativePathAllowed(relative, policy.allowedPaths)) {
        return { code: "WRITE_OUTSIDE_ALLOWED_PATHS", tool: name, target: rawPath };
      }
    }
    if (/^(bash|shell|runcommand)$/i.test(name)) {
      const command = String(args.command ?? args.cmd ?? "");
      if (!policy.allowDependencyInstall && /(?:^|[;&|]\s*)\s*(?:sudo\s+)?(?:npm\s+(?:i|install)|pnpm\s+(?:add|install)|yarn\s+(?:add|install)|bun\s+(?:add|install)|pip\d*\s+install|uv\s+(?:add|pip\s+install)|brew\s+install)\b/i.test(command)) {
        return { code: "DEPENDENCY_INSTALL_NOT_ALLOWED", tool: name, command };
      }
      if (/(?:^|[;&|]\s*)\s*git\s+(?:commit|push|reset|clean)\b/i.test(command)) {
        return { code: "DANGEROUS_GIT_COMMAND", tool: name, command };
      }
      const normalizedRoot = normalizeMacTempPath(path.resolve(policy.gitRoot));
      for (const shellPath of shellAbsolutePaths(command)) {
        if (shellPath === "/dev/null") continue;
        const absolute = normalizeMacTempPath(path.resolve(shellPath));
        if (!isInside(normalizedRoot, absolute)) {
          return { code: "SHELL_PATH_OUTSIDE_GIT_ROOT", tool: name, target: shellPath, command };
        }
      }
    }
  }
  return null;
}

function terminateChildGroup(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    if (!child.killed) child.kill(signal);
  }
}

export async function runKimiAttempt({
  taskId,
  attempt,
  executable,
  projectPath,
  prompt,
  sessionId,
  modelAlias,
  maxRuntimeMs,
  policy,
  taskDirectory,
  env = process.env,
  signal,
}) {
  await mkdir(taskDirectory, { recursive: true, mode: 0o700 });
  const stdoutLogPath = path.join(taskDirectory, `attempt-${attempt}.jsonl`);
  const stderrLogPath = path.join(taskDirectory, `attempt-${attempt}.stderr.log`);
  const stdoutHandle = await open(stdoutLogPath, "w", 0o600);
  const stderrHandle = await open(stderrLogPath, "w", 0o600);
  const stdoutWriter = createBoundedWriter(stdoutHandle, MAX_LOG_BYTES);
  const stderrWriter = createBoundedWriter(stderrHandle, MAX_LOG_BYTES);

  const args = [];
  if (sessionId) args.push("--session", sessionId);
  if (modelAlias) args.push("--model", modelAlias);
  args.push("--output-format", "stream-json", "--prompt", prompt);
  const childEnv = {
    ...env,
    ...(/(?:^|\/)k3(?:$|[-/])/i.test(modelAlias ?? "") ? { KIMI_MODEL_THINKING_KEEP: "all" } : {}),
  };

  const startedAt = new Date().toISOString();
  let child;
  try {
    child = spawn(executable, args, {
      cwd: projectPath,
      env: childEnv,
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    await stdoutWriter.finish();
    await stderrWriter.finish();
    return {
      success: false,
      exitCode: null,
      signal: null,
      sessionId: sessionId ?? null,
      summary: null,
      error: `Unable to start Kimi: ${error.message}`,
      malformedEventCount: 0,
      stdoutLogPath,
      stderrLogPath,
      startedAt,
      completedAt: new Date().toISOString(),
      pid: null,
    };
  }

  let lineBuffer = "";
  let capturedSessionId = sessionId ?? null;
  let summary = null;
  let malformedEventCount = 0;
  let stderrTail = "";
  let aborted = signal?.aborted ?? false;
  let timedOut = false;
  let policyViolation = null;
  let killTimer = null;

  const stopChild = () => {
    terminateChildGroup(child, "SIGTERM");
    killTimer ??= setTimeout(() => terminateChildGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
    killTimer.unref?.();
  };

  const parseLine = (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      capturedSessionId = findSessionId(event) || capturedSessionId;
      const eventText = extractText(event);
      if (eventText) summary = eventText;
      if (!policyViolation) {
        policyViolation = inspectPolicy(event, policy);
        if (policyViolation) stopChild();
      }
    } catch {
      malformedEventCount += 1;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutWriter.write(chunk);
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) parseLine(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrWriter.write(chunk);
    stderrTail = appendTail(stderrTail, chunk, STDERR_TAIL_BYTES);
  });

  const abortHandler = () => {
    aborted = true;
    stopChild();
  };
  signal?.addEventListener("abort", abortHandler, { once: true });
  const timeout = Number.isFinite(maxRuntimeMs) && maxRuntimeMs > 0
    ? setTimeout(() => {
      timedOut = true;
      stopChild();
    }, maxRuntimeMs)
    : null;
  timeout?.unref?.();

  const completion = await new Promise((resolve) => {
    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, processSignal: null, spawnError: error });
    });
    child.once("close", (exitCode, processSignal) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode, processSignal, spawnError: null });
    });
  });
  signal?.removeEventListener("abort", abortHandler);
  if (timeout) clearTimeout(timeout);
  if (killTimer) clearTimeout(killTimer);
  if (lineBuffer) parseLine(lineBuffer);
  await stdoutWriter.finish();
  await stderrWriter.finish();

  const success = completion.exitCode === 0 && !completion.spawnError && !aborted && !timedOut && !policyViolation;
  let error = null;
  if (!success) {
    if (aborted) error = "Kimi task was cancelled";
    else if (timedOut) error = "Kimi task exceeded its configured time limit";
    else if (policyViolation) error = `Kimi safety policy blocked ${policyViolation.code}`;
    else if (completion.spawnError) error = `Unable to run Kimi: ${completion.spawnError.message}`;
    else error = stderrTail.trim() || `Kimi exited with code ${completion.exitCode ?? "unknown"}`;
  }

  return {
    success,
    exitCode: completion.exitCode,
    signal: completion.processSignal,
    sessionId: capturedSessionId,
    summary,
    error,
    malformedEventCount,
    timedOut,
    policyViolation,
    stdoutLogPath,
    stderrLogPath,
    stderrTail: stderrTail.trim(),
    startedAt,
    completedAt: new Date().toISOString(),
    pid: child.pid,
    taskId,
  };
}
