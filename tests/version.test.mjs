import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public package, plugin, lockfile, and MCP versions stay aligned", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
  const plugin = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  const serverSource = await readFile("src/server.mjs", "utf8");

  assert.equal(packageJson.version, "0.1.1");
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.equal(plugin.version, packageJson.version);
  assert.match(serverSource, /McpServer\(\{ name: "Kimi Partner", version: "0\.1\.1" \}\)/);
});
