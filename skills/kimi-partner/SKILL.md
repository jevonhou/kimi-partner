---
name: kimi-partner
description: Delegate an explicitly approved local coding task from Codex to Kimi Code, monitor it, return review feedback to the same Kimi session, and independently verify the result. Use only when the user explicitly asks to try Kimi or has approved a Codex suggestion to use Kimi for the current task.
---

# Kimi Partner

Use Kimi as an optional implementation partner while Codex retains orchestration and final verification.

## Trigger boundary

- Use this Skill only when the user explicitly asks to use Kimi, compare a Kimi implementation, or approves a Codex suggestion to delegate the current task.
- Do not route ordinary frontend work to Kimi automatically.
- Do not imply that Kimi replaces Codex or that Kimi's completion message is final acceptance.

## Before delegation

1. Read the project's live `AGENTS.md`, `Design.md`, `HANDOFF.md`, and other formal task documents when present.
2. Resolve the real Git root and choose the smallest practical `allowed_paths` set.
3. Write a concrete task with acceptance criteria and list the formal context files Kimi must read.
4. If allowed paths overlap existing dirty files, explain the overlap and set `allow_dirty_overlap` only when the user has already authorized working on that live state.

## Delegation loop

1. Call `start_kimi_task` with the absolute project path, scoped relative paths, task, acceptance criteria, and context files. Keep the default 30-minute attempt limit unless the task clearly needs a bounded increase.
2. Tell the user the returned task ID and scope once.
3. Call `wait_kimi_task` and normally keep its 45-second default. Do not repeatedly call `get_kimi_task` while a task is active; reserve it for an immediate snapshot or compatibility fallback.
4. Do not modify the same project while the Kimi task is active.
5. If a wait returns an active compact status, wait again without narrating unchanged state. Use the 20-second `suggestedPollMs` only when long-wait calls are unavailable.
6. When terminal, inspect the complete task, change receipt, and any out-of-scope warning before reading Kimi's summary.
7. Independently inspect `git diff`, run relevant build/test/lint/type checks, and use a real browser for UI acceptance.
8. If verification fails, call `continue_kimi_task` with specific evidence and re-run the same verification.
9. Call `cancel_kimi_task` only when the user explicitly asks to stop the task.

## Safety contract

- Never ask Kimi to commit, push, publish, deploy, reset, clean, or delete unrelated files.
- Keep dependency installation disabled unless the user or already-approved task explicitly requires it. If authorized, set `allow_dependency_install` only for that task.
- The model alias captured at task start is intentionally pinned for continuations; do not silently switch models mid-session.
- Treat a policy block, Git `HEAD` change, or out-of-scope file as a failed task. Do not describe it as completed.
- Never hide pre-existing dirty files or out-of-scope changes from the user.
- Treat Kimi output as implementation evidence, not proof of correctness.
- Final reporting must distinguish what Kimi changed from what Codex independently verified.
