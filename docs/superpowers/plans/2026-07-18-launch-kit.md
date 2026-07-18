# Kimi Partner Launch Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a designer-led open-source launch kit with deterministic horizontal and vertical covers, platform-specific Chinese copy, and a truthful README demo section.

**Architecture:** Keep exact typography in editable HTML/CSS source instead of generating text inside a bitmap model. A small Node renderer opens the two local artboards in headless Chrome and exports exact PNG dimensions; Node tests inspect PNG headers and required copy so the launch assets remain reproducible.

**Tech Stack:** HTML/CSS, Node.js 22, macOS Google Chrome headless screenshot CLI, existing PNG logo, Node test runner, Markdown.

## Global Constraints

- Core line: `设计师定方向，模型加速落地。`
- Supporting line: `让 Kimi 发挥前端表现力，让 Codex 守住工程质量。`
- Designer owns goals, standards, product judgment, and final visual acceptance.
- Kimi owns scoped frontend implementation; Codex owns boundaries, code review, tests, and browser acceptance.
- Do not use “一键美化”, “替代设计师”, layoffs, cost-cutting, or unsupported model-superiority claims.
- Preserve the existing independent Kimi Partner logo without imitating official OpenAI, Moonshot AI, or Kimi marks.
- Export exactly `1280 × 720` and `1080 × 1350` PNGs; do not mechanically crop one format into the other.
- Do not include private paths, tokens, account data, or customer material.

---

### Task 1: Add deterministic cover source and renderer

**Files:**
- Modify: `.gitignore`
- Create: `assets/launch/source/launch-cover-16x9.html`
- Create: `assets/launch/source/launch-cover-4x5.html`
- Create: `scripts/render-launch-assets.mjs`
- Test: `tests/launch-assets.test.mjs`

**Interfaces:**
- Consumes: `assets/logo/kimi-partner-logo.png`
- Produces: `assets/launch/kimi-partner-launch-cover-16x9.png` at 1280 × 720 and `assets/launch/kimi-partner-launch-cover-4x5.png` at 1080 × 1350.

- [ ] **Step 1: Ignore temporary visual-companion state**

Add this line to `.gitignore`:

```gitignore
.superpowers/
```

- [ ] **Step 2: Write the failing asset-contract test**

Create `tests/launch-assets.test.mjs`:

```js
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
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```bash
node --test tests/launch-assets.test.mjs
```

Expected: FAIL because the two artboard sources and exported PNGs do not exist.

- [ ] **Step 4: Create the horizontal editable artboard**

Create `assets/launch/source/launch-cover-16x9.html` as a complete 1280 × 720 document. Use an absolute-size `.canvas`, a 12-column grid, the existing logo, the headline `设计师定方向，模型加速落地`, the supporting line from Global Constraints, and three equal role cards labeled `设计师 / Kimi / Codex`. The left edges of eyebrow, headline, body, and role grid must share one grid line. Use only `#F5F7FC`, `#FFFFFF`, `#171A22`, `#5E6678`, `#2563EB`, and `#7C4DFF`.

Required body structure:

```html
<main class="canvas">
  <header class="brand"><img src="../../logo/kimi-partner-logo.png" alt=""><span>KIMI PARTNER</span></header>
  <section class="message">
    <p class="eyebrow">DESIGNER-LED WORKFLOW</p>
    <h1>设计师定方向<br><em>模型加速落地</em></h1>
    <p class="support">让 Kimi 发挥前端表现力，让 Codex 守住工程质量。</p>
  </section>
  <section class="roles">
    <article><b>设计师</b><span>目标 · 规范 · 判断</span></article>
    <article><b>Kimi</b><span>前端实现 · 视觉完成度</span></article>
    <article><b>Codex</b><span>范围控制 · 审查验收</span></article>
  </section>
  <footer>github.com/jevonhou/kimi-partner</footer>
</main>
```

- [ ] **Step 5: Create the vertical editable artboard**

Create `assets/launch/source/launch-cover-4x5.html` with the same content, palette, and typography hierarchy. Recompose for 1080 × 1350: brand at the top, headline in the upper third, supporting line beneath it, and the three role cards stacked vertically with equal 20px gaps. Keep the GitHub URL within the bottom safe area of 72px.

