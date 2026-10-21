# Start with Claude Code in VS Code

This is the guide for using the starter pack. It is not an application installer.

## 1. Put the files in the right place

1. Extract Team-Request-Portal-Claude-Starter.zip.
2. Open its team-request-portal folder in VS Code. CLAUDE.md and plan.md should be directly in that folder, not hidden in an additional nested starter folder.
3. If you already have a Git repository, merge these documents into its root after checking for existing files. Preserve existing instructions and code.
4. Open Claude Code in that same workspace.
5. Paste the first prompt below.

No need to upload the same documents to Claude's website. For this VS Code workflow, the versioned repository documents are the shared project context.

## 2. What each important file does

- plan.md: what to build, scope boundaries, business rules, milestone checklists, and pass/fail gates.
- CLAUDE.md: persistent instructions about how Claude should work in this repository.
- docs/architecture.md: request flow, identity model, shard routing, database boundaries, and security mechanics.
- docs/decisions.md: why choices were made and which assumptions need review.
- session_state.md: a small handoff so a later session knows where to resume.
- README.md: setup instructions for humans; currently states that code is not built yet.
- docs/demo.md: how to prove the requirements to your mentor.

plan.md is not a special automatically loaded Claude filename. CLAUDE.md tells Claude to read the relevant plan sections. This pack imports the short session_state.md, while keeping larger documents available on demand.

Claude's automatic memory may help with preferences, but important architecture and progress should remain in Git-tracked files. Documentation guides the assistant; code, tests, database privileges, and configuration enforce behavior.

## 3. First prompt: discover and scaffold

Paste this into Claude Code:

~~~text
We are building the Team Request & Approval Portal described in this repository.

Read CLAUDE.md, session_state.md, plan.md, docs/architecture.md, and
docs/decisions.md. Inspect the existing folder and Git status before editing.

Execute M0, then implement M1 only. Do not implement all milestones at once.
Use the selected local architecture and preserve existing user work.
Detect my actual OS/shell and tools; keep setup compatible with Windows
PowerShell + Docker Desktop or explicitly document a WSL2 workflow.

Verify compatible stable dependency versions from official documentation.
Use the Node LTS/Prisma baseline in the plan, record exact choices, and pin them.
If a prerequisite is missing, explain the precise setup needed and continue
work that does not depend on it. Do not pretend a tool is installed.

For M1, create the workspace, quality configuration, local infrastructure,
same-origin reverse proxy, placeholder apps, and documented scripts.
No hosted auth/database/cache services. No extra product features.

Check the effective Git name/email and their origin before any first commit;
do not invent my work identity or a remote. Do not push during this first task.

Run the relevant verification and show the actual command results.
Update milestone checkboxes, decisions if needed, README, and session_state.md.
Finish with: files changed, what works, checks run, unrun checks/blockers,
a simple explanation of the local request flow, and the next milestone.
Proceed with routine edits without asking after every file.
~~~

The first result should be a working foundation, not a complete application. Check that its claimed commands exist and that the reported checks were run.

## 4. Continue with the next milestone

After reviewing M1, use:

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

If a milestone is too large, ask Claude to complete one coherent subtask and its checks. Keep the same source documents rather than generating another overlapping plan.

## 5. Resume after closing VS Code or starting a new conversation

~~~text
Resume this repository. Read CLAUDE.md and session_state.md.
Confirm actual progress against the worktree and plan.md.
Summarize what is verified, identify the next incomplete task,
and continue it using the existing architecture and acceptance criteria.
Do not restart scaffolding or claim old unverified commands passed.
~~~

At the end of a session, ask:

~~~text
Update session_state.md with a short handoff: completed work,
exact verified commands/results, known blockers, and the next task.
Update the plan's checkboxes only where acceptance evidence exists.
Keep business scope and architecture decisions in their owning documents.
~~~

## 6. Ask for a focused review

After the auth and tenant milestones:

~~~text
Review the implemented authentication and tenant data paths against plan.md
and docs/architecture.md. Check actual code, DB roles/RLS, and tests.
Prioritize wrong-tenant access, employee ownership, role/disable revocation,
CSRF, shared sessions/limits, and unsafe pooling of tenant context.

Report concrete findings with file paths, severity, a reproduction,
and missing tests. Separate verified findings from hypotheses.
Do not claim security merely because a guard or policy file exists.
~~~

Use Claude's planning mode for uncertain changes affecting multiple components. Small, clear fixes can be implemented directly. Always ask for checks that can succeed or fail; an explanation alone is not evidence.

## 7. Git workflow

Git records history; the remote host (your company's Git server/GitHub/GitLab) receives pushes. The remote is a development service, not an application runtime dependency.

Before the first commit, inspect effective identity in the actual project terminal:

~~~powershell
git config --show-origin --get user.name
git config --show-origin --get user.email
~~~

If they are incorrect, set repository-local identity using your actual approved work values. Replace the example values below before running:

~~~powershell
git config --local user.name "Your Work Name"
git config --local user.email "your-work-email@example.com"
~~~

If this is a new folder, initialize Git once. If it is already a repository, do not reinitialize it. Ask Claude to inspect git status and the configured remotes first.

Suggested sequence:
1. Commit the reviewed starter documentation.
2. Use a feature branch for a coherent milestone.
3. Inspect git diff, then git diff --staged.
4. Run that milestone's checks.
5. Commit with a descriptive message.
6. Push the selected branch to the configured company remote.

Examples of useful commit subjects:
- docs: define approval portal scope and architecture
- chore: add local workspace and infrastructure
- feat: add shared-session authentication
- feat: enforce tenant-aware shard routing
- feat: add atomic request decisions and audit
- test: verify tenant isolation and concurrent reviews

The starter includes a basic .gitignore. Review staged files anyway. Keep schemas/migrations and the package lockfile in Git; keep local credentials, environment values, volumes, dumps, and generated test output out.

If you need a prompt for a Git handoff:

~~~text
Inspect git status, staged/unstaged diffs, effective identity, and remotes.
List the files proposed for the next logical commit and checks already run.
Check that no local secrets or generated credentials are staged.
Use my configured work identity and selected branch/remote.
Do not invent a remote, overwrite unrelated work, rewrite history,
or force-push. Report the resulting commit/branch and push result accurately.
~~~

## 8. Hooks and token use

Start without custom automation. Once formatter/linter commands exist:
- Use deterministic local formatting commands for changed or staged files.
- Run focused checks during development and full gates at meaningful milestones.
- Keep hook output brief; lengthy output consumes Claude's context.
- A local formatter does not itself call the model. The surrounding assistant/tool interaction and visible output can still use tokens.
- Do not install the company's skill names as if they were built-in Claude commands. Their README describes a separate toolchain; this pack adopts its process, not its integrations.

## 9. Review before handing the result to your mentor

Use docs/demo.md and the definition-of-done table in plan.md.
A successful UI screenshot is only one part of the evidence.
Show tenant isolation, actual shard placement, transactional behavior,
shared sessions/limits, tests, and logical Git history.

