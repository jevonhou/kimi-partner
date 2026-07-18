# Security Policy

## Supported versions

Kimi Partner is early-stage local tooling. Security fixes are provided for the latest `0.1.x` release.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability that could expose credentials, execute unintended commands, or escape task scope. Use GitHub's **Security → Report a vulnerability** flow for this repository so the report can be reviewed privately.

Include the affected version, operating system, Kimi Code version, reproduction steps, expected boundary, observed behavior, and a minimal test project when possible. Never include real API keys, tokens, private source code, or Kimi session logs.

## Trust model

Kimi Partner runs Kimi Code with the current user's local permissions. Its streamed tool-call checks and prompts are application-level guardrails, not an operating-system sandbox.

The plugin reduces risk by validating project paths, pinning model continuity, enforcing a per-attempt timeout, monitoring common out-of-scope tool calls and commands, and reconciling the final Git state. Codex must still inspect the change receipt and independently verify every result before acceptance.

## Local data

Task state and bounded logs are stored under `~/.codex/kimi-partner/`. The plugin does not store Kimi credentials. Do not publish the local state directory, task IDs, session logs, or project contents in bug reports.
