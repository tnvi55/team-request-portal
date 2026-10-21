# Team Request & Approval Portal

A local multi-tenant SaaS learning project: employees submit equipment/software requests, reviewers approve or reject, and organization admins manage accounts.

**Current status: documentation starter pack. The application has not been implemented.** There is no working server, package.json, Compose setup, or tested application command yet.

## Start here

1. Extract the starter ZIP.
2. Open the team-request-portal folder itself in VS Code.
3. Use the prompts in [docs/prompts.md](docs/prompts.md) with Claude Code.
4. Implement the milestones in [plan.md](plan.md), one at a time.

If you already have a repository, copy the contents into its root after reviewing existing files; do not overwrite unrelated project instructions or user code.

## Selected stack and requirements

Next.js App Router + NestJS + PostgreSQL + Prisma + Redis.

- Organization-scoped ADMIN, MANAGER, EMPLOYEE roles.
- NestJS-managed local user pool, cookie sessions, password change, and RBAC.
- One central identity/directory database plus two tenant data shards.
- Shared Redis sessions, rate limits, and scoped dashboard cache.
- Transactional audit, pagination, tenant isolation, and stateless application processes.
- Local runtime with no hosted authentication/database/cache/email service.
- Architecture, tests, incremental Git history, and mentor demo evidence.

Exact dependency/container versions are selected and pinned in M0. Docker Desktop/Compose, Node LTS, pnpm, Git, and Claude Code are prerequisites, subject to that baseline check.

## Document map

| File | Owns |
| --- | --- |
| [plan.md](plan.md) | Scope, business rules, milestone acceptance, definition of done |
| [CLAUDE.md](CLAUDE.md) | Persistent instructions for Claude Code |
| [docs/architecture.md](docs/architecture.md) | System, data, auth, routing, transaction, and cache design |
| [docs/decisions.md](docs/decisions.md) | Decisions and explicit assumptions |
| [session_state.md](session_state.md) | Current handoff and verified progress |
| [docs/demo.md](docs/demo.md) | Mentor walkthrough and evidence checklist |
| [docs/learning.md](docs/learning.md) | Plain-language concept notes for the learner |
| [docs/prompts.md](docs/prompts.md) | Reusable Claude Code prompts for milestones, resume, handoff, review |
| [docs/references.md](docs/references.md) | Primary technical references |

## Setup commands

Not available yet. M1 must implement and verify the command contract in plan.md, then replace this section with real setup/start/migrate/seed/test/demo instructions.

Do not present target commands as working until the corresponding scripts exist and have passed checks.

## Local data and credentials

Use synthetic data only. Generate secrets/passwords locally into ignored files during setup/seed. Never commit real environment values, generated credentials, Docker volumes, database dumps, or personal information.

Normal stopping must retain database volumes. There is no default destructive reset.

## Known design limits

One organization per account; fixed two-shard directory; no cross-shard transactions/joins or automatic rebalancing; short-lived dashboard staleness; one local machine without production high availability.

The user-pool interpretation is recorded as assumption A-01 in plan.md for mentor review.

