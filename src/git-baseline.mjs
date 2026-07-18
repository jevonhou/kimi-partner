import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const execFile = promisify(execFileCallback);

async function git(root, args, { buffer = false, allowFailure = false } = {}) {
  try {
    const { stdout } = await execFile("git", ["-C", root, ...args], {
      encoding: buffer ? "buffer" : "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    if (allowFailure) return buffer ? Buffer.alloc(0) : "";
    throw new Error(`git ${args.join(" ")} failed: ${error?.stderr || error?.message || error}`);
  }
}

function parsePorcelain(buffer) {
  const records = buffer.toString("utf8").split("\0");
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const paths = [record.slice(3)];
    if (/[RC]/.test(status) && records[index + 1]) {
      paths.push(records[index + 1]);
      index += 1;
    }
    entries.push({ status, paths });
  }
  return entries;
}

async function hashRelativePath(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  try {
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      return `symlink:${await readlink(absolutePath)}`;
    }
    if (!info.isFile()) {
      return `other:${info.mode}:${info.size}`;
    }
    const content = await readFile(absolutePath);
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "missing";
    throw error;
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

export function pathIsAllowed(relativePath, allowedPaths) {
  return allowedPaths.some((allowedPath) => (
    allowedPath === "."
    || relativePath === allowedPath
    || relativePath.startsWith(`${allowedPath}/`)
  ));
}

export async function captureBaseline(gitRoot) {
  const statusBuffer = await git(
    gitRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { buffer: true },
  );
  const entries = parsePorcelain(statusBuffer);
  const dirtyFiles = uniqueSorted(entries.flatMap((entry) => entry.paths));
  const fileHashes = {};
  for (const relativePath of dirtyFiles) {
    fileHashes[relativePath] = await hashRelativePath(gitRoot, relativePath);
  }
  const head = (await git(gitRoot, ["rev-parse", "HEAD"], { allowFailure: true })).trim() || null;
  return {
    gitRoot,
    head,
    capturedAt: new Date().toISOString(),
    entries,
    dirtyFiles,
    fileHashes,
  };
}

export function findDirtyOverlaps(baseline, allowedPaths) {
  return baseline.dirtyFiles.filter((relativePath) => pathIsAllowed(relativePath, allowedPaths));
}

async function committedPaths(gitRoot, beforeHead, afterHead) {
  if (!beforeHead || !afterHead || beforeHead === afterHead) return [];
  const output = await git(
    gitRoot,
    ["diff", "--name-only", "-z", beforeHead, afterHead],
    { buffer: true, allowFailure: true },
  );
  return output.toString("utf8").split("\0").filter(Boolean);
}

export async function compareBaseline(before, gitRoot, allowedPaths) {
  const after = await captureBaseline(gitRoot);
  const committed = await committedPaths(gitRoot, before.head, after.head);
  const allPaths = uniqueSorted([...before.dirtyFiles, ...after.dirtyFiles, ...committed]);
  const changedFiles = [];
  const unchangedPreexistingFiles = [];
  const preexistingFilesChangedAgain = [];

  for (const relativePath of allPaths) {
    const wasDirty = Object.hasOwn(before.fileHashes, relativePath);
    const isDirty = Object.hasOwn(after.fileHashes, relativePath);
    const afterHash = isDirty
      ? after.fileHashes[relativePath]
      : await hashRelativePath(gitRoot, relativePath);

    if (wasDirty) {
      if (before.fileHashes[relativePath] === afterHash) {
        unchangedPreexistingFiles.push(relativePath);
      } else {
        changedFiles.push(relativePath);
        preexistingFilesChangedAgain.push(relativePath);
      }
    } else if (isDirty || committed.includes(relativePath)) {
      changedFiles.push(relativePath);
    }
  }

  const sortedChanges = uniqueSorted(changedFiles);
  return {
    changedFiles: sortedChanges,
    unchangedPreexistingFiles: uniqueSorted(unchangedPreexistingFiles),
    preexistingFilesChangedAgain: uniqueSorted(preexistingFilesChangedAgain),
    outOfScopeFiles: sortedChanges.filter((relativePath) => !pathIsAllowed(relativePath, allowedPaths)),
    finalDirtyFiles: after.dirtyFiles,
    headBefore: before.head,
    headAfter: after.head,
    headChanged: before.head !== after.head,
  };
}
