# Architecture decisions and assumptions

Version: 1.0 | 2026-10-19

This file owns decision rationale. plan.md owns scope and task status; architecture.md owns implementation mechanics.

## ADR-001 — Small approval product

Status: selected.
Use an equipment/software request portal with three statuses and three roles.
Reason: the domain is small enough to concentrate on security, sharding, transactions, and stateless processes.
Consequence: no purchasing, inventory, billing, leave policy, or configurable workflow.

## ADR-002 — Local modular monolith

Status: selected.
Separate Next.js frontend and NestJS modular backend, locally running Postgres/Redis, and a same-origin reverse proxy.
Reason: matches the required stack with one authorization authority and a straightforward request flow.
Consequence: more than one process, but no microservices or hosted runtime dependencies. A package/image download remains necessary initially.

## ADR-003 — Central identity pool and separate membership

Status: selected implementation; terminology assumption A-01 remains for mentor review.
NestJS handles password sign-in using central local identity records. Membership supplies organization-scoped permissions.
Reason: it teaches authentication without requiring a hosted service or separate identity platform.
Consequence: this is not an OIDC server, Cognito-compatible API, or standalone IAM product. If the mentor means one of those, revisit auth before M3; do not claim equivalence.

## ADR-004 — Directory-based horizontal sharding

Status: selected.
Control stores a tenant-to-shard mapping. Atlas/Cedar share shard A; Birch uses shard B.
Reason: simple, visible distribution; the shared-shard pair also tests tenant isolation independently of database separation.
Consequence: control is a dependency; no automatic rebalancing, cross-shard joins, or distributed business transactions.

## ADR-005 — Redis sessions and stateless app processes

Status: selected.
Session state and limiter counters are external to web/API process memory.
Reason: simpler revocation and replica behavior than building access/refresh-token rotation for this MVP.
Consequence: the system has stateful stores even though app processes are stateless. Redis availability matters; losing it can log users out. JWT is not a prerequisite for stateless app processes.

## ADR-006 — Current authorization plus database defense

Status: selected.
Read current identity/membership on protected requests; apply tenant/ownership predicates and PostgreSQL RLS using transaction-local context.
Reason: changing a role/active flag should affect the next protected request; shared-shard isolation should have a database-level test.
Consequence: extra DB reads and scoped transactions; small demo workload makes that acceptable. RLS must be tested under a non-bypass runtime role.

## ADR-007 — Audit beside the mutation

Status: selected.
Request events live with requests on the tenant shard; identity/member administration events live in control.
Reason: each change and its audit record can share a real single-database transaction.
Consequence: there is no global cross-company audit dashboard. The MVP audit UI shows company request events; control events remain available to local operational inspection.

## ADR-008 — One organization per identity

Status: selected MVP simplification.
Enforce one Membership per User.
Reason: avoids organization switching and cross-company account administration during initial learning.
Consequence: use separate synthetic identities for each demo company; future multi-membership requires an explicit authorization/session redesign.

## ADR-009 — Short-lived count cache

Status: selected.
Cache only dashboard counts with a five-second initial TTL and best-effort post-commit invalidation.
Reason: demonstrates Redis caching with small, understandable consistency tradeoffs.
Consequence: counts are eventually consistent; request detail and decisions use database state. A TTL is not a promise of strict read-after-write consistency under every race/failure.

## ADR-010 — Version baseline

