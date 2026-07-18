import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);
const DEFAULT_MAX_RUNTIME_MINUTES = 30;
const MAX_RUNTIME_MINUTES = 120;

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeStringList(value, field, { required = false } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${field} must be a non-empty array`);
  }
  return value.map((entry, index) => requireNonEmptyString(entry, `${field}[${index}]`));
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function closestExistingPath(candidate, root) {
  let cursor = candidate;
  while (isInside(root, cursor)) {
    try {
      await stat(cursor);
      return cursor;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      if (cursor === root) break;
      cursor = path.dirname(cursor);
    }
  }
  return root;
}

async function normalizeScopedPath(root, raw, field) {
  if (path.isAbsolute(raw)) {
    throw new Error(`${field} must use a relative path`);
  }
  if (raw.includes("\0")) {
    throw new Error(`${field} contains an invalid null byte`);
  }

  const portable = raw.replaceAll("\\", "/");
  const normalized = path.posix.normalize(portable);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${field} resolves outside the Git root`);
  }

  const candidate = path.resolve(root, normalized);
  if (!isInside(root, candidate)) {
    throw new Error(`${field} resolves outside the Git root`);
  }

  const existing = await closestExistingPath(candidate, root);
  const realExisting = await realpath(existing);
  const suffix = path.relative(existing, candidate);
  const resolvedThroughLinks = path.resolve(realExisting, suffix);
  if (!isInside(root, resolvedThroughLinks)) {
    throw new Error(`${field} resolves outside the Git root through a symbolic link`);
  }

  const relative = path.relative(root, candidate).split(path.sep).join("/");
  return relative || ".";
}

export async function validateStartInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be an object");
  }

  const projectPath = requireNonEmptyString(input.project_path, "project_path");
  if (!path.isAbsolute(projectPath)) {
    throw new Error("project_path must be an absolute path");
  }

  let realProject;
  try {
    realProject = await realpath(projectPath);
  } catch {
    throw new Error(`project_path does not exist: ${projectPath}`);
  }

  let gitRootOutput;
  try {
    ({ stdout: gitRootOutput } = await execFile(
      "git",
      ["-C", realProject, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ));
  } catch {
    throw new Error("project_path must be inside a Git working tree");
  }
  const gitRoot = await realpath(gitRootOutput.trim());

  const task = requireNonEmptyString(input.task, "task");
  const acceptanceCriteria = normalizeStringList(input.acceptance_criteria, "acceptance_criteria").map((item) => item.trim());
  const rawAllowedPaths = normalizeStringList(input.allowed_paths, "allowed_paths", { required: true });
  const rawContextFiles = normalizeStringList(input.context_files, "context_files");

  const allowedPaths = [];
  for (let index = 0; index < rawAllowedPaths.length; index += 1) {
    allowedPaths.push(await normalizeScopedPath(gitRoot, rawAllowedPaths[index], `allowed_paths[${index}]`));
  }

  const contextFiles = [];
  for (let index = 0; index < rawContextFiles.length; index += 1) {
    contextFiles.push(await normalizeScopedPath(gitRoot, rawContextFiles[index], `context_files[${index}]`));
  }

  if (input.allow_dirty_overlap !== undefined && typeof input.allow_dirty_overlap !== "boolean") {
    throw new Error("allow_dirty_overlap must be a boolean");
  }
  if (input.allow_dependency_install !== undefined && typeof input.allow_dependency_install !== "boolean") {
    throw new Error("allow_dependency_install must be a boolean");
  }
  const maxRuntimeMinutes = input.max_runtime_minutes ?? DEFAULT_MAX_RUNTIME_MINUTES;
  if (!Number.isInteger(maxRuntimeMinutes) || maxRuntimeMinutes < 1 || maxRuntimeMinutes > MAX_RUNTIME_MINUTES) {
    throw new Error(`max_runtime_minutes must be an integer between 1 and ${MAX_RUNTIME_MINUTES}`);
  }

  return {
    gitRoot,
    task,
    acceptanceCriteria,
    allowedPaths: [...new Set(allowedPaths)],
    contextFiles: [...new Set(contextFiles)],
    allowDirtyOverlap: input.allow_dirty_overlap ?? false,
    allowDependencyInstall: input.allow_dependency_install ?? false,
    maxRuntimeMs: maxRuntimeMinutes * 60 * 1000,
  };
}
