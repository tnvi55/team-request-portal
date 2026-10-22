# Session state

Last updated: 2026-10-22
Project: Team Request & Approval Portal
Current milestone: M4 — tenant context and request creation/listing (not started)
Implementation status: M0–M3 complete and verified

## Completed

- M0–M2: workspace, infra, schemas, shard routing, RLS, seed (details in plan.md and the Learning Guide). M2 merged into `main`.
- M3 (branch `m3-auth`): login / logout / me / change-password API and pages; Redis sessions (express-session + connect-redis, cookie `trp.sid`); CSRF synchronizer token + exact Origin on all unsafe requests; Argon2id via @trp/database; generic login failures with equal hash work; shared Redis limits (account, IP, anonymous session creation, password change); sessionVersion revocation; mustChangePassword gating; idle 30 min / absolute 8 h; fail-closed 503 on Redis errors; `{ code, message, requestId }` errors and `Cache-Control: no-store`; zod schemas in @trp/contracts with `StandardSchemaValidationPipe` (ADR-015); Playwright E2E.
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-22)

| Command | Result |
| --- | --- |
| `pnpm --filter @trp/api test:integration` | 28/28 (4 health + 24 auth) against *_test Postgres and real Redis; 4 consecutive green runs |
| First run of that suite | 24/28: shared app hit its own 5-per-account login limit; expiry tests flaky because cookie Expires has 1-second precision. Fixed in the tests (own limits per instance; longer test timeouts; replay the cookie by hand so the server is what rejects it) |
| Mutation: remove `regenerateSession` | fixation test failed as expected; restored |
| `pnpm test:e2e` (with `pnpm dev`) | 3/3: redirect when signed out, generic wrong-password error, sign in -> dashboard -> sign out; cookie HttpOnly + SameSite=Lax, invisible to `document.cookie` |
| `pnpm verify` | format, lint, typecheck (incl. e2e) clean; unit 9 API + 9 database |
| `pnpm build`, `pnpm test:integration` | ok; 16/16 database + 28/28 API |
| `pnpm demo:up` + curl through :8080 | one login; `/auth/me` 200 alternating api-1/api-2; still 200 via api-2 after stopping api-1 |

## Not run / known gaps

- Spoofing X-Forwarded-For directly against 127.0.0.1:3001 is possible for local processes (trust proxy includes loopback); through Nginx the header is overwritten. Documented in ADR-015.
- Argon2 parameters not benchmarked yet (OWASP baseline in use).
- ESLint 9 unsupported upstream (follow-up in ADR-010). Readiness does not check migrations (M7).

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M3. Update it after each milestone.

## Next task

M4 from plan.md: tenant context from the current membership + directory on every protected request; tenant-scoped transactions with the runtime role; create/list/detail requests and a tenant-scoped dashboard (UI + API); request + creation audit atomically; signed cursor pagination with status/category filters; employees see only their own requests; Atlas vs Cedar vs Birch negative tests.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
