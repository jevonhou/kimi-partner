# Contributing

Thanks for helping improve Kimi Partner.

## Before opening a change

- Keep Kimi opt-in. Do not add automatic model routing without an explicit product decision.
- Preserve Codex ownership of final review and acceptance.
- Do not weaken allowed-path validation, timeout handling, tool-call checks, or Git reconciliation.
- Keep credentials, user projects, Kimi sessions, local task state, and machine-specific paths out of commits and fixtures.

## Development

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run verify
```

Runtime changes should include a focused regression test. Follow red-green-refactor: add the failing test, confirm the expected failure, implement the smallest fix, then run the complete verification command.

## Pull requests

Explain what changed, why it is needed, the trust-boundary impact, and the commands used to verify it. Keep pull requests focused and avoid unrelated refactors.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
