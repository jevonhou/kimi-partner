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
    assert.match(source, /设计师定方向/);
    assert.match(source, /模型加速落地/);
    assert.match(source, /Kimi/);
    assert.match(source, /Codex/);
    assert.doesNotMatch(source, /一键美化|替代设计师|降本|裁员/);
  }
});