- [ ] **Step 6: Create the Chrome renderer**

Create `scripts/render-launch-assets.mjs`:

```js
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const jobs = [
  ["assets/launch/source/launch-cover-16x9.html", "assets/launch/kimi-partner-launch-cover-16x9.png", 1280, 720],
  ["assets/launch/source/launch-cover-4x5.html", "assets/launch/kimi-partner-launch-cover-4x5.png", 1080, 1350],
];

await mkdir(path.join(root, "assets/launch"), { recursive: true });

for (const [source, output, width, height] of jobs) {
  const result = spawnSync(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--screenshot=${path.join(root, output)}`,
    pathToFileURL(path.join(root, source)).href,
  ], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
```

Add this script to `package.json`:

```json
"render:launch": "node scripts/render-launch-assets.mjs"
```

- [ ] **Step 7: Render and verify the focused tests pass**

Run:

```bash
npm run render:launch
node --test tests/launch-assets.test.mjs
```

Expected: both PNGs are written and both tests pass.

- [ ] **Step 8: Inspect both exports visually**

Open both PNGs at original detail. Confirm exact text, shared left edges, readable mobile-scale title, equal card padding, no crop, and no browser scrollbars. If any issue is visible, correct the HTML/CSS, rerender, and rerun the focused test.

- [ ] **Step 9: Commit the cover system**

```bash
git add .gitignore package.json scripts/render-launch-assets.mjs tests/launch-assets.test.mjs assets/launch
git commit -m "add designer-led launch covers"
```

### Task 2: Write the complete Chinese launch copy pack

**Files:**
- Create: `docs/launch/LAUNCH_KIT.zh-CN.md`
- Modify: `tests/launch-assets.test.mjs`

**Interfaces:**
- Consumes: positioning and expression boundaries from the approved design spec.
- Produces: copy blocks that Jevon can paste into X, 即刻, 小红书, V2EX, 掘金, and comment replies.

- [ ] **Step 1: Add a failing copy-contract test**

Append to `tests/launch-assets.test.mjs`:

```js
test("launch kit contains every promised channel and safety boundary", async () => {
  const copy = await readFile("docs/launch/LAUNCH_KIT.zh-CN.md", "utf8");
  for (const heading of ["X", "即刻", "小红书", "V2EX / 掘金", "30 秒演示脚本", "README 演示区", "发布顺序", "常见问题"]) {
    assert.match(copy, new RegExp(heading.replace(" / ", ".*")));
  }
  assert.match(copy, /设计师定方向，模型加速落地/);
  assert.doesNotMatch(copy, /设计师没用了|一键替代设计师|裁员神器/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `node --test tests/launch-assets.test.mjs`.

Expected: FAIL because `docs/launch/LAUNCH_KIT.zh-CN.md` does not exist.

- [ ] **Step 3: Write platform-specific copy**

Create `docs/launch/LAUNCH_KIT.zh-CN.md` with these exact sections:

```markdown
# Kimi Partner 首发宣传包
## 统一定位
## X
## 即刻
## 小红书
## V2EX / 掘金
## 30 秒演示脚本
## README 演示区
## 发布顺序
## 常见问题
```

Requirements:

- X: one concise post, one optional follow-up, and the GitHub URL.
- 即刻: a personal maker story in Jevon's voice, 180–300 Chinese characters.
- 小红书: title, opening hook, six short body paragraphs, and 5–8 relevant hashtags without “替代设计师”.
- V2EX / 掘金: problem, design decision, workflow, guardrails, installation, project status, and disclaimer.
- Demo: five timestamped shots matching the approved 0–30 second structure, with exact on-screen text and recording action.
- FAQ: at least answers “是不是替代设计师”, “为什么不是直接用 Kimi”, “会不会自动改整个仓库”, “是不是官方插件”, and “支持哪些系统”.

- [ ] **Step 4: Run the copy-contract test**

Run `node --test tests/launch-assets.test.mjs`.

Expected: all launch-asset tests pass.

- [ ] **Step 5: Commit the launch copy**

```bash
git add docs/launch/LAUNCH_KIT.zh-CN.md tests/launch-assets.test.mjs
git commit -m "add Kimi Partner launch copy kit"
```

### Task 3: Add a truthful README demo section

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `tests/launch-assets.test.mjs`

**Interfaces:**
- Consumes: the 30-second storyboard and existing install flow.
- Produces: a concise, visible demo section that explains the real flow without claiming an unrecorded GIF exists.

- [ ] **Step 1: Add a failing README contract**

Append:

```js
test("both READMEs expose the designer-led demo flow", async () => {
  const english = await readFile("README.md", "utf8");
  const chinese = await readFile("README.zh-CN.md", "utf8");
  assert.match(english, /Designer-led workflow/);
  assert.match(english, /Designer → Codex → Kimi → Codex → Designer/);
  assert.match(chinese, /设计师主导的工作流/);
  assert.match(chinese, /设计师 → Codex → Kimi → Codex → 设计师/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run `node --test tests/launch-assets.test.mjs`.

Expected: FAIL because the new demo headings and flow lines are absent.

- [ ] **Step 3: Add the Chinese README section**

Insert before `## 为什么做这个插件？`:

```markdown
## 设计师主导的工作流

**设计师 → Codex → Kimi → Codex → 设计师**

设计师定义目标、视觉规范和验收标准；Codex 限定修改范围并启动任务；Kimi 完成前端实现；Codex 检查 Git diff、运行测试并完成浏览器验收；最终视觉判断仍由设计师作出。

> 30 秒真实演示正在制作。录制脚本与拍摄清单见 [`docs/launch/LAUNCH_KIT.zh-CN.md`](docs/launch/LAUNCH_KIT.zh-CN.md)。
```

- [ ] **Step 4: Add the English README section**

Insert before `## Why Kimi Partner?`:

```markdown
## Designer-led workflow

**Designer → Codex → Kimi → Codex → Designer**

The designer defines the goal, visual system, and acceptance criteria. Codex constrains the writable scope and starts the task. Kimi implements the frontend. Codex reviews the Git diff, runs tests, and completes browser acceptance. The designer still makes the final visual judgment.

> A 30-second real workflow demo is in production. The current recording script lives in [`docs/launch/LAUNCH_KIT.zh-CN.md`](docs/launch/LAUNCH_KIT.zh-CN.md).
```

- [ ] **Step 5: Run the focused test**

Run `node --test tests/launch-assets.test.mjs`.

Expected: all tests pass.

- [ ] **Step 6: Commit the README demo section**

```bash
git add README.md README.zh-CN.md tests/launch-assets.test.mjs
git commit -m "explain designer-led demo workflow"
```

### Task 4: Final visual, safety, and repository verification

**Files:**
- Verify: all files changed in Tasks 1–3

**Interfaces:**
- Consumes: completed launch assets, copy, and README updates.
- Produces: a clean, push-ready `main` branch and a handoff listing the remaining manual publishing actions.

- [ ] **Step 1: Verify exact image dimensions and focused contracts**

Run:

```bash
npm run render:launch
node --test tests/launch-assets.test.mjs
```

Expected: both covers render and all launch contracts pass.

- [ ] **Step 2: Run the full repository verification**

Run:

```bash
npm run verify
npm audit --omit=dev
git diff --check
```

Expected: build succeeds, all Node tests pass, audit reports 0 vulnerabilities, and diff check produces no output.

- [ ] **Step 3: Run public-safety scans**

Run:

```bash
rg --hidden -n '(/Users/|/private/var|github_pat_|gh[pousr]_|sk-|BEGIN .*PRIVATE KEY)' \
  README.md README.zh-CN.md docs/launch assets/launch scripts/render-launch-assets.mjs || true
```

Expected: no private paths, tokens, or key material.

- [ ] **Step 4: Inspect mobile readability**

Open each export at original detail and at approximately 25% scale. Confirm headline, role names, and GitHub URL remain legible; verify no text collision, inconsistent baselines, or unsafe edge spacing.

- [ ] **Step 5: Verify Git scope**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: no untracked `.superpowers/` state, and only planned launch-kit changes are present.

- [ ] **Step 6: Push the completed launch kit**

```bash
git push origin main
```

Expected: `origin/main` includes the design spec, implementation plan, launch assets, copy pack, README demo section, and all task commits.
