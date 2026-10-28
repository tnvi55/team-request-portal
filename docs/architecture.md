# Technical architecture

Version: 1.1 | 2026-10-19, updated 2026-10-28 | Implemented and verified through M9

Product scope and milestone status are owned by [plan.md](../plan.md). This document owns technical mechanics. [decisions.md](decisions.md) records rationale and unresolved assumptions.

## 1. Components and local topology

Use a modular NestJS backend and a separate Next.js App Router frontend. Sharding is a database concern inside the backend, not a reason to introduce microservices.

~~~mermaid
flowchart TD
    Browser["Browser: localhost:8080"] --> Proxy["Local reverse proxy"]
    Proxy --> Web["Next.js web instances"]
    Proxy --> API["NestJS API instances"]
    API --> Control["Postgres control database"]
    API --> Redis["Redis: shared sessions, limits, cache"]
    API --> Router["Shard router inside NestJS"]
    Router --> A["Postgres shard A: Atlas and Cedar"]
    Router --> B["Postgres shard B: Birch"]
~~~

The diagram includes replica capability. Development starts with one web/API pair; the final demo uses two of each.

- Same browser origin for pages and /api/v1; no cross-origin cookie setup is needed.
- Local Nginx forwards /api/ to NestJS and other paths to Next.js.
- Configure the API's global prefix so Nginx preserves /api/v1 consistently.
- PostgreSQL/Redis stay on the private Compose network; any optional inspection port binds to 127.0.0.1.
- Start with one Redis instance and three PostgreSQL containers with separate named volumes.
- Application flow requires no internet service after dependencies/images are installed.
- In development, Next.js and NestJS run on the Windows host (`pnpm dev`) and the Nginx container reaches them through `host.docker.internal` (ADR-012).
- Production-build demo uses named web-1/web-2 and api-1/api-2 services, or an equivalently explicit setup with verifiable instance IDs.

## 2. Code organization

| Path | Responsibility |
| --- | --- |
| apps/web | App Router pages, client forms, accessibility, and typed API calls |
| apps/api | NestJS modules, guards, controllers, services, health, logging |
| packages/database | Control/tenant Prisma schemas, generated server-only clients, migrations, seed and routing utilities |
| packages/contracts | Browser-safe API response types, enums, and shared constants |
| infra | Compose files, Nginx config, and PostgreSQL role initialization |
| scripts | Cross-platform local setup, migration, seed, and demo orchestration |
| e2e | Playwright browser journeys against the app on :8080 |
| docs | Architecture, decisions, demo, learning notes, roadmap, AI workflow, and references |

Nest modules (`apps/api/src`): Config, Database, Redis (shared client and rate limiter), Auth (sessions, CSRF, guards, login limits), Tenant (tenant context and the scoped shard transaction), People (profiles and batched display names), Requests (requests, decisions, audit list, dashboard cache), Admin (users and projects), Health. Request logging is shared infrastructure.

Use ordinary services and focused query methods. Avoid generic repository frameworks, CQRS/event sourcing, a distributed event bus, and abstraction layers that only wrap Prisma unchanged.

Generated Prisma clients, database URLs, password libraries, and session implementation must never enter the web bundle. Nest DTOs remain the validation authority. The contracts package must not import Nest or Prisma runtime code.

## 3. Identity, membership, and central data

A user pool is the central identity registry used for local sign-in. It is distinct from tenant business data.

| Control model | Important fields and constraints |
| --- | --- |
| User | id UUID; normalizedEmail globally unique; displayName; passwordHash; isActive; mustChangePassword; sessionVersion; timestamps |
| Organization | id UUID; slug unique; name; isActive; timestamps |
| Membership | id UUID; userId unique for this MVP; organizationId; role ADMIN/MANAGER/EMPLOYEE; jobTitle (designation, display only); projectId (same organization, composite FK); isActive; timestamps |
| Project (M9) | id UUID; organizationId; name unique per organization; managerMembershipId (same organization, composite FK); runtime role may only SELECT |
| TenantDirectory | organizationId unique/FK; shardKey restricted to configured shard-a/shard-b |
| ControlAuditEvent | id; organizationId when relevant; actorUserId when known; action; targetId; safe metadata; timestamp; requestId |

