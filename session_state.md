# Session state

Last updated: 2026-10-27
Project: Team Request & Approval Portal
Current milestone: M6 — company user administration (not started)
Implementation status: M0–M5 complete and verified

## Completed

- M0–M4: workspace, infra, schemas, shard routing, RLS, seed, secure sessions, tenant-scoped requests (details in plan.md and the Learning Guide). M4 merged into `main` 2026-10-26.
- Security fix before the M4 merge (commit e16ef90, ADR-013): the fresh-clone build stopped on Next.js's security gate. next/eslint-config-next 16.4.2, Prisma 7.10.1, pnpm overrides body-parser 2.4.0 + multer 2.5.0 with a temporary `minimumReleaseAgeExclude` (remove after 2026-10-29). `pnpm audit --prod`: no known vulnerabilities. Deferred: fast-uri 3.1.9 (dev-only, moderate/low) until it passes the 7-day rule.
- M5 (branch `m5-decisions`): `POST /requests/:id/decision` (one shard transaction: tenant lookup 404, self-review 403, conditional UPDATE on PENDING + expectedVersion, 409 on zero rows, decision audit event), `GET /admin/audit` (ADMIN only, signed cursor, request titles via same-shard join, batched actor names), `requireRole` helper; decision panel on the request detail page (disabled while sending, 409 reloads), admin Audit page and nav link; Playwright E2E timeout raised to 60 s for multi-user journeys (ADR-017).
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-26 / 2026-10-27)

| Command | Result |
| --- | --- |
| Fresh clone of m4-requests (before fix) | build failed: Next.js SecurityFatalError; integration hit a Windows DLL-init/fork failure (transient) |
| `pnpm audit` (before fix) | 12 advisories: next 2 critical + 1 high, body-parser/multer high (prod); deepmerge-ts, mysql2, fast-uri (dev) |
| Fresh clone of m4-requests (after fix) | install, verify, build (Next 16.4.2), 16+48 integration, migrate, seed, db:verify, 4/4 E2E against the clone: all pass; merged |
| `pnpm --filter @trp/api test:integration` | 61/61 (13 new decision tests); decision suite green 4 runs in a row (40 races) |
| Mutation: drop PENDING/version condition from the decision UPDATE | 3 tests failed (decide-once, stale version, race); restored |
| `pnpm test:e2e` (with `pnpm dev`) | 5/5. An earlier run had 2 auth tests fail while the dev API restarted after the PC resumed (502 shown as generic errors); clean rerun all green |
| `pnpm verify`, `pnpm build`, `pnpm test:integration`, `pnpm db:verify` | clean; unit 16 API + 9 database; 16/16 database + 61/61 API; all checks passed |
| `pnpm audit --prod` | no known vulnerabilities |
| `pnpm demo:up` + concurrent decisions script | approve on api-2 -> 409, reject on api-1 -> 200; final REJECTED v1; one decision audit event |
| Fresh clone of m5-decisions from GitHub (2026-10-27) | install, verify (9 + 16 unit), build, `audit --prod` clean, integration 16/16 + 61/61, migrate, seed, db:verify: all pass |
| E2E against the clone's `pnpm dev` | first run 4/5: Nginx 502 "no live upstreams" on `/auth/me` (dev proxy marked both host.docker.internal addresses down). Fixed `dev.conf` with `max_fails=0` (ADR-012 update); 300 readiness calls all 200, then 5/5 and 5/5; a third back-to-back run hit the documented 5-per-15-min login limit on manager@atlas (expected) |

## Not run / known gaps

- Remove the body-parser/multer `minimumReleaseAgeExclude` after 2026-10-29; update fast-uri once 3.1.9 is 7 days old.
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream; readiness does not check migrations (M7).

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M5. Update it after each milestone.

## Next task

M6 from plan.md: company user list, account creation (temporary password, mustChangePassword, user + membership + control audit in one control transaction), role change and enable/disable with an organization row lock that protects the last active admin, current-ADMIN checks on every write; tests for role checks, session effects, and concurrent removal of the final admins.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
