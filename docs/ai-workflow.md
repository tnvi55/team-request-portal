# How AI was used to build this project

Version: 1.0 | 2026-10-28

This project was built with **Claude Code** (Anthropic's coding agent, run in the VS Code extension) as a pair engineer. The developer owned the requirements, the decisions, and every review. The AI wrote most of the code, tests, and documentation, one milestone at a time, under written rules and checks it could not bypass.

The guiding principle: **an explanation is not evidence**. Nothing was marked done until a real command (tests, database checks, a fresh clone) had passed, and the actual output was recorded.

## 1. Context engineering

The AI starts every session with no memory of the last one. The project therefore keeps its context in versioned files, each with a single owner, so nothing is duplicated or contradicted.

| File | Role for the AI | Loaded |
| --- | --- | --- |
| [CLAUDE.md](../CLAUDE.md) | Short, permanent rules: architecture, non-negotiable trust boundaries, auth and data protection, coding style, verification, Git workflow | Every session, automatically |
| [session_state.md](../session_state.md) | Handoff: what is done, the exact commands that passed, gaps, the next task | Every session (imported by CLAUDE.md) |
| [plan.md](../plan.md) | Scope, business rules, milestones with checkboxes and acceptance gates | Read for the current milestone |
| [docs/architecture.md](architecture.md) | Technical mechanics per component | Read for the relevant component |
| [docs/decisions.md](decisions.md) | 21 ADRs: what was decided and why, plus open assumptions | Read when a choice is revisited |
| [docs/prompts.md](prompts.md) | Reusable prompts: next milestone, resume, handoff, security review, Git handoff | Pasted by the developer |
| [docs/learning.md](learning.md) and the long-form Learning Guide | Plain-language explanations, extended after each milestone | For the developer; keeps the AI's explanations consistent |
| Claude Code auto memory | Small personal preferences (for example "update the Learning Guide after each milestone") | Supplementary; durable decisions were promoted into the documents above |

Rules that kept context small and correct:

- **Read on demand.** CLAUDE.md is short and points to the right section instead of copying it.
- **One owner per fact.** Status lives only in plan.md, rationale only in decisions.md, and the latest verified commands only in session_state.md.
- **Handoff discipline.** After each milestone, session_state.md is replaced with a short, current summary. No chat history, and no unrun check marked as passed.
- **Long conversations.** When a conversation was summarised, work resumed from these files, not from memory.

## 2. Planning, prompting, and iteration

1. **Scope first.** Before any code, plan.md defined the smallest complete product, an explicit "deferred" list, a role/permission table, request rules, and ten milestones (M0–M9). Each milestone had a gate and a definition of done (D01–D12).
2. **One milestone per prompt.** For example: "Implement the next incomplete milestone only. Honor its acceptance gate. Use real local Postgres/Redis. Run the checks, review your diff, update the owning documents, and explain the request flow in simple words."
3. **Small coherent changes.** The AI stated a short approach, edited a small set of files, ran the relevant checks, and reviewed its own diff before committing.
4. **Evidence loop.** If a check failed, the AI investigated the root cause instead of weakening the test. Several real bugs came from this loop (section 5).
5. **Explain, then advance.** Every milestone ended with a plain-language explanation and a "Learn" exercise for the developer.
6. **Iteration from review.** After the MVP, the developer used the app and asked for six changes. The changes are now M9: projects and managers, real names, a redesigned dashboard, a password toggle, attempts left, and an admin-only status page. They went through the same gate.

## 3. Agents, skills, and reusable instructions

- **One main Claude Code agent** per working session, driven by the milestone prompts in [docs/prompts.md](prompts.md). The project is a modular monolith with a strict build order, so parallel sub-agents were not needed. Files were read directly instead of delegated.
- **Reusable prompts** act as lightweight skills: continue a milestone, resume after a break, end-of-session handoff, focused security review (after M3 and M4), and Git handoff.
- **Docs skill and connector.** These maintain the long-form Learning Guide (a Claude Doc) after each milestone: an "Mx explained" section, the bug log, a glossary, and the update log.
- **Scripts the AI wrote and then relied on as checks:** `pnpm verify`, `pnpm db:verify` (read-only database evidence), `pnpm demo:verify` (replica checks), and `pnpm secrets:scan`.

Responsibilities:

| Owner | Responsibilities |
| --- | --- |
| Developer | Requirements and priorities, Git identity and remote, approval of destructive or outward actions, running and reviewing the app, accepting each milestone, requesting changes |
| Claude Code | Version research from official sources, scaffolding, schemas and migrations, API and UI code, tests, mutation checks, docs and ADRs, diff review, commits on a branch, fresh-clone checks before merging |

## 4. Guardrails

**Written rules (CLAUDE.md):**
- Tenant context only from the authenticated membership.
- Every query goes through the tenant-scoped transaction.
- RLS is tested as the real runtime role.
- No secrets in logs or Git.
- Never weaken tests, silence type errors, or fake success.
- Report exact commands and results, and say when something was not run.

**Enforced by code and configuration:**
- TypeScript strict; ESLint and Prettier; `pnpm verify` before every commit.
- zod schemas reject unknown fields. A route without a schema fails at runtime by design.
- Database CHECK constraints and composite foreign keys back up the service rules.
- PostgreSQL RLS forced on tenant tables. The runtime role is neither superuser nor BYPASSRLS. Audit tables are append-only for it.

**Supply chain:**
- Exact versions and a committed lockfile.
- pnpm `minimumReleaseAge` of 7 days, and install scripts only from an allowlist.
- `pnpm audit` at every merge, with each exception documented in ADR-013.
- gitleaks secret scan over the full history.

**Tool permissions:** Claude Code's permission mode asks for or blocks risky actions. During this project it blocked a recursive delete of a folder and running a downloaded binary. The AI stopped and left the decision to the developer instead of working around it.

**Git safety:** branch per milestone; no force-push and no history rewrites; the identity and remote are the developer's; `.env` and generated demo credentials are Git-ignored and checked by the secret scan.

## 5. AI-assisted QA

**Strategy:** test the boundaries that matter against real infrastructure, and prove the tests can fail.

| Layer | Count (2026-10-28) | Runs against |
| --- | --- | --- |
| Unit | 28 (17 API + 11 database) | Pure rules: cursors, schemas, seed data |
| Integration | 109 (16 database + 93 API) | Real Postgres (three databases) and Redis, isolated `*_test` databases, the actual runtime role |
| Browser E2E | 6 Playwright journeys | The running app through the proxy, including the two-replica production build |
| Operational scripts | `db:verify`, `demo:verify`, failover script | Migrations, RLS, roles, data placement, replicas, shared sessions and limits |

**Mutation checks** (break the code on purpose, confirm a test fails, restore):
- Removing `FOR UPDATE` left a company with zero admins.
- An unconditional UPDATE allowed two decisions.
- Removing session rotation broke the fixation test.
- Turning RLS off failed 8 of 16 isolation tests.
- Removing cache invalidation, or leaving the user ID out of the cache key, failed the cache tests.

**Real issues the AI found through the checks** (26 are logged in the Learning Guide), for example:
- **The build gate stopped on a Next.js version** with critical advisories. It was upgraded before merging.
- **A fresh clone from GitHub failed `pnpm audit`** on a new `qs` advisory. It was fixed with a pinned override (ADR-013).
- **Intermittent 502s were traced** to Docker mapping `host.docker.internal` to an unreachable IPv6 address, combined with Nginx's failure counting (ADR-012).
- **Round-robin sent every request to api-1** until the Nginx upstream got a shared `zone`.
- **A reset Postgres setting returns an empty string, not NULL.** The RLS policy now uses `NULLIF` so a missing tenant means "no rows" instead of an error.
- **A regular expression in a browser test lost its escape** and silently turned the rest of the line into a comment.

**Validating results:**
- Tests run against real Postgres and Redis, never mocks of them.
- Race tests repeat 10 times per run, over several runs.
- Before each merge, a fresh clone from GitHub repeats install, verify, build, audit, integration, migrate, seed (run twice to prove it changes nothing the second time), the E2E tests, and the demo checks.
- Results are recorded with dates in plan.md, session_state.md, and docs/demo.md.

## 6. Human review

- **Milestone gates.** The developer read the AI's explanation and diff summary, ran the app, and accepted each milestone before it was merged.
- **Decision points.** The developer made every genuine scope, security, or destructive decision. Examples: Git identity and remote, the hackathon scope, the M9 changes, and keeping "any manager may approve" until a routing rule is chosen.
- **Learning loop.** Each milestone has a "Learn" question and an exercise against the running code, so the developer can explain every part of the system, not only run it.
