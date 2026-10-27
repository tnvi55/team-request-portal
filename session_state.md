# Session state

Last updated: 2026-10-27
Project: Team Request & Approval Portal
Current milestone: M7 — dashboard caching and operational behavior (not started)
Implementation status: M0–M6 complete and verified

## Completed

- M0–M5: workspace, infra, schemas, shard routing, RLS, seed, secure sessions, tenant-scoped requests, atomic decisions and request audit (details in plan.md and the Learning Guide). M5 merged into `main` 2026-10-27 together with the dev-proxy fix (`max_fails=0` in `infra/nginx/dev.conf`, ADR-012 update).
- M6 (branch `m6-users`): `GET/POST /admin/users`, `PATCH /admin/users/:membershipId` in `apps/api/src/admin/`. Every write is one control transaction: organization row lock (`FOR UPDATE`), caller re-checked as active ADMIN, change, control audit event (`MEMBER_CREATED`, `MEMBER_ROLE_CHANGED`, `MEMBER_DISABLED`, `MEMBER_ENABLED`). Last active admin protected (409 `LAST_ADMIN`); disabling increments `sessionVersion`; duplicate email in any company is a generic 409. Web: `/admin/users` (create form, role select, enable/disable, Load more) and a Users nav link for admins (ADR-018).
- Fixed an M3 UI bug found by the new E2E: after a password change the "Password changed" notice was lost because RequireAuth's redirect raced the page's own; the page now does a full load to `/login?changed=1`.
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-27)

| Command | Result |
| --- | --- |
| `vitest run test/admin-users.int-spec.ts` (x3) | 15/15 each run; 10 concurrent final-admin removal rounds per run (self-demote and cross-disable) |
| Mutation: remove `FOR UPDATE` from the organization lock | race test failed (both requests 200, no admin left); restored |
| `pnpm verify` | clean; unit 16 API + 9 database |
| `pnpm test:integration` | 16/16 database + 76/76 API (5 files) |
| `pnpm test:e2e` (with `pnpm dev`) | 6/6, including create -> forced password change -> disable -> self-demote refused |
| `pnpm db:verify` | all checks passed |
| `pnpm demo:up` + replica script | demote via one API replica -> manager 403 on both replicas; restore via the other -> 200 on both; two simultaneous self-removals by the only admin -> 409 LAST_ADMIN from each replica |

## Not run / known gaps

- No control-audit viewer (account events are stored and tested; only the request audit has a page, as scoped).
- Remove the body-parser/multer `minimumReleaseAgeExclude` after 2026-10-29; update fast-uri once 3.1.9 is 7 days old.
- E2E against `pnpm dev` can occasionally hit a Next.js dev-server stall; the production demo run is the reliable signal.
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream; readiness does not check migrations (M7).

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M6. Update it after each milestone.

## Next task

M7 from plan.md: Redis dashboard cache under separate tenant/scope keys (5 s TTL, invalidated after committed request writes, DB fallback when Redis fails), shared authenticated API limit (120/min per user/tenant), fail-closed 503 for session/limiter errors, request IDs and safe instance markers, health checks and pool cleanup; tests for hits, scope isolation, expiry and post-write invalidation.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
