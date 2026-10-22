# Learning notes

Plain-language explanations of the backend concepts in this project. Scope and status live in [plan.md](../plan.md); mechanics live in [architecture.md](architecture.md). This file explains *why things work*. Each concept lists where it lives in the code; "not built yet" means the milestone has not landed.

## The big picture in one paragraph

The browser only talks to `localhost:8080`. A reverse proxy (Nginx) sends `/api/*` to the NestJS backend and everything else to the Next.js frontend. NestJS checks who you are (session in Redis), what company and role you have (control database), and which database holds your company's data (directory lookup). It then runs the work inside a transaction on that shard, with a Postgres rule (RLS) that hides other companies' rows. Next.js never touches a database; it renders pages and calls the API.

## Infrastructure

**Monorepo / pnpm workspace.** One Git repo containing several packages (`apps/web`, `apps/api`, `packages/*`). The packages import each other by name without publishing to npm. pnpm is strict: a package can only import dependencies it declares, which catches "works on my machine" bugs.
Where: [pnpm-workspace.yaml](../pnpm-workspace.yaml) (also the 7-day `minimumReleaseAge` and `allowBuilds` supply-chain guards), [package.json](../package.json) scripts.

**Docker Compose.** Describes the local infrastructure (3 Postgres containers, Redis, Nginx) in one file so everyone gets the same versions. Named volumes keep database data when containers stop.
Where: [infra/compose.yaml](../infra/compose.yaml) (dev) and [infra/compose.demo.yaml](../infra/compose.demo.yaml) (replica demo layered on top). Try: `pnpm infra:ps`.

**Reverse proxy and same-origin.** Browsers treat `http://localhost:8080` and `http://localhost:3001` as different origins. Cookies and fetch calls across origins need CORS configuration and are easy to get wrong. Putting pages and API behind one proxy origin removes that whole problem.
Where: [infra/nginx/dev.conf](../infra/nginx/dev.conf). Note the `location /api/` block: no path after `http://api`, so `/api/v1/...` reaches Nest unchanged. In [demo.conf](../infra/nginx/demo.conf), `zone` makes all Nginx worker processes share one round-robin counter; without it every request went to api-1.

**Liveness vs readiness.** Liveness answers "is the process running?" (if not, restart it). Readiness answers "can it serve requests right now?" (are Postgres and Redis reachable?). A process can be alive but not ready; the proxy/orchestrator should then stop sending it traffic instead of restarting it.
Where: [health.controller.ts](../apps/api/src/health/health.controller.ts), [health.service.ts](../apps/api/src/health/health.service.ts), tested in [health.int-spec.ts](../apps/api/test/health.int-spec.ts). Try: `docker compose --env-file .env -f infra/compose.yaml stop redis`, then open /api/v1/health/ready (503) and /live (200).

**Environment variables and secrets.** Configuration that differs per machine (database URLs, signing secrets) is read from environment variables, validated at startup, and stored in an ignored `.env` file. `.env.example` documents the names with fake values and is committed.
Where: [.env.example](../.env.example), [scripts/local-setup.mjs](../scripts/local-setup.mjs), validated at API startup by [env.ts](../apps/api/src/config/env.ts) (errors name the variable, never its value).

**Graceful shutdown.** `docker stop` sends SIGTERM. Nest's shutdown hooks stop accepting requests, let in-flight ones finish, and close pools/Redis. Exit code 143 means "ended by SIGTERM after cleanup"; 137 would mean Docker had to force-kill it after the grace period.
Where: [app.setup.ts](../apps/api/src/app.setup.ts) (`enableShutdownHooks`), `onApplicationShutdown` in health.service.ts, `stop_grace_period` in compose.demo.yaml.

**Database roles (least privilege).** Each database gets `trp_migrator` (owns the schema, runs migrations) and `trp_runtime` (what the API uses). Neither is a superuser or has BYPASSRLS. RLS only protects data when the app connects as a role it applies to.
Where: [infra/postgres/init/01-roles.sh](../infra/postgres/init/01-roles.sh).

## Data

**Control database vs tenant shards.** The control database holds who can sign in (User), companies (Organization), who belongs where with what role (Membership), and which shard each company uses (TenantDirectory). The two shards hold business data (Request, RequestAuditEvent). Where: [control schema](../packages/database/prisma/control/schema.prisma), [tenant schema](../packages/database/prisma/tenant/schema.prisma).

**Horizontal sharding, directory-based.** Splitting *rows* (not columns) across separate databases. "Directory-based" means a lookup table decides where each company lives, instead of a hash formula. It is easy to inspect and move a company later; the cost is that the directory becomes a dependency.
Where: `TenantDirectory` table, [directory.ts](../packages/database/src/directory.ts) (`resolveShardKey` throws when an entry is missing), [shard-registry.ts](../packages/database/src/shard-registry.ts). Try: `pnpm db:verify` prints the directory and where each company's rows physically live.

**Migrations.** Versioned SQL files that change the schema step by step, committed to Git. Both shards apply exactly the same history so the code can treat them identically.
Where: `packages/database/prisma/*/migrations`, applied by [migrate-all.ts](../packages/database/src/scripts/migrate-all.ts); workflow in ADR-014.

**Row-level security (RLS).** A Postgres feature: a policy says "only show rows where `tenant_id` equals the current setting". The API sets that setting at the start of each transaction. Even if a query forgets a `WHERE tenant_id = ...`, Postgres still hides other companies' rows. It only works if the app connects as a role that is not a superuser or table owner (FORCE extends it to the owner too).
Where: [RLS migration](../packages/database/prisma/tenant/migrations/20261021120100_rls_checks_grants/migration.sql), [tenant-transaction.ts](../packages/database/src/tenant-transaction.ts), proven by [tenant-isolation.int-spec.ts](../packages/database/test/tenant-isolation.int-spec.ts). Turning RLS off on the test shard made 8 of 16 tests fail.

