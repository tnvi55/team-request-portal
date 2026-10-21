# Reusable Claude Code prompts

These prompts drive the milestone workflow in [plan.md](../plan.md). Paste them into Claude Code in this workspace. Keep using the same source documents; do not ask Claude to generate a second overlapping plan.

## Continue with the next milestone

~~~text
Read CLAUDE.md, session_state.md, the next incomplete milestone in plan.md,
and its relevant architecture sections. Inspect the current worktree.

Implement that milestone only. Honor its acceptance gate and do not add
deferred features. Use real local Postgres/Redis where required.
Run the relevant checks, review your diff, and update the owning documents.

Explain the important code in simple words: what receives the request,
which checks happen, which database is used, and what response comes back.
Report actual results and any remaining gaps.
~~~

If a milestone is too large, ask for one coherent subtask and its checks.

## Resume after closing VS Code or starting a new conversation

~~~text
Resume this repository. Read CLAUDE.md and session_state.md.
Confirm actual progress against the worktree and plan.md.
Summarize what is verified, identify the next incomplete task,
and continue it using the existing architecture and acceptance criteria.
Do not restart scaffolding or claim old unverified commands passed.
~~~

## End-of-session handoff

~~~text
Update session_state.md with a short handoff: completed work,
exact verified commands/results, known blockers, and the next task.
Update the plan's checkboxes only where acceptance evidence exists.
Keep business scope and architecture decisions in their owning documents.
~~~

## Focused security review (after M3 and M4)

~~~text
Review the implemented authentication and tenant data paths against plan.md
and docs/architecture.md. Check actual code, DB roles/RLS, and tests.
Prioritize wrong-tenant access, employee ownership, role/disable revocation,
CSRF, shared sessions/limits, and unsafe pooling of tenant context.

Report concrete findings with file paths, severity, a reproduction,
and missing tests. Separate verified findings from hypotheses.
Do not claim security merely because a guard or policy file exists.
~~~

Use planning mode for uncertain changes that touch several components. An explanation alone is not evidence; ask for checks that can pass or fail.

## Git handoff

~~~text
Inspect git status, staged/unstaged diffs, effective identity, and remotes.
List the files proposed for the next logical commit and checks already run.
Check that no local secrets or generated credentials are staged.
Use my configured work identity and selected branch/remote.
Do not invent a remote, overwrite unrelated work, rewrite history,
or force-push. Report the resulting commit/branch and push result accurately.
~~~

Suggested sequence per milestone: feature branch -> `git diff` -> `git diff --staged` -> run the milestone checks -> descriptive commit -> push to the configured remote (once one exists).

## Hooks and skills

- Start without hooks. Once formatter/linter commands exist and are tested, a hook may run a local formatter on changed files. Keep hook output short.
- Claude Code skills (`.claude/skills/<name>/SKILL.md`) are on-demand procedures, unlike CLAUDE.md which loads every session. None are needed yet. Once verified commands exist (after M3), the handoff and security-review prompts above are good candidates to turn into project skills such as `/handoff`.
