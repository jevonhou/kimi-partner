#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (process.env.FAKE_KIMI_ARGV_FILE) {
  await mkdir(path.dirname(process.env.FAKE_KIMI_ARGV_FILE), { recursive: true });
  await writeFile(process.env.FAKE_KIMI_ARGV_FILE, `${JSON.stringify(args)}\n`, "utf8");
}

if (process.env.FAKE_KIMI_ENV_FILE) {
  await mkdir(path.dirname(process.env.FAKE_KIMI_ENV_FILE), { recursive: true });
  await writeFile(process.env.FAKE_KIMI_ENV_FILE, `${JSON.stringify({
    thinkingKeep: process.env.KIMI_MODEL_THINKING_KEEP ?? null,
  })}\n`, "utf8");
}

if (args.includes("--prompt") && args.includes("--auto")) {
  process.stderr.write("error: Cannot combine --prompt with --auto.\n");
  process.exit(1);
}

if (args.includes("--prompt") && args.includes("--yolo")) {
  process.stderr.write("error: Cannot combine --prompt with --yolo.\n");
  process.exit(1);
}

if (process.env.FAKE_KIMI_TOOL_CALL) {
  process.stdout.write(`${process.env.FAKE_KIMI_TOOL_CALL}\n`);
}

const delay = Number(process.env.FAKE_KIMI_DELAY_MS || 0);
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

const editFile = process.env.FAKE_KIMI_EDIT_FILE;
if (editFile) {
  const absolute = path.resolve(process.cwd(), editFile);
  await mkdir(path.dirname(absolute), { recursive: true });
  await appendFile(absolute, process.env.FAKE_KIMI_EDIT_CONTENT || "/* fake kimi edit */\n", "utf8");
}

const sessionId = valueAfter("--session") || process.env.FAKE_KIMI_SESSION_ID || "fake-session-123";
process.stdout.write(`${JSON.stringify({ type: "session", session_id: sessionId })}\n`);
if (process.env.FAKE_KIMI_MALFORMED === "1") process.stdout.write("{malformed-json\n");
process.stdout.write(`${JSON.stringify({
  type: "message",
  role: "assistant",
  content: process.env.FAKE_KIMI_SUMMARY || "Fake Kimi completed.",
  prompt_received: valueAfter("--prompt"),
})}\n`);

if (process.env.FAKE_KIMI_STDERR) process.stderr.write(process.env.FAKE_KIMI_STDERR);
process.exit(Number(process.env.FAKE_KIMI_EXIT_CODE || 0));
