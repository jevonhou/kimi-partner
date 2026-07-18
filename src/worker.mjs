import { compareBaseline } from "./git-baseline.mjs";
import { createStateStore } from "./state-store.mjs";
import {
  buildContinuationPrompt,
  buildInitialPrompt,
  resolveKimiExecutable,
  runKimiAttempt,
} from "./kimi-runner.mjs";

function updateAttempt(attempts, number, updates) {
  return attempts.map((attempt) => (
    attempt.number === number ? { ...attempt, ...updates } : attempt
  ));
}

export async function runWorker({
  taskId,
  stateRoot,
  signal,
} = {}) {
  const store = createStateStore({ stateRoot });
  let task = await store.readTask(taskId);
  const attempt = task.attempts.at(-1);
  if (!attempt || attempt.status !== "queued") {
    throw new Error(`task ${taskId} has no queued attempt`);
  }

  const startedAt = new Date().toISOString();
  task = await store.updateTask(taskId, (current) => ({
    ...current,
    status: "running",
    phase: "running",
    workerPid: process.pid,
    updatedAt: startedAt,
    attempts: updateAttempt(current.attempts, attempt.number, {
      status: "running",
      startedAt,
    }),
  }));
  await store.updateProjectLock(task.gitRoot, taskId, { workerPid: process.pid }).catch(() => {});

  try {
    const executable = await resolveKimiExecutable({ explicitPath: task.kimiExecutable });
    const prompt = attempt.kind === "continuation"
      ? buildContinuationPrompt(task, attempt.feedback)
      : buildInitialPrompt(task);
    const result = await runKimiAttempt({
      taskId,
      attempt: attempt.number,
      executable,
      projectPath: task.gitRoot,
      prompt,
      sessionId: attempt.kind === "continuation" ? task.sessionId : undefined,
      modelAlias: task.modelAlias,
      maxRuntimeMs: task.maxRuntimeMs,
      policy: {
        gitRoot: task.gitRoot,
        allowedPaths: task.allowedPaths,
        allowDependencyInstall: task.allowDependencyInstall,
      },
      taskDirectory: store.taskDirectory(taskId),
      env: { ...process.env, ...(task.workerEnv || {}) },
      signal,
    });
    const receipt = await compareBaseline(task.baseline, task.gitRoot, task.allowedPaths);
    const boundaryError = receipt.headChanged
      ? "Kimi changed the Git HEAD, which is outside the allowed safety policy"
      : receipt.outOfScopeFiles.length
        ? `Kimi changed files outside the allowed paths: ${receipt.outOfScopeFiles.join(", ")}`
        : null;
    const status = signal?.aborted || result.error === "Kimi task was cancelled"
      ? "cancelled"
      : result.success && !boundaryError ? "completed" : "failed";
    const completedAt = new Date().toISOString();
    task = await store.updateTask(taskId, (current) => ({
      ...current,
      status,
      phase: status,
      updatedAt: completedAt,
      completedAt,
      sessionId: result.sessionId || current.sessionId || null,
      summary: result.summary,
      error: result.error || boundaryError,
      exitCode: result.exitCode,
      processSignal: result.signal,
      malformedEventCount: result.malformedEventCount,
      changeReceipt: receipt,
      attempts: updateAttempt(current.attempts, attempt.number, {
        status,
        completedAt,
        result,
      }),
    }));
    return task;
  } catch (error) {
    const completedAt = new Date().toISOString();
    let receipt = null;
    try {
      receipt = await compareBaseline(task.baseline, task.gitRoot, task.allowedPaths);
    } catch {
      // Preserve the primary failure if Git reconciliation also fails.
    }
    task = await store.updateTask(taskId, (current) => ({
      ...current,
      status: signal?.aborted ? "cancelled" : "failed",
      phase: signal?.aborted ? "cancelled" : "failed",
      updatedAt: completedAt,
      completedAt,
      error: error.message,
      changeReceipt: receipt,
      attempts: updateAttempt(current.attempts, attempt.number, {
        status: signal?.aborted ? "cancelled" : "failed",
        completedAt,
        error: error.message,
      }),
    }));
    return task;
  } finally {
    await store.releaseProjectLock(task.gitRoot, taskId).catch(() => {});
  }
}
