#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createTaskService } from "./task-service.mjs";
import { runWorker } from "./worker.mjs";

const taskIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const pathListSchema = z.array(z.string().min(1).max(2000)).min(1).max(64);
const criteriaSchema = z.array(z.string().min(1).max(2000)).max(32);

function errorResult(error) {
  const message = String(error?.message || error || "Unknown Kimi Partner error")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: {
      ok: false,
      error: {
        code: typeof error?.code === "string" ? error.code : "KIMI_PARTNER_ERROR",
        message,
      },
    },
  };
}

function successResult(payload, text) {
  return {
    content: [{ type: "text", text }],
    structuredContent: payload,
  };
}

function safe(handler) {
  return async (args) => {
    try {
      return await handler(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

function statusText(task) {
  const pieces = [`Kimi task ${task.taskId} is ${task.status}.`];
  if (task.summary) pieces.push(`Summary: ${task.summary}`);
  if (task.error) pieces.push(`Error: ${task.error}`);
  if (task.changeReceipt?.changedFiles?.length) {
    pieces.push(`Changed files: ${task.changeReceipt.changedFiles.join(", ")}.`);
  }
  if (task.changeReceipt?.outOfScopeFiles?.length) {
    pieces.push(`Out-of-scope failure: ${task.changeReceipt.outOfScopeFiles.join(", ")}.`);
  }
  const violation = task.attempts?.at(-1)?.result?.policyViolation;
  if (violation) {
    pieces.push(`Safety policy blocked: ${violation.code}.`);
  }
  return pieces.join(" ");
}

export function createMcpServer({ service = createTaskService() } = {}) {
  const server = new McpServer({ name: "Kimi Partner", version: "0.1.2" });

  server.registerTool("start_kimi_task", {
    title: "Start an approved Kimi coding task",
    description: "Start Kimi Code only after the user explicitly asks for Kimi or approves it for this task. Requires a local Git worktree and scoped allowed paths; Codex must wait, inspect the diff, and independently verify the result.",
    inputSchema: {
      project_path: z.string().min(1).max(4096).describe("Absolute path inside the target Git working tree."),
      task: z.string().min(1).max(20_000).describe("Concrete implementation task for Kimi."),
      acceptance_criteria: criteriaSchema.optional(),
      allowed_paths: pathListSchema.describe("Relative paths Kimi is allowed to modify. Use '.' only for deliberate whole-project scope."),
      context_files: z.array(z.string().min(1).max(2000)).max(32).optional(),
      allow_dirty_overlap: z.boolean().optional().describe("Acknowledge that allowed paths already contain intentional uncommitted work."),
      max_runtime_minutes: z.number().int().min(1).max(120).optional().describe("Hard runtime limit for each Kimi attempt. Defaults to 30 minutes."),
      allow_dependency_install: z.boolean().optional().describe("Explicitly allow task-local dependency installation. Defaults to false."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, safe(async (args) => {
    const task = await service.start(args);
    return successResult(
      task,
      `Kimi task ${task.taskId} started with status ${task.status} for: ${task.allowedPaths.join(", ")}. Codex must wait for this task and avoid editing the same project meanwhile.`,
    );
  }));

  server.registerTool("get_kimi_task", {
    title: "Get or wait for a Kimi task",
    description: "Read persistent Kimi task progress or wait up to 30 seconds for a change. When terminal, Codex must inspect changed and out-of-scope files before independent verification.",
    inputSchema: {
      task_id: taskIdSchema,
      wait_ms: z.number().int().min(0).max(30_000).optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, safe(async (args) => {
    const task = await service.get(args);
    return successResult(task, statusText(task));
  }));

  server.registerTool("wait_kimi_task", {
    title: "Wait efficiently for a Kimi task",
    description: "Wait up to five minutes for a persistent Kimi task to finish, ignoring intermediate phase updates. A timed-out active task returns only compact status; a terminal task returns the full task, attempts, and Git change receipt for Codex review.",
    inputSchema: {
      task_id: taskIdSchema,
      wait_ms: z.number().int().min(1_000).max(300_000).default(45_000),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, safe(async (args) => {
    const task = await service.wait(args);
    return successResult(task, statusText(task));
  }));

  server.registerTool("continue_kimi_task", {
    title: "Return Codex review feedback to Kimi",
    description: "Resume the same captured Kimi session with specific evidence-backed Codex review feedback. Use only after a terminal task and keep the original allowed paths and safety boundary.",
    inputSchema: {
      task_id: taskIdSchema,
      feedback: z.string().min(1).max(20_000),
      acceptance_criteria: criteriaSchema.optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, safe(async (args) => {
    const task = await service.continue(args);
    return successResult(
      task,
      `Kimi task ${task.taskId} is continuing in the captured session. Codex must wait before editing the project.`,
    );
  }));

  server.registerTool("cancel_kimi_task", {
    title: "Cancel an active Kimi task",
    description: "Stop the verified worker process for an active Kimi task. Use only when the user explicitly asks to stop it.",
    inputSchema: { task_id: taskIdSchema },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, safe(async (args) => {
    const task = await service.cancel(args);
    return successResult(task, `Cancellation requested for Kimi task ${task.taskId}.`);
  }));

  return server;
}

export async function startMcpServer() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  return server;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function runCli() {
  const args = process.argv.slice(2);
  const workerTaskId = valueAfter(args, "--worker");
  if (!workerTaskId) {
    await startMcpServer();
    return;
  }

  const stateRoot = valueAfter(args, "--state-root");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const task = await runWorker({ taskId: workerTaskId, stateRoot, signal: controller.signal });
    process.exitCode = task.status === "failed" ? 1 : 0;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1]
  && realpathSync(path.resolve(process.argv[1])) === realpathSync(currentFile)
) {
  await runCli();
}
