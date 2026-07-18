import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildBundle } from "../scripts/build.mjs";

test("bundled MCP server runs from an isolated directory without node_modules", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "kimi-partner-dist-"));
  const outfile = path.join(directory, "mcp-server.mjs");
  await buildBundle({ outfile });
  const source = await readFile(outfile, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env node/);
  assert.doesNotMatch(
    source,
    /^(?:import|export)\s+.*from\s+["'](?:@modelcontextprotocol|zod|esbuild)/m,
  );
  assert.doesNotMatch(source, /[ \t]+$/m, "bundle must not contain trailing whitespace");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [outfile],
    cwd: directory,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "kimi-partner-dist-test", version: "1.0.0" },
    { capabilities: {} },
  );
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(`bundled server failed to connect: ${stderr}`, { cause: error });
    }
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), [
      "start_kimi_task",
      "get_kimi_task",
      "wait_kimi_task",
      "continue_kimi_task",
      "cancel_kimi_task",
    ]);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
