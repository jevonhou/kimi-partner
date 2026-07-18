<div align="center">
  <img src="assets/logo/kimi-partner-logo-256.png" width="144" alt="Kimi Partner logo">
  <h1>Kimi Partner</h1>
  <p><strong>Bring Kimi's frontend taste into your Codex workflow.</strong></p>
  <p>
    Let Kimi handle a scoped frontend implementation while Codex keeps task planning,
    change boundaries, code review, and final acceptance.
  </p>
  <p>
    <a href="README.zh-CN.md">简体中文</a> ·
    <a href="https://github.com/jevonhou/kimi-partner/releases">Releases</a> ·
    <a href="SECURITY.md">Security</a>
  </p>
</div>

## Designer-led workflow

**Designer → Codex → Kimi → Codex → Designer**

The designer defines the goal, visual system, and acceptance criteria. Codex constrains the writable scope and starts the task. Kimi implements the frontend. Codex reviews the Git diff, runs tests, and completes browser acceptance. The designer still makes the final visual judgment.

![Kimi Partner real workflow: designer brief, scoped Kimi implementation, and Codex verification](assets/demo/kimi-partner-30s.gif)

This 30-second demo comes from a real public-example task: Kimi changed exactly two approved files, left Git `HEAD` unchanged, and produced zero out-of-scope changes. Codex then ran 42 tests and verified the result at 1440×900 and 390×844. See the [public evidence record](docs/demo/DEMO_EVIDENCE.md).

> Kimi Partner provides application-level guardrails, not an operating-system sandbox. Always inspect the actual diff and verify the result independently.

## Why Kimi Partner?

Many developers value Kimi's visual judgment and polished frontend output—especially its handling of layout, spacing, hierarchy, color, component details, and overall style. Real projects still need clear task decomposition, controlled file scope, traceable changes, and dependable acceptance.

Kimi Partner connects those needs. From inside Codex, you can explicitly hand a frontend task to Kimi and use its strengths in interface implementation and visual taste. Codex remains responsible for understanding the project, constraining writable files, reviewing the Git diff, running tests, and completing browser acceptance. You get both models' strengths in one real project without replacing your primary workflow.

```mermaid
flowchart LR
    U["User explicitly chooses Kimi"] --> C["Codex scopes the task"]
    C --> K["Kimi implements"]
    K --> R["Git-aware change receipt"]
    R --> V["Codex reviews and verifies"]
    V -->|"evidence-backed feedback"| K
```

Kimi is an implementation partner here—not an automatic router and not the final reviewer.

## What it does

- **Opt-in delegation** — Kimi is used only when the user explicitly asks for it or approves it for the current task.
- **Persistent async tasks** — start a task, poll its state, and recover results across Codex task restarts.
- **Same-session review loop** — return Codex's evidence-backed feedback to the captured Kimi session.
- **Model continuity** — pin the model alias for every attempt; K3 sessions keep preserved thinking history.
- **Bounded execution** — allowed paths, dependency-install controls, external-path checks, blocked Node inline/stdin execution, dangerous Git-command checks, and a hard per-attempt timeout.
- **Git reconciliation** — changing `HEAD` or a file outside the allowed scope marks the task as failed.
- **Codex-owned acceptance** — Kimi's summary is evidence, not proof; Codex still inspects the diff and runs the relevant tests and browser checks.

## Tools

| Tool | Purpose |
| --- | --- |
| `start_kimi_task` | Start an explicitly approved, scoped Kimi coding task. |
| `get_kimi_task` | Read progress or wait briefly for state changes. |
| `continue_kimi_task` | Resume the same Kimi session with Codex review feedback. |
| `cancel_kimi_task` | Stop a verified active worker when the user asks. |

## Requirements

- macOS (the current process-group behavior is verified on macOS)
- Node.js 22 or newer
- [Kimi Code CLI](https://www.kimi.com/code) installed and signed in
- A Codex build with `codex plugin` support
- A target project inside a Git working tree

## Install

### Recommended: ask Codex

Paste this into Codex:

> Install the Kimi Partner plugin from https://github.com/jevonhou/kimi-partner. Clone it to `~/plugins/kimi-partner`, run its verification, register it in my personal Codex marketplace, install it, and confirm that its Skill and four MCP tools load.

This lets Codex inspect the repository shape, build the bundle, update the personal marketplace safely, and verify the installed copy.

### Manual installation

```bash
git clone https://github.com/jevonhou/kimi-partner.git ~/plugins/kimi-partner
cd ~/plugins/kimi-partner
npm ci
npm run verify
```

Add this entry to the `plugins` array in `~/.agents/plugins/marketplace.json` (preserve any existing entries):

```json
{
  "name": "kimi-partner",
  "source": {
    "source": "local",
    "path": "./plugins/kimi-partner"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

Then install it from the marketplace name declared at the top of that file (normally `personal`):

```bash
codex plugin add kimi-partner@personal
```

Start a new Codex task afterward so the new Skill and MCP tools are loaded.

## Try it

Ask Codex:

> Let Kimi implement the button interaction states in this project, but only allow changes to `src/components/Button.tsx` and `src/styles/button.css`. Then review the diff and verify it yourself.

Codex should prepare the task, call Kimi Partner, wait for the result, inspect the Git receipt, and run its own acceptance checks.

## Safety model

Kimi Partner layers several controls:

1. Input paths are normalized against the real Git root, including symbolic-link escape checks.
2. The current model alias is captured and pinned across continuations.
3. K3 attempts set `KIMI_MODEL_THINKING_KEEP=all`.
4. Streamed tool calls are checked for out-of-scope writes, external absolute paths, unapproved dependency installs, and dangerous Git commands.
5. Every attempt has a hard runtime limit (30 minutes by default; configurable from 1–120 minutes).
6. Git state is reconciled after every attempt. Out-of-scope changes or a changed `HEAD` fail the task.

The streamed tool-call monitor is an **application-level guardrail, not an operating-system sandbox**. Codex must still inspect the final receipt and independently verify the work. See [SECURITY.md](SECURITY.md) for the full trust model.

## Development

```bash
npm ci
npm run verify
```

The runtime is bundled into `dist/mcp-server.mjs`; an installed plugin does not need its own `node_modules` at runtime.

## Project status

Kimi Partner is early-stage software. Version `0.1.x` is intended for local experimentation and careful review. macOS is the verified platform; Windows and Linux process-group semantics are not yet claimed.

## Unofficial project disclaimer

Kimi Partner is an independent community project. It is not affiliated with, endorsed by, or sponsored by OpenAI, Moonshot AI, or Kimi. Product names and trademarks belong to their respective owners.

## License

[MIT](LICENSE) © 2026 Jevon Hou
