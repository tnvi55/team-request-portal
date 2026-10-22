# Session state

Last updated: 2026-10-22
Project: Team Request & Approval Portal
Current milestone: M5 — review decisions and transactional audit (not started)
Implementation status: M0–M4 complete and verified

## Completed

- M0–M3: workspace, infra, schemas, shard routing, RLS, seed, secure sessions (details in plan.md and the Learning Guide). M3 merged into `main` 2026-10-22 after a fresh-clone check (install, verify, build, 16+28 integration, db:verify, 3 E2E against the clone's own servers).
- M4 (branch `m4-requests`): tenant context from the guard's membership + directory query; `TenantDbService.run` (withTenant + 503 on shard outage); `POST /requests` (request + REQUEST_CREATED audit in one shard transaction), `GET /requests` (scope/status/category, signed keyset cursor), `GET /requests/:id` (404 outside scope), `GET /dashboard` (counts per scope); batched display names from control; strict zod schemas for body, query and params; pages: requests list with filters + Load more, new request, detail, dashboard tiles (ADR-016).
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-22)

| Command | Result |
| --- | --- |
| `pnpm --filter @trp/api test:integration` | 48/48 (4 health, 24 auth, 20 requests) on *_test databases |
| Mutation: drop ownership filter in detail | coworker test failed as expected; restored |
| Mutation: drop app-level tenantId filters | all 20 request tests still passed: RLS alone kept Atlas out of Cedar (defence in depth); restored |
| Audit fault: owner revokes INSERT on request_audit_events for trp_runtime | POST /requests -> 500 generic body, request count unchanged (rollback); grant restored |
| Shard B unreachable (bad URL) | Birch -> 503, Atlas still 200 on the same instance |
| `pnpm test:e2e` (with `pnpm dev`) | 4/4: auth flow + submit -> coworker 404 -> manager company view |
| `pnpm verify` | clean; unit 16 API + 9 database |
| `pnpm build`, `pnpm test:integration`, `pnpm db:verify` | ok; 16/16 database + 48/48 API; all checks passed |
| `pnpm demo:up` + script through :8080 | login 200; create 201 on api-1; detail 200 alternating api-2/api-1, same request; dashboard 200 |

## Not run / known gaps

- Dev data now also contains requests created by E2E and the replica check (synthetic, harmless).
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream; readiness does not check migrations (M7).

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M4. Update it after each milestone.

## Next task

M5 from plan.md: approve/reject UI and API; one transaction for pending + version check, conditional update, and decision audit; reject self-review and invalid transitions; ADMIN request-audit page; concurrency test (one success, one 409, one event), audit-failure rollback, and runtime-role UPDATE/DELETE denial on audit.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
