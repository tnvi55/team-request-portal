# Session state

Last updated: 2026-10-27
Project: Team Request & Approval Portal
Current milestone: M8 — replica evidence, final verification, and Git handoff (not started)
Implementation status: M0–M7 complete and verified

## Completed

- M0–M6: workspace, infra, schemas, shard routing, RLS, seed, secure sessions, tenant-scoped requests, atomic decisions and request audit, company user administration with the last-admin lock (details in plan.md and the Learning Guide). M6 merged into `main` 2026-10-27.
- M7 (merged into `main` 2026-10-27 after a fresh-clone check, ADR-019):
  - Dashboard cache in Redis (`trp:cache:v1:dashboard:<tenant>:company` / `...:mine:<user>`, 5 s TTL, role checked before the cache, invalidated after create/decide commits, fail open to the DB, `X-Dashboard-Cache` header).
  - Shared per-user API limit (third global guard, `rl:api:<tenant>:<user>`, 120/min, 429 + Retry-After, fail closed).
  - Readiness also checks migrations: names baked in at build by `packages/database/prisma/list-migrations.mjs`; new migration `20261027120000_runtime_reads_migration_history` (runtime SELECT on `_prisma_migrations`, checked by `db:verify`).
  - One JSON log line per request; `X-Instance-ID` only when `EXPOSE_INSTANCE_ID=true` (demo replicas).
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-27)

| Command | Result |
| --- | --- |
| `pnpm db:migrate:all` | new migration applied to control, shard A, shard B |
| `pnpm db:verify` | all checks passed, incl. SELECT-only runtime grant on `_prisma_migrations` in all three databases |
| `vitest run test/cache-and-limits.int-spec.ts` | 9/9 |
| Mutation: no invalidation after create | 2 tests failed; restored |
| Mutation: "mine" key without user id | isolation test failed; restored |
| `pnpm verify` | clean; unit 17 API + 9 database |
| `pnpm test:integration` | 16/16 database + 86/86 API (6 files) |
| `pnpm demo:up` + `pnpm test:e2e` | 6/6 against production images |
| Fresh clone of m7-cache from GitHub | install, verify (9 + 17 unit), build, `audit --prod` clean, integration 16/16 + 86/86, migrate, seed, db:verify, `demo:up` + E2E 6/6 on the clone's production images: all pass |
| `pnpm demo:up` + M7 replica script | readiness incl. `migrations: up`; dashboard miss on api-2 then hits on api-1/api-2; create via api-1 -> next dashboard miss on api-2 with new total; 429 on the 121st counted call (63 on api-1, 62 on api-2), Retry-After 58; other user still 200 |

## Not run / known gaps

- Graceful shutdown is unchanged from M1/M2 (shutdown hooks close the server, pools and Redis); stopping a replica under load is M8 evidence.
- No control-audit viewer (account events are stored and tested).
- Remove the body-parser/multer `minimumReleaseAgeExclude` after 2026-10-29; update fast-uri once 3.1.9 is 7 days old.
- E2E against `pnpm dev` can occasionally hit a Next.js dev-server stall; the production demo run is the reliable signal.
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream.

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M7. Update it after each milestone.

## Next task

M8 from plan.md: two web + two API production instances behind the proxy; one session and shared limits across API replicas; stop one API replica and keep working through the other; either web instance serves pages; full check suite; `demo:verify`; rehearse docs/demo.md and fill its evidence table; README/architecture diagrams; full-history secret scan; honest limitations; final handoff.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
