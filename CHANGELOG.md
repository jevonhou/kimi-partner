# Changelog

All notable changes to Kimi Partner are documented here.

## [Unreleased]

### Added

- `wait_kimi_task` for efficient terminal waiting that ignores intermediate phase updates, with a 45-second default and a configurable maximum of 5 minutes.
- Coverage for long-wait bounds, status-check counts, compact active responses, terminal receipts, and the bundled five-tool contract.

### Changed

- Active `get_kimi_task` and `wait_kimi_task` responses are now compact; terminal responses retain the full task, attempts, and Git change receipt.
- The fallback polling suggestion increased from 1.5 seconds to 20 seconds.

## [0.1.1] - 2026-07-18

### Added

- A 30-second real workflow demo built from a public, scoped Kimi task.
- Public evidence for the task receipt, test run, and desktop/mobile browser acceptance.
- A polished notification-settings example showing the designer → Codex → Kimi → Codex → designer flow.

### Changed

- Expanded the English and Chinese READMEs with the real demo and clearer designer-led positioning.
- Hardened shell-path parsing while preserving normal project-local validation commands.
- Node commands launched by Kimi must now use a project-local script file; inline evaluation and stdin execution are rejected.

### Verification

- Full automated suite passes.
- Bundled MCP server is syntax-checked and tested from an isolated directory.
- Dependency audit reports zero known vulnerabilities.

[0.1.1]: https://github.com/jevonhou/kimi-partner/compare/v0.1.0...v0.1.1
