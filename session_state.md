# Session state

Last updated: 2026-10-27
Project: Team Request & Approval Portal
Current milestone: none. The planned MVP (M0–M8) is complete.
Implementation status: M0–M8 complete and verified

## Completed

- M0–M7: workspace, infra, schemas, shard routing, RLS, seed, secure sessions, tenant-scoped requests, atomic decisions and request audit, user administration with the last-admin lock, dashboard cache, shared API limit, readiness with migrations (details in plan.md and the Learning Guide). M7 merged into `main` 2026-10-27.
- M8 (branch `m8-handoff`, ADR-020):
  - `pnpm demo:verify` (`scripts/demo-verify.mjs`): non-destructive replica checks through :8080, then the read-only `db:verify`.
  - Shutdown evidence log (`Database pools closed (SIGTERM)`); successful health probes are no longer request-logged.
  - README: architecture diagram, replica demo section, troubleshooting, honest limits. docs/demo.md rehearsed with commands and a filled evidence table.
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-27)

| Command | Result |
| --- | --- |
| `pnpm verify` | clean; unit 17 API + 9 database |
| `pnpm test:integration` | 16/16 database + 86/86 API |
| `pnpm build` | ok |
| `pnpm demo:up` + `pnpm test:e2e` | 6/6 on the production replicas |
| `pnpm demo:verify` | all checks passed: readiness incl. migrations; api-1 and api-2; two web upstreams with identical assets; one session on both API replicas; CSRF 403, foreign Origin 403, tenant field 400; dashboard cache hit; employee company scope 403 and own-only list; 58 + 58 calls then 429 (Retry-After 56); `db:verify` |
| M8 failover script | api-1 stopped: 8/8 calls 200 on api-2; api-1 restarted: same session served by both; web-1 stopped: pages 200 from web-2 (first request retried by the proxy); data only in the four `trp_` volumes |
| `docker stop trp-api-2-1` | under a second, exit 143 (SIGTERM re-raised after hooks), log `Database pools closed (SIGTERM)` |
| `pnpm secrets:scan` | 28 commits, no leaks; `git ls-files` has no `.env` or credentials |

## Not run / known gaps

- The walkthrough was rehearsed with commands and scripts, not presented live to the mentor.
- No control-audit viewer (account events are stored and tested).
- Remove the body-parser/multer `minimumReleaseAgeExclude` after 2026-10-29; update fast-uri once 3.1.9 is 7 days old.
- E2E against `pnpm dev` can occasionally hit a Next.js dev-server stall; the production demo run is the reliable signal.
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream.

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Covers M0–M8.

## Next task

No planned milestone remains. Possible follow-ups: present the demo to the mentor (docs/demo.md), the two dependency clean-ups above, and any new scope only after a decision recorded in plan.md section 9.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
