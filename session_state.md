# Session state

Last updated: 2026-10-21
Project: Team Request & Approval Portal
Current milestone: M3 — secure authentication vertical slice (not started)
Implementation status: M0, M1, M2 complete and verified

## Completed

- M0/M1: workspace, infra, health checks, replica demo (details in plan.md and the Learning Guide).
- M2 (branch `m2-schemas-sharding`): Prisma 7.10.0 control + tenant schemas and generated clients in `packages/database`; init migrations + hand-written RLS/CHECK/grants migrations; `ShardRegistry`, `resolveShardKey`, `withTenant`, Argon2id helper (@node-rs/argon2); idempotent seed (Atlas, Cedar -> shard A; Birch -> shard B; 4 users and 64 requests each; credentials in `.local/demo-credentials.json`); read-only `db:verify`; isolated `*_test` databases; API `DatabaseService` and readiness through Prisma.
- Decisions: ADR-010 updated (Prisma 7.10.0 because 7.10.1 is under the 7-day rule; @node-rs/argon2), ADR-014 (migration workflow, roles, test databases).
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-21)

| Command | Result |
| --- | --- |
| `pnpm db:migrate:all` (first run) | Failed on control: `permission denied for database` from Prisma's `CREATE SCHEMA IF NOT EXISTS "public"`. Line removed (ADR-014), failed attempt marked rolled back |
| `pnpm db:migrate:all` | 2 migrations each on control, shard A, shard B; second run "No pending migrations" on all three |
| `pnpm db:seed` twice | Run 1: per org 4 users, 64 requests, 96 audit events. Run 2: 0 / 0 / 0 |
| `pnpm db:verify` | All checks passed: identical shard histories, RLS enabled+forced, owner trp_migrator, roles not superuser/BYPASSRLS, audit grants INSERT,SELECT, Atlas/Cedar 64 on A and 0 on B, Birch 64 on B and 0 on A, runtime without context sees 0 |
| `pnpm --filter @trp/database test:integration` | 16/16 as trp_runtime on *_test DBs (routing, same-shard, cross-shard, no context, no pooled leak, cross-tenant insert/update denied, append-only audit, no DELETE, CHECK constraints) |
| Same suite with RLS disabled on shard A test DB | 8/16 failed as expected; RLS restored (relrowsecurity/relforcerowsecurity = t/t) |
| `pnpm verify` | format, lint, typecheck clean; unit 9/9 (database) + 5/5 (API) |
| `pnpm build`, `pnpm test:integration` | ok; 16/16 database + 4/4 API |
| `pnpm demo:up` | images build with Prisma; both API replicas ready through Prisma; `demo:down` ok |

## Not run / known gaps

- Readiness does not yet check migration status (runtime role cannot read `_prisma_migrations`); revisit in M7.
- ESLint 9 is now marked unsupported by npm; follow-up recorded in ADR-010.
- Hot reload through the proxy still not exercised manually.

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0-M2. Update it after each milestone.

## Next task

M3 from plan.md: login/logout/me/change-password with Redis sessions (express-session + connect-redis), CSRF + Origin checks, shared login throttling, sessionVersion revocation, mustChangePassword gating, no-store headers, and the tests listed in the M3 gate. Use `hashPassword`/`verifyPassword` from @trp/database.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
