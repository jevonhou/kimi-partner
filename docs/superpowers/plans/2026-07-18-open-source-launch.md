# Kimi Partner Open Source Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package Kimi Partner as a polished MIT-licensed open-source project and publish `jevonhou/kimi-partner` with production-ready branding, documentation, validation, and a `v0.1.0` release.

**Architecture:** Keep the existing standalone Codex plugin layout and bundled MCP runtime. Add brand assets and repository-facing documentation around the tested implementation, remove local-only version metadata, then publish the verified `main` branch and release through the authenticated GitHub CLI.

**Tech Stack:** Node.js 22+, MCP SDK, esbuild, Zod, Kimi Code CLI, Codex plugins, Git, GitHub CLI, built-in ImageGen.

## Global Constraints

- Public repository: `jevonhou/kimi-partner`, default branch `main`, visibility `public`.
- License: MIT.
- Public product version: `0.1.0`; do not publish the local `+codex.*` cache suffix.
- Brand must remain independent and must not copy OpenAI, Moonshot AI, or Kimi official marks.
- README must state that the project is unofficial and is not affiliated with or endorsed by OpenAI, Moonshot AI, or Kimi.
- Do not publish credentials, Kimi sessions, task logs, marketplace state, machine-specific paths, or user data.
- Do not weaken the existing model pinning, timeout, streamed tool-call guardrails, Git reconciliation, or Codex-owned verification contract.

---

### Task 1: Final Brand Assets

**Files:**
- Create: `assets/logo/kimi-partner-logo.png`
- Create: `assets/logo/kimi-partner-logo-256.png`
- Create: `assets/social/kimi-partner-social-preview.png`
- Modify: `.codex-plugin/plugin.json`

**Interfaces:**
- Consumes: approved dual-bracket concept from the Product Design ideation set.
- Produces: stable repository-relative PNG paths used by the manifest and README.

- [ ] **Step 1: Generate the simplified final mark**

Use built-in ImageGen with the selected reference. Require two solid bracket modules, one small center task square, no inner triangle, no words, no official logo shapes, and a square 1024 px canvas.

- [ ] **Step 2: Inspect the result at full and avatar size**

Open the generated image and verify that the left bracket, right bracket, and center task square remain distinct when reduced to 32 px.

- [ ] **Step 3: Save repository assets**

Copy the selected source to `assets/logo/kimi-partner-logo.png`, derive a 256 × 256 PNG, and compose a 1280 × 640 social preview using the same real logo asset and editable repository text.

- [ ] **Step 4: Wire the manifest brand metadata**

Set `.codex-plugin/plugin.json` to public version `0.1.0`, license `MIT`, brand color matching the selected cobalt, and add the supported icon asset field only if plugin validation accepts it.

- [ ] **Step 5: Validate the manifest**

Run the plugin validator against the current repository root.

Expected: `Plugin validation passed`.

### Task 2: Open-Source Documentation and Repository Hygiene

**Files:**
- Create: `LICENSE`
- Create: `.gitignore`
- Create: `README.zh-CN.md`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: brand assets from Task 1 and the four existing MCP tool contracts.
- Produces: public installation, usage, security, contribution, and promotional surfaces.

- [ ] **Step 1: Add repository hygiene**

Create `.gitignore` entries for `node_modules/`, `.DS_Store`, logs, coverage, local state, `.env*`, and generated temporary browser artifacts. Add the standard MIT license with copyright `2026 JeongHau`.

- [ ] **Step 2: Rewrite the English README**

Lead with the logo and the sentence: `Delegate to Kimi. Keep Codex in control.` Include the workflow, feature proof points, requirements, installation, tool reference, safety model, development commands, unofficial disclaimer, and a Chinese documentation link.

- [ ] **Step 3: Add Chinese documentation**

Create `README.zh-CN.md` with equivalent positioning, installation, safety boundaries, and usage examples rather than a shortened marketing-only translation.

- [ ] **Step 4: Add security and contribution guides**

Document the application-level guardrail limitation, private vulnerability reporting via GitHub Security Advisories, supported version `0.1.x`, test command `npm run verify`, and explicit prohibition on committing credentials or local task state.

- [ ] **Step 5: Make package metadata publish-safe**

Keep the package private to prevent accidental npm publication, add repository, bugs, homepage, license, keywords, and description metadata pointing to `jevonhou/kimi-partner`.

### Task 3: Public-Safety Audit and Verification

**Files:**
- Modify only files implicated by audit findings.
- Test: `tests/*.test.mjs`

**Interfaces:**
- Consumes: the complete publication candidate.
- Produces: evidence that runtime, distribution bundle, docs, and repository contents are safe to publish.

- [ ] **Step 1: Scan for private material**

Run targeted searches for `/Users/`, `/private/`, `/tmp/`, `session_`, access tokens, API keys, `.env`, and local task-state paths. Inspect every hit and remove machine-specific publication leaks without deleting legitimate safety-test strings.

- [ ] **Step 2: Verify tracked-file intent**

Run `git status --short --ignored` and confirm `node_modules/`, local logs, generated images outside `assets/`, and local state are ignored and will not be staged.

- [ ] **Step 3: Run the full project verification**

Run:

```bash
npm run verify
```

Expected: build succeeds, 31 tests pass, and `node --check dist/mcp-server.mjs` exits 0.

- [ ] **Step 4: Run plugin and whitespace validation**

Run the plugin validator and `git diff --check`.

Expected: both exit 0.

- [ ] **Step 5: Inspect the final publication diff**

Review every file staged for release and confirm there are no credentials, session logs, task artifacts, unrelated documents, or unapproved generated variants.

### Task 4: Git History and GitHub Publication

**Files:**
- Stage the complete approved repository except ignored local files.

**Interfaces:**
- Consumes: verified publication candidate from Task 3.
- Produces: public GitHub repository, tagged release, metadata, and shareable links.

- [ ] **Step 1: Commit the implementation and launch package**

Stage explicit intended paths and commit with:

```bash
git commit -m "launch Kimi Partner"
```

- [ ] **Step 2: Create and push the public repository**

Run:

```bash
gh repo create jevonhou/kimi-partner --public --source . --remote origin --push --description "Delegate coding tasks to Kimi while Codex keeps scope, safety, and final verification."
```

Expected: `origin` points to `https://github.com/jevonhou/kimi-partner` and `main` is pushed.

- [ ] **Step 3: Set repository discovery metadata**

Set the description, homepage, and topics: `codex`, `kimi`, `kimi-code`, `mcp`, `ai-agents`, `developer-tools`, `open-source`.

- [ ] **Step 4: Create the release**

Create annotated tag and GitHub Release `v0.1.0` with the title `Kimi Partner v0.1.0` and notes covering opt-in delegation, persistent continuation, K3 history retention, guardrails, Git receipts, and the unofficial-community disclaimer.

- [ ] **Step 5: Verify the public result**

Use GitHub CLI/API to confirm repository visibility is public, default branch is `main`, Topics are present, the README renders, and release `v0.1.0` is published.

### Task 5: Final Handoff

**Files:**
- No source changes unless final verification finds a release-blocking issue.

**Interfaces:**
- Consumes: public repository and release URLs.
- Produces: concise user-facing launch report and promotional links.

- [ ] **Step 1: Report verified launch facts**

Provide the repository URL, release URL, Logo preview, installed plugin status, verification result, and any GitHub setting that could not be automated.

- [ ] **Step 2: Provide the launch message**

Include a short Chinese announcement the user can post publicly, emphasizing the real workflow and avoiding unverified performance claims.
