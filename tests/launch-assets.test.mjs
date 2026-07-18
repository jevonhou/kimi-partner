import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifDimensions(buffer) {
  assert.match(buffer.toString("ascii", 0, 6), /^GIF8[79]a$/);
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function gifAnimation(buffer) {
  const skipSubBlocks = (start) => {
    let offset = start;
    while (buffer[offset] !== 0) offset += 1 + buffer[offset];
    return offset + 1;
  };
  const globalTableBytes = buffer[10] & 0x80 ? 3 * 2 ** ((buffer[10] & 0x07) + 1) : 0;
  let offset = 13 + globalTableBytes;
  let frames = 0;
  let durationMs = 0;
  while (offset < buffer.length && buffer[offset] !== 0x3b) {
    if (buffer[offset] === 0x21 && buffer[offset + 1] === 0xf9) {
      durationMs += buffer.readUInt16LE(offset + 4) * 10;
      offset += 8;
      continue;
    }
    if (buffer[offset] === 0x21) {
      offset = skipSubBlocks(offset + 2);
      continue;
    }
    if (buffer[offset] === 0x2c) {
      frames += 1;
      const localTableBytes = buffer[offset + 9] & 0x80 ? 3 * 2 ** ((buffer[offset + 9] & 0x07) + 1) : 0;
      offset = skipSubBlocks(offset + 11 + localTableBytes);
      continue;
    }
    throw new Error(`Unexpected GIF block 0x${buffer[offset].toString(16)} at ${offset}`);
  }
  return { frames, durationMs };
}

test("launch covers have exact platform dimensions", async () => {
  const social = await readFile("assets/social/kimi-partner-social-preview.png");
  const horizontal = await readFile("assets/launch/kimi-partner-launch-cover-16x9.png");
  const vertical = await readFile("assets/launch/kimi-partner-launch-cover-4x5.png");
  assert.deepEqual(pngDimensions(social), { width: 1280, height: 640 });
  assert.deepEqual(pngDimensions(horizontal), { width: 1280, height: 720 });
  assert.deepEqual(pngDimensions(vertical), { width: 1080, height: 1350 });
});

test("launch source keeps the designer-led positioning exact", async () => {
  for (const file of [
    "assets/launch/source/social-preview.html",
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
  assert.match(english, /assets\/demo\/kimi-partner-30s\.gif/);
  assert.match(chinese, /assets\/demo\/kimi-partner-30s\.gif/);
  assert.doesNotMatch(english, /demo is in production/i);
  assert.doesNotMatch(chinese, /演示正在制作/);
});

test("real workflow demo is a valid 16:9 GIF with public evidence", async () => {
  const demo = await readFile("assets/demo/kimi-partner-30s.gif");
  const desktop = await readFile("assets/demo/settings-kimi-result-desktop.png");
  const mobile = await readFile("assets/demo/settings-kimi-result-mobile.png");
  const evidence = await readFile("docs/demo/DEMO_EVIDENCE.md", "utf8");
  assert.deepEqual(gifDimensions(demo), { width: 960, height: 540 });
  assert.deepEqual(gifAnimation(demo), { frames: 17, durationMs: 30_000 });
  assert.deepEqual(pngDimensions(desktop), { width: 1440, height: 900 });
  assert.deepEqual(pngDimensions(mobile), { width: 390, height: 844 });
  assert.ok(demo.length > 100_000, "demo should contain rendered workflow frames");
  assert.match(evidence, /kp-29ec4b4b-752b-4080-96f7-04a40f87e2b2/);
  assert.match(evidence, /42 \/ 42/);
  assert.match(evidence, /范围外修改：0/);
  assert.doesNotMatch(evidence, /\/Users\/|API[_ -]?key|token=/i);
});