**Transactions.** A group of statements that either all commit or all roll back. "Update request + insert audit row" in one transaction means you never have a decision without its audit record. Transactions cannot span two separate databases, which is why request audits live on the shard and account audits live in control. Not built yet (M4/M5).

**Optimistic concurrency (version check).** Each request has a `version` number. A decision runs `UPDATE ... WHERE status='PENDING' AND version=<what the reviewer saw>`. If two managers click at the same time, only one UPDATE matches; the other gets 0 rows and the API returns 409. Not built yet (M5).

**Row lock (pessimistic concurrency).** `SELECT ... FOR UPDATE` makes other transactions wait. Used to stop two admins from demoting each other at once and leaving a company with no admin. Not built yet (M6).

**Cursor pagination.** Instead of "page 3" (OFFSET, which skips or repeats rows when data changes), the server returns an opaque cursor pointing at the last row seen. The next page continues after it. The cursor is signed so a caller cannot edit it to read another company's data. Not built yet (M4).

**Idempotent seed.** Running the seed twice must not duplicate data. Rows get deterministic ids (a hash of "atlas:request:7"), inserts skip duplicates, and existing users are never overwritten.
Where: [seed.ts](../packages/database/src/scripts/seed.ts), [seed-data.ts](../packages/database/src/scripts/seed-data.ts).

**Database CHECK constraints.** Rules the database itself refuses to break, even if application code has a bug: no self-review, a rejection needs a comment, titles 3-120 characters.
Where: the same RLS migration file.

## Authentication and security

**Password hashing (Argon2id).** Passwords are never stored. A slow, memory-hard hash is stored instead; login hashes the attempt and compares. Slowness makes brute-forcing a stolen database expensive.
Where: [passwords.ts](../packages/database/src/passwords.ts) (used by the seed in M2; login uses it in M3).

**Cookie sessions vs JWT.** A session cookie holds a random ID; the real session data is in Redis. To log someone out, delete the Redis key. A JWT holds the data itself and stays valid until it expires, which makes instant revocation harder. Either can work with stateless app processes; sessions are simpler here.
Where: [session.middleware.ts](../apps/api/src/auth/session.middleware.ts). Proven in M3: one login served by both demo API replicas, and still valid after one replica stopped.

**HttpOnly, SameSite.** HttpOnly means JavaScript cannot read the cookie, so a script injection cannot steal it. SameSite=Lax means the browser does not send it on most cross-site requests.
Where: `sessionCookieOptions` in session.middleware.ts; the browser test checks `document.cookie` cannot see it.

**CSRF.** A malicious site can make your browser send a POST to our app with your cookie attached. Defence: every unsafe request must also carry a secret token the malicious site cannot read, plus a matching Origin header.
Where: [csrf.guard.ts](../apps/api/src/auth/csrf.guard.ts); the token comes from `GET /api/v1/auth/csrf` and the web client sends it in [api.ts](../apps/web/src/lib/api.ts).

**Session fixation and rotation.** If an attacker can plant a session ID before you log in and the app keeps it, they share your logged-in session. Rotating (issuing a new ID) at login prevents that.
Where: `regenerateSession` in [auth.controller.ts](../apps/api/src/auth/auth.controller.ts). Removing that one line made the fixation test fail.

**Authentication vs authorization.** Authentication: who are you (session). Authorization: what may you do (current role in the control database, re-read on every request so a demotion takes effect immediately).
Where: [session-auth.guard.ts](../apps/api/src/auth/session-auth.guard.ts) + `loadActivePrincipal` in auth.service.ts. Role checks per endpoint arrive in M4.

**Tenant context.** A server-built object (`tenantId`, `userId`, `role`, `shardKey`) derived from the session and current membership. Request bodies cannot supply or override it. Not built yet (M4).

**Validation at the boundary.** Every request body is checked against a zod schema that rejects unknown fields, so a caller cannot sneak in `role: "ADMIN"`. The same schema validates the browser form.
Where: [contracts auth.ts](../packages/contracts/src/auth.ts), [schema-validation.pipe.ts](../apps/api/src/common/schema-validation.pipe.ts).

**404 vs 403.** 403 = "you are logged in but your role cannot use this endpoint". 404 for another company's record = do not even confirm it exists. Not built yet (M4).

**Rate limiting.** Counting requests per user/IP in Redis and returning 429 past a limit. Stored in Redis (not process memory) so two API copies share one count.
Where: [rate-limit.service.ts](../apps/api/src/redis/rate-limit.service.ts); login limits in auth.service.ts (M3), general API limits in M7. A test runs two API instances against one counter.

## Scaling and operations

**Stateless processes.** The web and API processes keep nothing per-user in memory between requests. Any copy can serve any request, so you can run two and stop one. The *state* still exists, in Postgres and Redis; stateless does not mean the whole system is stateless. Not built yet (M8).

**Cache, TTL, eventual consistency.** Dashboard counts are cached for 5 seconds. After a decision, the cache entry is deleted, but in rare races a count may be up to 5 seconds stale. That is acceptable for counts, never for permissions or request status. Not built yet (M7).

**Fail closed vs fail open.** If the cache is down, fall back to the database (fail open is safe for counts). If the session store or rate limiter is down, refuse with 503 (fail closed), because guessing would let unauthenticated or unlimited traffic through. Not built yet (M7).