Status: selected in M0, verified 2026-10-21.
Sources: npm registry metadata (`dist-tags`, `engines`, `peerDependencies`, publish dates), the [NestJS 12 migration guide](https://docs.nestjs.com/migration-guide), the [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json), [pnpm settings](https://pnpm.io/settings), and Docker Hub official image tags.
Rule: stable releases only, at least 7 days old (enforced by `minimumReleaseAge` in pnpm-workspace.yaml), exact versions in every package.json, lockfile committed, exact container tags.

| Area | Pinned | Why this one |
| --- | --- | --- |
| Node.js | 24.x, `engines >=24.15 <25`; images `node:24.21.0-alpine` | Plan baseline. Maintenance LTS since 2026-10-20, supported to 2028-04-30. Nest CLI needs ≥24.15. Node 26 becomes LTS 2026-10-28: revisit after M8, not mid-project |
| pnpm | 12.13.0 (`packageManager`) | Newest release older than 7 days. Installed with npm because Corepack is no longer bundled from Node 25 |
| TypeScript | 6.0.3 | 7.0 is out, but typescript-eslint supports `<6.1` and Nest CLI bundles `~6.0.2` |
| Next.js / React | 16.4.2 / 19.3.0 (16.4.0 until 2026-10-26, see ADR-013) | Current stable App Router; React 19 satisfies Next's peer range |
| NestJS | 12.1.3 (core/common/platform-express/testing), CLI 12.0.8 | Current major. ESM-only packages, so the API is an ESM project (`nodenext`) |
| ESLint | 9.39.5, typescript-eslint 8.71.2, eslint-config-next 16.4.0 | ESLint 10 exists, but Next's bundled react/import/jsx-a11y plugins declare peers only up to ESLint 9 |
| Prettier | 3.9.10 | Formatter for code; Markdown docs excluded to keep authored tables intact |
| Vitest | 5.0.4 + unplugin-swc 2.0.0 / @swc/core 1.16.18 | Nest 12's default runner for ESM projects; SWC emits the decorator metadata Nest DI needs |
| Supertest | 7.3.1 | HTTP assertions against the real Nest app in integration tests |
| zod | 4.6.7 | Startup environment validation |
| pg / redis (node-redis) | 8.23.1 / 6.3.0 | M1 readiness probes; pg is also the Prisma 7 driver adapter's driver; node-redis is the client connect-redis expects |
| PostgreSQL | `postgres:18.6-alpine` ×3 | Current stable major; RLS and `set_config(..., true)` as designed |
| Redis | `redis:8.10.2-alpine` | Current stable; `noeviction` + memory cap |
| Nginx | `nginx:1.30.6-alpine` | Stable branch (even minor), not mainline 1.31 |
| gitleaks | `zricethezav/gitleaks:v8.30.1` | Local secret scan; no hosted service |

Planned for later milestones (versions re-checked when installed, same 7-day rule):
- M2 (installed): Prisma ORM **7.10.0**, upgraded to **7.10.1** on 2026-10-26 for dependency advisories (see ADR-013) (`prisma`, `@prisma/client`, `@prisma/adapter-pg`). 7.10.1 was blocked by the 7-day rule (published 2026-10-15). npm's `latest` tag points to 8.0.0-rc.23, a release candidate; 7.x is pinned explicitly.
- M2 (installed): **@node-rs/argon2 2.2.2** for Argon2id instead of `argon2`: maintained, defaults to Argon2id, prebuilt binaries with no install script (fits `allowBuilds`). Parameters: 19 MiB, t=2, p=1 (`packages/database/src/passwords.ts`).
- M3 (installed): express-session 1.19.0 + connect-redis 10.0.0 (Redis session store), @playwright/test 1.64.1 (Chromium only), zod schemas in @trp/contracts validated by Nest's `StandardSchemaValidationPipe` (ADR-015) instead of the planned class-validator/class-transformer.
- M7: nestjs-pino 5.x / pino-http for structured logs with request IDs.

Install-script policy: pnpm runs dependency install scripts only when listed in `allowBuilds` (`@swc/core`, `prisma`, `@prisma/engines` allowed; `unrs-resolver` denied because pnpm already installs its native binary).

Follow-up (found 2026-10-21): npm now marks ESLint 9.39.5 as unsupported. ESLint is a development tool only, and ESLint 10 still breaks eslint-config-next's plugins. Re-check before M8; options are ESLint 10 once Next's plugins support it, or configuring the Next/React plugins directly.

## ADR-011 — Lightweight Claude project context

Status: selected.
Keep CLAUDE.md concise, explicitly read the relevant plan/architecture sections, and keep a short session_state.md.
Reason: preserves project intent across sessions without loading a large duplicate requirements set on every task.
Consequence: no mandatory vector database, Claude web Project upload, or extra tool integrations. Reusable prompts live in docs/prompts.md.

## ADR-012 — Windows PowerShell + Docker Desktop; apps on the host in development

Status: selected in M1.
Infrastructure (3× Postgres, Redis, Nginx) runs in Docker Compose. In development, Next.js and NestJS run on the Windows host (`pnpm dev`) bound to 127.0.0.1, and the Nginx container reaches them through `host.docker.internal`. The replica demo runs production images of both apps inside Compose (`pnpm demo:up`).
Reason: fast hot reload without Windows bind-mount file-watching problems; WSL2 has only the docker-desktop distro on this machine. Verified that the container reaches loopback-bound host ports.
Consequence: databases/Redis publish loopback-only ports (5433–5435, 6380) for host apps and inspection tools. Package scripts avoid shell-specific syntax; setup and secret-scan helpers are Node scripts.
Update 2026-10-27 (M5 merge check): Docker 29 maps `host.docker.internal` to an IPv4 and an unreachable IPv6 address. With Nginx's default `max_fails=1`, the IPv6 address was always marked down and one refused or closed connection (dev API restarting) marked the IPv4 one down too, so for 10 s every request got 502 "no live upstreams". This caused the intermittent E2E failures previously blamed on the PC resuming. `dev.conf` now uses `max_fails=0`: a failed connect still moves to the other address at once, but the single real host is never taken out. The demo config keeps passive health checks because it has two real replicas.

## ADR-013 — Supply-chain guards for dependencies

Status: selected in M1.
pnpm `minimumReleaseAge: 10080` (7 days), `allowBuilds` allowlist for install scripts, exact versions, committed lockfile, exact image tags, local gitleaks scan.
Reason: compromised packages are typically discovered within days of publication; install scripts are the usual execution path.
Consequence: brand-new patch releases are adopted a week late. An urgent security fix can be added to `minimumReleaseAgeExclude` with a note.

Applied 2026-10-26: the M4 pre-merge check found `next build` refusing to finish (Next.js security gate). `pnpm audit`: next 16.4.0 (2 critical RCE, 1 high DoS; patched 16.4.1+), body-parser 2.3.0 and multer 2.4.0 (high DoS, via @nestjs/platform-express), deepmerge-ts and mysql2 (via the Prisma CLI), fast-uri (via the Nest CLI). Fixed: next and eslint-config-next 16.4.2, Prisma 7.10.1 (brings patched mysql2 and deepmerge-ts), and pnpm `overrides` body-parser 2.4.0 + multer 2.5.0 with a temporary `minimumReleaseAgeExclude` (both published 2026-10-22; remove the exclusion after 2026-10-29). Result: `pnpm audit --prod` reports no known vulnerabilities. Deferred: fast-uri 3.1.9 (dev tooling only, moderate/low) until it passes the 7-day rule. Exposure note: the app uses neither next/image with SVG, `use cache`, Server Actions, nor file uploads.

Applied 2026-10-27: the M8 pre-merge check found GHSA-6pq8-jhm2-2vcw (moderate DoS in `qs.stringify` with `arrayFormat: 'comma'`; qs 6.16.0 via express). The app never calls `qs.stringify` (Express only parses query strings), so exposure is unlikely, but the gate stays strict: pnpm `overrides` qs 6.16.1, published 2026-10-14, so no release-age exclusion was needed. `pnpm audit --prod` is clean again; the full audit lists only the deferred dev-only fast-uri findings.

## ADR-014 — Migration workflow, database roles, and test databases

Status: selected in M2.
- Migrations are committed SQL. The first migration per schema came from `prisma migrate diff --from-empty --to-schema`; security rules (RLS, CHECK constraints, grants) are a hand-written migration because Prisma's schema language cannot express them.
- `prisma migrate dev` is not used: it needs a shadow database and CREATEDB, which trp_migrator deliberately lacks. New migrations: `prisma migrate diff --from-config-datasource --to-schema <schema> --script` against the migrated dev database, reviewed, then applied everywhere with `pnpm db:migrate:all`.
- trp_migrator owns the `public` schema but cannot create schemas; Prisma's generated `CREATE SCHEMA IF NOT EXISTS "public"` line was removed from the init migrations.
- Every migration that creates a table must grant trp_runtime explicitly (no default privileges), so new tables are unreachable until someone decides their access.
- Integration tests use isolated `*_test` databases on the same servers, created by `test:prepare` (local superuser only for CREATE DATABASE) and reset by the tests; they never touch seeded demo data.
Reason: least privilege for every role, reviewable SQL, and tests that can safely write and truncate.
Consequence: slightly more manual migration steps than `migrate dev`.

## ADR-015 — Authentication mechanics

Status: selected in M3.
- **Validation:** request bodies are zod `strictObject` schemas in @trp/contracts, attached with `@Body({ schema })` and checked by a global `StandardSchemaValidationPipe` subclass that also fails if a body has no schema. The browser forms use the same schemas. Replaces class-validator + class-transformer (the latter unreleased since 2021).
- **Sessions:** express-session + connect-redis, cookie `trp.sid` (HttpOnly, SameSite=Lax, Secure for any https origin; config refuses plain http unless loopback). `saveUninitialized: false`, `rolling: true`, Redis TTL = 30-minute idle; the 8-hour absolute limit is stored in the session and checked by the guard. Session id regenerated at login.
- **CSRF:** synchronizer token stored in the session, sent as `X-CSRF-Token`, compared in constant time, plus an exact `Origin` match, on every unsafe request including login and logout. Token rotates at login.
- **Authorization data:** the guard re-reads user + membership + organization on every protected request and compares `sessionVersion`; nothing about roles is cached.
- **Limits:** fixed windows in Redis (`MULTI INCR / EXPIRE NX / TTL`), counted before Argon2: 5 per account and 30 per IP per 15 minutes, 60 anonymous sessions per IP, 5 password-change attempts per user. Emails appear in keys only as SHA-256 prefixes.
- **Fail closed:** session-store or limiter errors return 503; identity lookups that fail return 503.
- **Client IP:** Express `trust proxy = loopback, uniquelocal`; Nginx overwrites X-Forwarded-For. A process on the API host could still spoof it (the API binds 127.0.0.1 in development).
Consequence: one extra control-database read per protected request, and Redis is required for any signed-in activity.

## ADR-016 — Tenant context, visibility, and pagination

Status: selected in M4.
- **Tenant context** = organization id, user id, role, shard key, built only from the membership the auth guard just loaded. The directory entry is fetched in that same control query (no extra round trip). No route accepts a tenant, shard, or owner parameter; strict schemas reject them.
- **One door to tenant data:** `TenantDbService.run(ctx, work)` = `withTenant` on the caller's shard + mapping connection failures to 503. Queries still filter `tenant_id` explicitly; RLS is the second line (a test removed the app filter and isolation held).
- **Visibility:** employees see only their own requests (list, detail, dashboard). Managers/admins see the company, and may switch to "mine". An employee asking for `scope=company` gets 403 (they asked for something their role cannot have); a record outside scope gets 404 (do not confirm it exists).
- **Pagination:** keyset on (createdAt desc, id desc), page size 20 (max 100), one extra row decides `hasMore`, no total counts. Cursor = base64url JSON + HMAC-SHA256 with CURSOR_SECRET, bound to endpoint, tenant, scope (incl. user for "mine"), and filters; any mismatch is 400.
- **Display names** for user ids on tenant rows: one batched control query per page, restricted to the caller's organization.
- **Availability:** a missing directory entry or an unreachable shard is 503 for that company only; other companies keep working (tested with shard B down).
Consequence: tenant data requires a healthy control database (for the guard) and the company's own shard.

## ADR-017 — Decisions and the request audit trail

Status: selected in M5.
- **Single winner without locks held by the app:** a decision is one shard transaction: tenant-scoped lookup (404), self-review check (403), then `UPDATE ... WHERE id AND tenant_id AND status = 'PENDING' AND version = expectedVersion` that also increments `version`. Zero rows updated means another reviewer won or the caller's copy is stale: 409. Postgres serialises the competing UPDATEs on the row and re-checks the WHERE after the first commits, so this holds across API replicas.
- **Audit with the change:** the decision audit event is inserted in the same transaction; any failure (proven by revoking the runtime role's INSERT) rolls the decision back. Metadata is an allowlist (`from`, `to`, `version`, `hasComment`); the comment text stays on the request row.
- **Defence in depth:** the database CHECK `requests_no_self_review` and the PENDING/reviewer CHECK back up the service rules; the runtime role has no UPDATE/DELETE on audit rows.
- **Admin audit view:** `GET /admin/audit`, ADMIN only (current role), newest first with the M4 signed cursor (endpoint "audit"), same-shard join for request titles, batched actor names.
- **Roles:** checked in services from the freshly loaded membership (`requireRole`), not with a generic roles framework.
Consequence: a reviewer who loses a race sees a 409 and reloads; nothing retries automatically.

## ADR-018 — Company user administration and the last-admin guard

Status: selected in M6.
- **Pessimistic lock, not a conditional update:** the rule "at least one active admin" spans several rows, so no single-row `WHERE` can protect it. Every admin write (create, role change, enable/disable) runs in one control transaction that first takes `SELECT ... FROM organizations WHERE id = $org FOR UPDATE`. Writes of the same company queue on that row; other companies are unaffected. Only after the lock does the service read the target and count active admins (ADMIN role, active membership, active identity), so it sees what the previous writer committed.
- **Caller re-checked inside the lock:** the session guard already re-reads the role, but another admin may demote the caller between the guard and the lock. The service re-reads the caller's membership after locking and returns 403 if they are no longer an active admin.
- **Proof:** with `FOR UPDATE` removed, the race test (two admins demoting themselves or disabling each other at the same moment) failed: both requests succeeded and the company had no admin. With the lock, 30 rounds over three runs always left exactly one.
- **Accounts:** the temporary password is hashed with Argon2id before the transaction (the lock is never held during hashing); user, membership and `MEMBER_CREATED` event commit together; `mustChangePassword` is set. Emails are globally unique: a duplicate in any company gets one generic 409 that never names the company.
- **Disable revokes sessions:** disabling also increments the user's `sessionVersion`, so re-enabling later does not revive sessions issued before the disable.
- **Audit:** `MEMBER_CREATED` (role), `MEMBER_ROLE_CHANGED` (from, to), `MEMBER_DISABLED`, `MEMBER_ENABLED` in `control_audit_events`, same transaction; a no-op change writes nothing. No password, email or free text in metadata.
- **Error code:** `LAST_ADMIN` (409) lets the UI explain the refusal. Admins may change their own role or status when another active admin remains.
Consequence: admin writes of one company are serialized (fine at MVP scale); there is no control-audit viewer yet (only request audit is in scope).

## ADR-019 — Dashboard cache, shared API limit, and operational signals

Status: selected in M7.
- **Cache-aside in Redis, 5 s TTL:** `trp:cache:v1:dashboard:<tenant>:company` and `...:<tenant>:mine:<user>`. The scope is authorized from the freshly loaded role before the key is built or read. A miss reads the database and stores the result with `SET ... EX`. `v1` lets a shape change ignore old entries.
- **Invalidation after commit:** create and decide delete the company key and the submitter's own key after the shard transaction commits. A failed delete is logged and the TTL bounds staleness. Counts are eventually consistent; request detail and every authorization decision always come from the database.
- **Fail open for the cache only:** any Redis error or unreadable value is treated as a miss (logged with the error class, no key contents). Sessions and limits keep failing closed with 503 (M3).
- **Per-user API limit:** a third global guard after the session guard: `rl:api:<tenant>:<user>`, 120 per 60-second fixed window (`API_LIMIT_PER_MINUTE`), reusing the atomic `RateLimitService` (429 + `Retry-After`). Public routes have their own login/session limits. Integration tests raise the limit; the limit test lowers it to 5 and uses two app instances sharing one key prefix.
- **Readiness includes migrations:** `prisma/list-migrations.mjs` (run by `generate`) bakes the committed migration names into `@trp/database`. Readiness reads `_prisma_migrations` in control and both shards and is unready if any expected migration is missing or any is failed or in progress. Migration `20261027120000_runtime_reads_migration_history` grants the runtime role `SELECT` only on that table (checked by `db:verify`).
- **Observability:** one JSON log line per request (`requestId`, `instance`, `method`, path without query string, `status`, `durationMs`; `LOG_REQUESTS`). `X-Instance-ID` only when `EXPOSE_INSTANCE_ID=true`, which only the demo replicas set. `X-Dashboard-Cache: hit|miss` is evidence for tests and the demo.
- **Shutdown:** unchanged from M1/M2: `enableShutdownHooks` closes the HTTP server, Prisma pools and Redis on SIGTERM.
Consequence: dashboard numbers can lag by up to 5 seconds in races; a Redis outage logs users out and returns 503 for protected work, while the dashboard alone would have survived.

## ADR-020 — Replica evidence and the demo check

Status: selected in M8.
- **Same artifact everywhere:** `demo:up` builds `trp-api:local` and `trp-web:local` once; api-2 and web-2 run the very same images (`pull_policy: never`). Both web copies therefore serve identical hashed asset names, which `demo:verify` compares.
- **No Next.js instance key:** the app has no Server Actions and no shared Next.js data cache (private data is fetched by the browser from `/api/v1`; pages are `no-store`), so nothing needs `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` or a shared cache handler. Adding Server Actions later would require one shared key in both web containers.
- **`pnpm demo:verify` is non-destructive:** HTTP checks through the proxy (readiness incl. migrations, both API and web replicas, one session on both API replicas, CSRF and Origin refusals, a tenant field refused, a cache hit, employee scope, the shared 120/min limit), then the read-only `db:verify`. It creates nothing; it signs in two Cedar accounts once each and leaves the employee throttled for up to a minute.
- **Failure behaviour is shown, not automated:** stopping and starting containers stays a manual step (README "Replica demo", docs/demo.md section 7), because a verification command should not change the running system.
- **Shutdown evidence:** `DatabaseService` logs `Database pools closed (SIGTERM)` from its shutdown hook. Exit code 143 after `docker stop` is Nest re-raising SIGTERM after the hooks ran, well within the 15 s grace period (a forced kill would be 137). Successful health probes are not request-logged, so the container log stays readable.
Consequence: the demo proves horizontal scaling of stateless processes on one machine; the stateful stores (Postgres, Redis) remain single instances.

## Deferred questions / parking lot

| ID | Question | Treatment |
| --- | --- | --- |
| A-01 | Does the mentor mean a standalone identity provider by "user pool"? | Proceed with chosen interpretation; review before auth implementation if mentor clarifies |
| A-02 | Are locally running open-source packages/containers permitted? | Assumed yes; no hosted runtime services |
| Q-01 | What is the final deadline? | Not provided; use ordered gates, not invented delivery dates |
| Q-02 | Which Git host/remote and work identity? | Identity confirmed by user in M0: global `Tanvi <tanvi.jain@fiftyfivetech.io>`. Remote `origin` = https://github.com/tnvi55/team-request-portal.git (provided by the user 2026-10-21); push the user-selected branch only, never force-push |
| Q-03 | Which OS shell will be used? | Resolved: Windows PowerShell + Docker Desktop (ADR-012) |

Add new ADRs only for meaningful choices. Keep resolved facts in their owning document; do not grow this file with every minor code edit.

