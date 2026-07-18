import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.mjs";

async function withClient(service, run) {
  const server = createMcpServer({ service });
  const client = new Client(
    { name: "kimi-partner-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function fakeService() {
  return {
    async start() {
      return { taskId: "task-1", status: "queued", phase: "queued", allowedPaths: ["src"] };
    },
    async get({ task_id: taskId }) {
      if (taskId === "missing") throw new Error("task not found: missing");
      return { taskId, status: "completed", phase: "completed", summary: "done" };
    },
    async wait({ task_id: taskId }) {
      return { taskId, status: "running", phase: "running", detail: "active", suggestedPollMs: 60_000 };
    },
    async continue() {
      return { taskId: "task-1", status: "continuing", phase: "continuing" };
    },
    async cancel() {
      return { taskId: "task-1", status: "cancelling", phase: "cancelling" };
    },
  };
}

test("MCP server exposes the long-wait tool alongside the four task controls", async () => {
  await withClient(fakeService(), async (client) => {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      "start_kimi_task",
      "get_kimi_task",
      "wait_kimi_task",
      "continue_kimi_task",
      "cancel_kimi_task",
    ]);
    const start = tools.tools[0];
    assert.match(start.description, /explicit|approved/i);
    assert.match(start.description, /Git/i);
    assert.match(start.description, /Codex/i);
    assert.ok(start.inputSchema.properties.max_runtime_minutes);
    assert.ok(start.inputSchema.properties.allow_dependency_install);
    const wait = tools.tools.find((tool) => tool.name === "wait_kimi_task");
    assert.equal(wait.inputSchema.properties.wait_ms.default, 300_000);
    assert.equal(wait.inputSchema.properties.wait_ms.maximum, 300_000);
  });
});

test("wait_kimi_task returns compact active status", async () => {
  await withClient(fakeService(), async (client) => {
    const result = await client.callTool({
      name: "wait_kimi_task",
      arguments: { task_id: "task-1", wait_ms: 120_000 },
    });
    assert.equal(result.structuredContent.detail, "active");
    assert.equal(result.structuredContent.suggestedPollMs, 60_000);
    assert.doesNotMatch(result.content[0].text, /poll/i);
  });
});

test("MCP tools return readable text and machine-readable structured content", async () => {
  await withClient(fakeService(), async (client) => {
    const result = await client.callTool({
      name: "start_kimi_task",
      arguments: {
        project_path: "/tmp/project",
        task: "Improve card",
        allowed_paths: ["src"],
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.taskId, "task-1");
    assert.match(result.content[0].text, /task-1/);
  });
});

test("MCP tool failures are concise and marked as errors", async () => {
  await withClient(fakeService(), async (client) => {
    const result = await client.callTool({
      name: "get_kimi_task",
      arguments: { task_id: "missing" },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
    assert.match(result.content[0].text, /not found/i);
    assert.doesNotMatch(result.content[0].text, /at .*\.mjs:\d+/);
  });
});
