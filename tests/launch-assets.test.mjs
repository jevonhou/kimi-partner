import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("launch covers have exact platform dimensions", async () => {
  const horizontal = await readFile("assets/launch/kimi-partner-launch-cover-16x9.png");
  const vertical = await readFile("assets/launch/kimi-partner-launch-cover-4x5.png");
  assert.deepEqual(pngDimensions(horizontal), { width: 1280, height: 720 });
  assert.deepEqual(pngDimensions(vertical), { width: 1080, height: 1350 });
});

test("launch source keeps the designer-led positioning exact", async () => {
  for (const file of [
    "assets/launch/source/launch-cover-16x9.html",
    "assets/launch/source/launch-cover-4x5.html",
  ]) {
    const source = await readFile(file, "utf8");
    const headline = source.match(/<h1>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, "");
    assert.equal(headline, "设计师定方向，模型加速落地。");
    assert.match(source, /Kimi/);
    assert.match(source, /Codex/);
    assert.doesNotMatch(source, /一键美化|替代设计师|降本|裁员/);
  }
});

test("launch kit contains every promised channel and safety boundary", async () => {
  const copy = await readFile("docs/launch/LAUNCH_KIT.zh-CN.md", "utf8");
  for (const heading of ["X", "即刻", "小红书", "V2EX / 掘金", "30 秒演示脚本", "README 演示区", "发布顺序", "常见问题"]) {
    assert.match(copy, new RegExp(heading.replace(" / ", ".*")));
  }
  assert.match(copy, /设计师定方向，模型加速落地/);
  assert.doesNotMatch(copy, /设计师没用了|一键替代设计师|裁员神器/);
});

test("both READMEs expose the designer-led demo flow", async () => {
  const english = await readFile("README.md", "utf8");
  const chinese = await readFile("README.zh-CN.md", "utf8");
  assert.match(english, /Designer-led workflow/);
  assert.match(english, /Designer → Codex → Kimi → Codex → Designer/);
  assert.match(chinese, /设计师主导的工作流/);
  assert.match(chinese, /设计师 → Codex → Kimi → Codex → 设计师/);
});
