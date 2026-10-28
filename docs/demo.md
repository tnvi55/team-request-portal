# Demo walkthrough and evidence checklist

Status: rehearsed 2026-10-27 against the production replica demo; M9 steps checked 2026-10-28 against `pnpm dev`. The evidence table at the end records the actual commands and results. Re-run them before presenting; the table is a record, not a guarantee.

Product rules: [plan.md](../plan.md).
Technical design: [architecture.md](architecture.md).

## Preparation

- Use synthetic data only (`pnpm db:seed`; passwords in the Git-ignored `.local/demo-credentials.json`, kept off screen).
- Start the production-build demo: stop `pnpm dev`, then `pnpm demo:up` (api-1, api-2, web-1, web-2 behind the proxy at http://localhost:8080).
- Check everything at once: `pnpm demo:verify` (non-destructive; runs `db:verify` at the end). It uses the two Cedar accounts below, so run it at most twice in 15 minutes.
- Open separate browser profiles or private windows per person: Atlas employee, Atlas manager, Atlas admin.
- Instance markers (`X-Instance-ID`, `X-Upstream`) are visible in the browser's network tab and expose no secrets.
- Plan login use: 5 sign-ins per account per 15 minutes (right or wrong).

## 1. Explain the product and topology

Say: "Each company has admins, managers, and employees. Requests belong to one company. Identities are central; business records are routed to one of two local shards. Web/API processes share state through databases and Redis."

Show the diagram in the README ("How it fits together") and explain:
- tenant = company,
- identity = who can sign in,
- role = what they may do in that company,
- shard = database holding that company's business records,
- stateless app process = no required per-user memory inside that process.

## 2. Employee journey

- On the sign-in page, type a wrong password for `employee@atlas.example`: Show/Hide reveals what was typed, and the error says how many attempts are left (the same for unknown emails, so it reveals nothing about which accounts exist).
- Sign in as `employee@atlas.example` (Rohan Gupta, Robotics Engineer). The dashboard profile card shows the current project (Warehouse Arm v2) and that project's manager (Arjun Rao).
- Submit "Monitor for workstation" under Equipment.
- Open its Pending detail and list entry.
- Show Load more and a status/category filter on Requests.
- Open http://localhost:8080/admin/users or /status: "Admins only" with a way back; the admin API answers 403.
- Open a coworker's request URL: "Request not found" (404, not 403: the API does not confirm it exists).

Evidence: browser flow plus `requests.int-spec.ts` (ownership and role tests).

## 3. Manager journey and transaction

- Sign in as `manager@atlas.example` in another window.
- Open the employee's request: Reject without a comment is refused; Approve.
- Employee reloads the detail page and sees Approved.
- Try to decide again: 409 "already decided".
- Submit a request as the manager and open it: no decision panel (self-review is 403 in the API).
- Show `decisions.int-spec.ts`: 10 simultaneous approve/reject pairs per run, exactly one 200, one 409, one audit event.
- Show the audit-fault test: revoking the audit INSERT grant makes the decision roll back.

Evidence: tests against real Postgres; Admin > Audit shows exactly one decision event.

## 4. Admin journey and current permissions

- Sign in as `admin@atlas.example` (Meera Kapoor); open Users and Audit (both paginated). Users shows each person's designation, project and current manager, and the two projects with their managers; changing a designation or project is one control transaction with an audit event.
- Open System status: control database, both shards, Redis and migrations all `up`.
- Create a user with a temporary password; sign in as them in a private window: they must change it first.
- Set `manager@atlas.example` to Employee; in the manager's window open Requests > Company: 403 on the next call.
- Disable that account: their next click signs them out. Re-enable: they must sign in again.
- Try to make yourself (the only Atlas admin) a Manager: "The company must keep at least one active admin".
- Show `admin-users.int-spec.ts`: two admins removing the last two admins at once, 10 rounds per run, always exactly one admin left.

Evidence: current-control-data checks and control transaction tests.

## 5. Prove tenant isolation and real sharding

Run `pnpm db:verify` (read-only, also the last step of `demo:verify`). It shows:
- the directory: Atlas -> shard A, Cedar -> shard A, Birch -> shard B,
- each company's rows on its own shard and none on the other,
- identical migration histories on both shards,
- RLS enabled and forced, roles without superuser or BYPASSRLS,
- the runtime role seeing 0 rows without a tenant context.

Then show the tests (`database` package and `requests.int-spec.ts`):
- Atlas requesting a Cedar record id: 404 despite sharing shard A.
- Atlas requesting a Birch record id: 404 across shards.
- A body with `tenantId`/`status`/`createdByUserId`: 400.
- Runtime-role SQL without tenant context sees nothing; a write for another tenant is denied by RLS.

Use runtime-role evidence for RLS. An administrator/superuser query can inspect all data and does not prove isolation.

## 6. Redis cache, rate limits, and sessions

- In the network tab, reload the Dashboard twice: `X-Dashboard-Cache: miss`, then `hit`.
- Decide a request, reload: `miss` with the new count (post-commit invalidation); explain the 5-second staleness bound.
- `demo:verify` output: employee asking for company counts gets 403; the employee's list holds only their own requests.
- `demo:verify` output: 116 calls split across api-1/api-2, then 429 with `Retry-After` (one shared 120/min counter).
- Login limit: five wrong passwords on one account give 429 with a retry time (`auth.int-spec.ts`).
- Password change ends every session of that account on every instance (`auth.int-spec.ts`, `users.spec.ts`).
- `demo:verify` output: missing CSRF token and wrong Origin are both 403.
- Cache failure: `cache-and-limits.int-spec.ts` breaks the Redis entry; the dashboard falls back to the database.
- Session/limiter store failure: `auth.int-spec.ts` points the API at a dead Redis; protected work returns 503.

Evidence: integration results and safe request IDs/instance markers. Do not print session IDs/cookies/Redis secrets to a demo transcript.

## 7. Stateless processes and failure behavior

- Network tab: authenticated calls alternate between `X-Instance-ID: api-1` and `api-2` with no sticky sessions.
- `docker stop trp-api-1-1`: keep clicking; api-2 answers everything. The stop takes under a second and `docker logs trp-api-1-1` ends with `Database pools closed (SIGTERM)`.
- Acknowledge a possible transient failure while the proxy notices; there is no promise of zero downtime.
- `docker start trp-api-1-1`: after it is healthy, the same session is served by api-1 again (sessions live in Redis).
- `docker stop trp-web-1-1`: pages keep loading from web-2 (`X-Upstream`); `docker start trp-web-1-1`.
- `docker volume ls`: the data lives in `trp_pg-control`, `trp_pg-shard-a`, `trp_pg-shard-b`, `trp_redis-data`, not in app containers.
- Explain that the local databases/Redis remain stateful and are not replicated for high availability.

Do not automatically retry ambiguous writes during this demonstration.

## 8. Git and reproducibility

Show:
- one branch and logical commits per milestone (`git log --oneline`),
- committed schemas, migrations, lockfile, and `.env.example`,
- `pnpm secrets:scan` (full history, no leaks) and `git ls-files` with no `.env` or credentials,
- the README setup steps, and seed idempotency (`pnpm db:seed` twice, identical `db:verify` distribution),
- passing static, API, browser, and build checks (table below).

## Evidence record

All results from 2026-10-27 on the Windows 11 + Docker Desktop development machine.

| Area | Actual command or test | Actual result | Notes |
| --- | --- | --- | --- |
| Local startup and health | `pnpm infra:up`, `pnpm demo:up`, `pnpm demo:verify` | readiness 200 with control, shardA, shardB, redis, migrations all `up` | Readiness 503 with `migrations: down` when a database lacks a migration (`health.int-spec.ts`) |
| Auth, password change, CSRF | `auth.int-spec.ts` (24 tests), `users.spec.ts`, `demo:verify` | sessions rotate at login; password change ends all sessions; missing token 403 `CSRF_INVALID`, foreign Origin 403 `ORIGIN_INVALID` | |
| Current-role and disabled-session checks | `admin-users.int-spec.ts`, M6 replica script | demoted manager 403 on the next call on both api-1 and api-2; disabled user 401, still dead after re-enable | |
| Same-shard/cross-shard isolation and RLS | `pnpm --filter @trp/database test:integration` (16), `requests.int-spec.ts`, `db:verify` | Atlas cannot read Cedar (same shard) or Birch (other shard); runtime role without context sees 0 rows | Mutation in M4: removing app-level tenant filters still isolated by RLS |
| Shard distribution and migration status | `pnpm db:verify` | each company only on its directory shard; identical histories (3 migrations) on both shards | |
| Transaction rollback and concurrency | `decisions.int-spec.ts` | 10 races per run: one 200, one 409, one audit event; revoked audit grant rolls the decision back | Mutation: unconditional UPDATE failed 3 tests |
| Last-admin protection | `admin-users.int-spec.ts` | 10 concurrent removal rounds per run, always one active admin; 409 `LAST_ADMIN` | Mutation: no `FOR UPDATE` left zero admins |
| Pagination | `requests.int-spec.ts`, `admin-users.int-spec.ts`, `decisions.int-spec.ts` | 45-row pager with tied timestamps: no gaps or duplicates; tampered or replayed cursors 400 | |
| Cache behavior | `cache-and-limits.int-spec.ts`, `demo:verify` | miss then hit; stale until TTL; invalidated after create/decide; per-company and per-person keys; DB fallback on Redis errors | Mutations: no invalidation (2 failed), no user id in key (1 failed) |
| Shared rate limits | `demo:verify` | 58 calls on api-1 + 58 on api-2 (+4 earlier) = 120, then 429 with Retry-After | Login limit: `auth.int-spec.ts` |
| Two web/API instances and process restart | `demo:verify`, M8 failover script | both web replicas serve identical assets; with api-1 stopped all calls 200 on api-2; after restart the same session works on api-1; with web-1 stopped pages served by web-2 | `docker stop` 0.7 s, log `Database pools closed (SIGTERM)` |
| Lint, typecheck, unit/integration/E2E, build | `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e` (on `demo:up`), `pnpm build` | clean; unit 17 API + 9 database; integration 16 + 86; E2E 6/6; build ok | |
| M9 people and projects | `pnpm test:integration`, `pnpm test:e2e` (against `pnpm dev`), `db:verify` | 16 + 93 integration (7 new: project isolation, profile, cross-company project refused by API and database, attempts left); E2E 6/6; runtime role can only read projects | 2026-10-28 |
| Fresh checkout and seed twice | fresh clone of `m8-handoff` from GitHub: install, verify, build, `audit --prod`, integration, migrate, seed, `db:verify`, seed again, `demo:up`, E2E, `demo:verify` | all pass; `db:verify` output identical after the second seed; E2E 6/6 and every `demo:verify` check on the clone's own replicas | The first attempt stopped at the audit: a new qs advisory, fixed with an override (ADR-013) |

## Honest limitations to state

This is a local learning system with fixed shard mapping and one organization per identity. It does not implement automatic rebalancing, distributed transactions, public onboarding, email, billing, production backup/restore, TLS, or high availability: Postgres and Redis are single local instances. Dashboard counts can be up to 5 seconds stale. Stopping a replica can fail one in-flight request. Passing the local checks is evidence for the tested behavior, not proof of production scale.