The directory stores shard keys, never a browser-supplied URL. Server configuration maps known keys to connection URLs. Fail closed when a mapping is absent/unavailable; never query a different shard as a fallback.

Global email normalization: trim surrounding whitespace and lowercase. Do not apply provider-specific transformations such as stripping dots.

Administrative mutations use the control database only. They do not attempt one transaction across control + tenant shard. For account creation: insert User, Membership, and ControlAuditEvent together. For role/disable changes: lock the organization row, re-check current active-admin count, update, and append the event inside one transaction.

There is no identity deletion in the MVP. Disabling a membership retains historical actor IDs. Identity-level disable is an internal administrative operation, not a cross-company admin capability.

## 4. Tenant business schema

Both tenant databases receive exactly the same schema and migrations.

| Tenant model | Fields |
| --- | --- |
| Request | tenantId; id UUID; title; description; category; status; createdByUserId; reviewedByUserId nullable; reviewComment nullable; createdAt; updatedAt; reviewedAt nullable; version integer |
| RequestAuditEvent | tenantId; id UUID; requestId; actorUserId; action; timestamp; correlationRequestId; safe metadata |

Data model overview. Solid lines are real foreign keys inside one database; dotted lines are scalar ID references across databases (no foreign key is possible).

~~~mermaid
erDiagram
    User ||--o| Membership : "has (one in MVP)"
    Organization ||--o{ Membership : "has"
    Organization ||--|| TenantDirectory : "routed by"
    Organization ||--o{ ControlAuditEvent : "logs"
    Organization ||--o{ Project : "has (M9)"
    Project ||--o{ Membership : "current project (same organization)"
    Membership ||--o{ Project : "manages"
    Request ||--o{ RequestAuditEvent : "logs (FK includes tenantId)"
    TenantDirectory ||..o{ Request : "shardKey selects database; tenantId = organizationId"
    User ||..o{ Request : "createdByUserId / reviewedByUserId (scalar)"
~~~

User, Organization, Membership, Project, TenantDirectory, and ControlAuditEvent live in the control database. Request and RequestAuditEvent live in each tenant shard.

Use composite keys/uniques and foreign keys that include tenantId where appropriate, especially RequestAuditEvent -> Request. Add indexes for tenant/status/category and descending createdAt/id pagination.

Control user IDs are scalar references in tenant records. PostgreSQL foreign keys and Prisma relations do not span these independent databases. Validate user membership in the application; fetch authorized user display data from control in batches if needed. Do not perform N+1 cross-database lookups or copy password data into shards.

Audit metadata uses an allowlist. Store useful state changes, not raw request bodies, password inputs, auth headers, or connection details. Runtime roles may SELECT/INSERT audit records, but never UPDATE/DELETE them. This prevents ordinary application mutations; a database administrator can still modify storage, so do not claim cryptographic tamper-proofing.

## 5. Request trust boundary and database execution

~~~mermaid
flowchart TD
    Input["Incoming API request"] --> Session["Validate shared session"]
    Session --> Identity["Load active user and current membership"]
    Identity --> Role["Check required permission"]
    Role --> Tenant["Build server-owned tenant context"]
    Tenant --> Directory["Resolve configured shard"]
    Directory --> Scope["Run tenant-scoped database transaction"]
    Scope --> Ownership["Check ownership and business rules"]
    Ownership --> Result["Return filtered response"]
~~~

The normal routes have no tenant selector. Reject tenantId/shard/role fields in DTOs. Construct TenantContext from the authenticated membership. Never select a database using an unverified request header, URL, or query parameter.

Implemented in M4 (`apps/api/src/tenant/`, `apps/api/src/requests/`, cursor in `apps/api/src/common/cursor.ts`); rationale in ADR-016. Every business query includes tenantId explicitly. EMPLOYEE list/detail queries also include createdByUserId=currentUser.id. MANAGER/ADMIN can query company records. Return 404 for a record outside the permitted tenant/ownership scope, rather than confirming another tenant's record exists. Return 403 for an authenticated caller lacking an endpoint's role.

### PostgreSQL row-level security

RLS adds a database boundary for companies sharing a shard; it supplements service-level checks.

- Enable AND FORCE ROW LEVEL SECURITY on tenant tables.
- Policies compare the row tenant_id with a transaction-local app.tenant_id setting for reads/writes.
- Missing tenant context must yield no records or deny writes.
- Database table ownership belongs to a migration role, not the runtime role.
- Runtime roles must not be superuser, table owners, or BYPASSRLS.
- A tenant transaction helper uses the selected shard client, opens a transaction, and sets the tenant context with parameterized set_config(..., true).
- Use only the transaction client returned by that helper for scoped operations.
- Do not set tenant context on a pooled connection outside a transaction. It can leak into the next request.
- Test a raw runtime-role query with missing tenant context and attempted cross-company writes.
- Keep raw SQL narrowly scoped to safe RLS setup, role setup, and necessary locking. Never concatenate caller input.

Implemented in M2 (`packages/database/prisma/tenant/migrations/*_rls_checks_grants`): policies compare `tenant_id` with `NULLIF(current_setting('app.tenant_id', true), '')::uuid` (a reset custom setting returns an empty string, so NULLIF turns it into "no tenant"); CHECK constraints enforce title/description lengths, PENDING-vs-decided reviewer state, no self-review, and a rejection comment; trp_runtime has SELECT/INSERT/UPDATE on requests and SELECT/INSERT on request_audit_events. `withTenant` (`packages/database/src/tenant-transaction.ts`) validates the UUID and calls `set_config` with a bound parameter inside `$transaction`.

This is deliberately included because a shared shard should have an independently testable tenant boundary. It adds a small amount of database setup; do not generalize it into a framework.

### Prisma and migrations

Use two schema types: control and tenant. Generate distinct clients for those types; instantiate the tenant client against each known shard URL using the adapter/connection API documented for the selected Prisma version.

Implemented as `ShardRegistry` (`packages/database/src/shard-registry.ts`); the API holds one control client and one registry in `DatabaseService`, pools capped at 5 connections each. Maintain a small singleton client registry keyed by configured shard key. It is configuration/pool reuse, not per-user state. Do not create a Prisma client per request, hold unbounded tenant pools, or choose URLs from input.

Use one tenant migration history and apply it to both physical shards. The migration orchestration must stop and report partial failure; compare migration status before considering the environment ready. No automatic schema modification during HTTP requests. Do not use db push as a substitute for committed migration history.

## 6. Local session authentication

Implemented with maintained session middleware and a Redis-backed store: express-session with connect-redis (ADR-010, ADR-015).

Session payload: userId, sessionVersion at login, createdAt/absoluteExpiry, and CSRF material. Tenant/role may be displayed from /auth/me, but authorization always re-reads current control data.

Initial limits: 30-minute idle expiry and 8-hour absolute expiry. Store expiry on Redis keys and check absolute expiry independently. Rotate the session identifier after successful authentication. Regenerate session/CSRF material after changes to privilege-sensitive authentication state.

Cookie settings:
- HttpOnly; Path=/; SameSite=Lax; omit Domain.
- secure=false only for explicit loopback HTTP development.
- secure=true is required for any HTTPS deployment; do not silently expose HTTP outside loopback.
- Use one stable cookie name (for example trp.sid) and the same signing secret across API replicas.
- Clear the cookie using matching attributes on logout.

Passwords:
- Use Argon2id via a maintained library (@node-rs/argon2), with the OWASP baseline (19 MiB memory, 2 iterations, parallelism 1). Benchmarking on target hardware is a known gap.
- Validate 12–128 characters; allow spaces, Unicode, paste, and password managers.
- No plaintext passwords in PostgreSQL, audit, logs, Redis, or Git.
- Return a generic invalid-credentials result for unknown/disabled users and bad passwords; use comparable hash work for unknown accounts.
- Rate-limit before expensive password verification.
- Password change requires the current password and increments User.sessionVersion in the control transaction.
- Every authenticated request compares sessionVersion with the current identity. After password change, destroy the current session and require login; old sessions also fail validation.
- Admin-created users must change their temporary password before business access. Never display it again after creation.

CSRF:
- GET /auth/csrf creates/uses an anonymous session and returns a session-bound synchronizer token.
- Unsafe browser requests include X-CSRF-Token and an Origin matching the configured app origin exactly.
- Protect login, logout, password changes, and business writes.
- Rotate CSRF material at login; the frontend fetches a fresh token afterward.
- No permissive credentialed CORS. The normal web app uses one origin.
- Mark auth and private data responses Cache-Control: no-store.

Implemented in M3: `apps/api/src/auth/` (session middleware, CsrfGuard, SessionAuthGuard, AuthService, AuthController), shared Redis client and limiter in `apps/api/src/redis/`, error shape in `apps/api/src/common/`. Details and trade-offs: ADR-015.

Role/disable revocation:
- Re-read user + membership + organization on every protected call, without an authorization cache.
- Updating a role affects the next protected call even on another API instance.
- Disabling membership blocks access even if its Redis session still exists.
- An in-flight request already authorized may complete; do not claim instant cancellation of work already executing.

## 7. Endpoint map

Paths below are relative to /api/v1. Business success responses use explicit DTOs; errors use the shape below.

| Method/path | Access | Purpose |
| --- | --- | --- |
| GET /auth/csrf | Public, session-backed | Obtain CSRF token |
| POST /auth/login | Public + CSRF + login limits | Authenticate and rotate session |
| GET /auth/me | Any authenticated identity | Current identity, membership, password-change flag, profile (designation, project, manager, managed projects) |
| POST /auth/logout | Authenticated + CSRF | Destroy current session |
| POST /auth/change-password | Authenticated + CSRF | Validate old password, change hash, revoke sessions |
| GET /dashboard | Full active membership | Counts for own/company permitted scope |
| POST /requests | Full active membership | Create request and audit atomically |
| GET /requests | Full active membership | Cursor list; employees restricted to own records |
| GET /requests/:id | Authorized owner/reviewer | Read a permitted request |
| POST /requests/:id/decision | MANAGER/ADMIN + not submitter | Decide pending request atomically |
| GET /admin/users | ADMIN | Cursor list of own company's users |
| POST /admin/users | ADMIN | Create local user + membership + control audit |
| PATCH /admin/users/:membershipId | ADMIN | Change role, active state, designation, or project in own company |
| GET /admin/projects | ADMIN | Own company's projects with manager and member count |
| GET /admin/audit | ADMIN | Cursor list of own company's request audit events |
| GET /health/live | Public (probes) | Process is alive |
| GET /health/ready | Public (probes, `demo:verify`); only up/down per dependency | Required dependencies/migrations are ready |

"Full active membership" excludes mustChangePassword sessions.

Decision body: decision APPROVED/REJECTED, expectedVersion nonnegative integer, optional/required comment according to plan.md. Request IDs are validated UUIDs. Use whitelist validation with unknown fields rejected.

Error body: { code, message, requestId, details?, attemptsRemaining? } (attemptsRemaining only on a failed sign-in). Examples: 400 invalid input/cursor; 401 missing/invalid session; 403 wrong role/self-review/CSRF; 404 inaccessible record; 409 stale/already-decided request or protected last-admin change; 429 shared rate limit; 503 unavailable required dependency. Never expose stack traces or database error text.

The contracts are the zod schemas and TypeScript types in `packages/contracts`, used by both the API and the web forms. No Swagger UI or debug endpoint is exposed; generated OpenAPI documentation is future scope (docs/roadmap.md).

## 8. Transaction patterns and race handling

### Submit

Inside one tenant-scoped shard transaction: insert PENDING Request; insert REQUEST_CREATED audit; commit. Respond only after commit, then invalidate applicable dashboard keys. If auditing fails, the request must not remain committed.

### Decide

1. Validate current role and membership.
2. Open the selected tenant transaction; scope the query by tenant and ID.
3. Reject self-review.
4. Conditionally update where status=PENDING and version=expectedVersion, incrementing version.
5. If no row was updated, return 409 for the accessible request's stale transition.
6. Insert exactly one decision audit event using the successful resulting state.
7. Commit; then invalidate dashboard cache.

Two reviewers deciding the same request at the same time:

~~~mermaid
sequenceDiagram
    participant M1 as Manager 1 (api-1)
    participant M2 as Manager 2 (api-2)
    participant S as Shard A (Postgres)
    M1->>S: BEGIN; set_config('app.tenant_id', Atlas, true)
    M2->>S: BEGIN; set_config('app.tenant_id', Atlas, true)
    M1->>S: UPDATE ... SET APPROVED, version=4 WHERE status=PENDING AND version=3
    M2->>S: UPDATE ... SET REJECTED, version=4 WHERE status=PENDING AND version=3
    Note over S: M2 waits on M1's row lock
    M1->>S: INSERT audit REQUEST_APPROVED; COMMIT
    S-->>M2: 0 rows (row now APPROVED, version 4)
    M2->>S: ROLLBACK
    Note over M1,M2: M1 gets 200; M2 gets 409; exactly one audit event
~~~

Implemented in M5 as `RequestsService.decide` (ADR-017); verified with 10 concurrent approve/reject pairs per test run and across both demo API replicas.

Do not use a read-then-unconditional-update sequence. Row locking or conditional updates must prevent concurrent decisions. Fault-injection tests can use a test-only repository seam; do not add a public "make audit fail" endpoint.

### Account/role mutation

All relevant data is in control. Use a transaction and organization row lock before counting active admins and changing active/role fields. All paths that can remove an active admin must use this rule.

Implemented in M6 in `apps/api/src/admin/users.service.ts` (ADR-018): every admin write locks the organization row, re-checks the caller is still an active admin, then changes rows and appends the control audit event in the same transaction. Disabling also increments `sessionVersion`. Verified with 10 concurrent removal rounds per test run, a mutation check without `FOR UPDATE`, and across both demo API replicas.

No distributed transactions: an account/admin audit is in control; a request/business audit is in its tenant shard.

## 9. Pagination and cache behavior

Cursor pagination:
- Default page size 20; maximum 100; reject invalid/oversized inputs.
- Stable descending order by createdAt and id (audit uses timestamp and id).
- Use a bounded opaque cursor signed with a shared server secret using standard library HMAC.
- Bind the cursor to tenant, caller's authorized scope, endpoint, and filters. Invalid/tampered/mismatched cursors return 400.
- Never trust cursor contents to establish tenant context or grant a wider scope.
- Return items, nextCursor, and hasMore. No unnecessary total count query per page.
- Test duplicates/gaps over a static fixture, equal timestamps, empty results, filter mismatch, and invalid signatures.

Dashboard caching:
- Reviewers: key contains tenantId + company scope.
- Employees: key contains tenantId + own scope + userId.
- Prefix keys with app/schema version to permit safe changes.
- Initial TTL: 5 seconds. TTL is a bounded lifetime of a cached value; race/failure behavior is eventually consistent, not strict read-after-write consistency.
- Invalidate applicable own/company keys after committed mutations. Correct authorization is checked before reading cache.
- On post-commit invalidation failure, keep the successful business response and log safe diagnostics; expiration handles stale data.
- Never use cached counts or roles to authorize writes or decisions.
- Request detail and mutation responses use authoritative database state.
- A cache read/write failure falls back to scoped DB queries.

Implemented in M7 (ADR-019): `apps/api/src/requests/dashboard-cache.service.ts` (keys, TTL, fail-open), invalidation in `RequestsService.create/decide`, `X-Dashboard-Cache` header; the per-user limit is `apps/api/src/auth/api-rate-limit.guard.ts`.

Redis:
- Prefix session, pre-auth/CSRF, rate, and cache keys distinctly.
- Use bounded TTLs and noeviction so dashboard cache pressure cannot silently evict authentication/limit state.
- Configure a local memory cap and observe failures. Session or rate-limit storage failures reject protected/unsafe work with 503; they must not permit unlimited or unauthenticated work.
- Losing Redis may log users out; stateless processes do not imply the datastore is highly available.
- Login defaults: 5 attempts/15 minutes per normalized-identifier key and 30 attempts/15 minutes per IP. Atomically count attempts before hashing, including successful attempts; expire each fixed window rather than resetting counters on success. Return Retry-After on 429. Avoid raw emails in logs/metrics.
- Authenticated API default: 120/minute per user + tenant; make test thresholds configurable.
- Use atomic Redis operations or a maintained distributed limiter.
- Trust forwarded IP headers only from the known reverse proxy; direct client-supplied headers must not bypass limiting.
- Limit CSRF/session creation as well as login so anonymous callers cannot create unlimited Redis keys.

## 10. Stateless Next.js and replica behavior

Use Server Components for page shells and Client Components where interactive forms/data are needed. For the simplest MVP, private data is fetched from the browser through same-origin /api/v1 with the session cookie; an auth context handles loading/401/403 and clears private UI state on logout.

NestJS is the only authorization authority. No Prisma access or alternative business writes in Next route handlers/Server Actions. Do not store auth tokens in localStorage. React state and short-lived browser state are fine.

Private pages and API data must not use shared public caching, static generation of user data, or ISR. Serve fonts/assets locally; no CDN or analytics dependency.

For replica demo:
- Run the same built web artifact/image in both web instances and the same API build in both API instances.
- Share cookie signing, cursor signing, app origin, database, and Redis configuration.
- Follow the chosen Next.js version's self-hosting guidance for instance/deployment keys if a feature requires them; this MVP does not need Server Actions.
- Do not rely on sticky sessions or per-instance persistent user state.
- A local-only response header may expose a non-sensitive instance ID as demo evidence; disable it outside demo mode.
- Proxy failure handling can retry safe reads; do not blindly retry POSTs after ambiguous upstream failures.
- A stopped instance may cause a transient failure before proxy detection. Document recovery instead of promising zero downtime.
- Fail closed if the required identity database, session store, or selected shard is unavailable. Never route a company's writes to another shard as recovery.

Verified in M8 (ADR-020): one image per app, so both web copies serve identical asset names; no Next.js instance key is needed (no Server Actions, no shared data cache); `pnpm demo:verify` checks both replicas, one session on both, and the shared limit; stopping api-1 or web-1 kept the app working through the other copy.

## 11. Tests, observability, and operational limits

Run API integration tests against real test PostgreSQL/Redis, including runtime-role RLS. Use isolated database names/Compose project and key prefixes; never point tests at demo data by accident. Unit tests cover pure rules and cursor validation; browser E2E covers role journeys.

Log structured records containing requestId, route, status, duration, and safe instance ID. Include tenant/user/shard identifiers only where useful and appropriate; no private descriptions or secrets. Preserve the same requestId in error responses. Health endpoints expose status, not connection URLs.

Readiness checks all required database connections, Redis, and (since M7) that every committed migration is applied in control and both shards; liveness checks process health independently. This demo can report unready if a shard is down; it does not promise per-tenant availability. On shutdown: stop accepting new work, allow bounded completion, close pools/Redis.

Storage lives in named PostgreSQL volumes. Stop commands do not remove them. Backup/restore is a future operational step (docs/roadmap.md); sharding across one laptop is neither replication nor disaster recovery.

Current limits: one organization per account, fixed shard directory, no cross-shard joins/transactions, short-lived dashboard staleness, one local machine, and no production HA. Describe these in the final README/demo.

