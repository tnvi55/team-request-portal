# Team Request & Approval Portal — implementation plan M1 | M1 | M2 | M2 | M2 | M1 | M1 | M1 (test:e2e: M3) | M1 | M1 | M8 | M1 | M1 |

Version: 1.0 | Created: 2026-10-19 | Status: agreed project direction; implementation not started

## 1. Goal and boundaries

Build a small multi-tenant SaaS application to learn Next.js App Router, NestJS, PostgreSQL, Prisma, Redis, secure authentication, RBAC, transactions, pagination, horizontal sharding, and stateless application processes.

An employee requests equipment or software. A reviewer approves or rejects the request. An organization administrator manages accounts and roles. Independent companies use the same application while their data remains isolated.

This is a local learning implementation with professional engineering practices. A successful laptop demo does not establish production availability, throughput, or operational readiness.

**This file owns product scope, business rules, milestone acceptance criteria, and completion status.** Technical mechanics live in [architecture.md](docs/architecture.md); enduring decisions and assumptions live in [decisions.md](docs/decisions.md); plain-language concept explanations live in [learning.md](docs/learning.md). Avoid duplicating task status elsewhere.

## 2. Interpretation of the mentor's requirements

| Requirement | Chosen interpretation |
| --- | --- |
| Multi-role SaaS | Multiple companies, with organization-scoped ADMIN, MANAGER, and EMPLOYEE roles |
| Auth user pool | NestJS-managed identities in a local central PostgreSQL database; organization membership is separate from identity |
| Database sharding | Directory-based horizontal distribution of tenant business records across two independent local PostgreSQL databases |
| Stateless frontend/backend | Next.js and NestJS processes hold no essential per-user state between requests; sessions and shared limits live in Redis |
| Everything locally | The application runtime uses locally running software and no hosted identity, database, email, storage, or cache service |
| Git evidence | Incremental commits, reproducible setup, tests, architecture diagram, and demo script |

**Assumption A-01:** "user pool" means an identity store, not a mandatory standalone OIDC identity provider. Proceed with the selected NestJS implementation; record this point for mentor review. If the mentor requires a separate identity provider, revise the auth design before implementing M3. Do not add Firebase, Cognito, Clerk, Auth0, or a homegrown OIDC server.

**Assumption A-02:** Open-source libraries and locally running infrastructure are allowed. Claude and the company's Git remote are development tools outside the application runtime. Downloading packages/images is required initially; application flows should work without hosted APIs after setup.

**Assumption A-03:** One organization membership per user in the MVP. The data model keeps identity and membership separate; account switching and multi-organization memberships are deferred.

## 3. Smallest complete product

### In scope

- Login, logout, current-user lookup, and password change.
- Centrally managed local accounts; admins create accounts for their organization.
- Mandatory first-login password change for admin-created temporary passwords.
- Admin can list company users, change their role, and enable/disable their membership.
- All active roles can submit a request and view their own requests.
- MANAGER and ADMIN can list and review company requests.
- MANAGER and ADMIN can approve or reject another user's pending request.
- ADMIN can read company request audit history.
- Paginated request, member, and audit lists.
- Filters by status/category on request lists; tenant-scoped dashboard counts.
- Two real tenant data shards and a central tenant directory.
- Shared sessions, login/API limits, and dashboard caching in local Redis.
- Local startup, migrations, synthetic seed data, tests, and mentor demo.

### Explicitly deferred

Public registration, paid subscriptions, payments, real procurement, stock management, leave calculations, emails, invites, attachments, chat, configurable workflows, background queues, webhooks, external integrations, tenant self-service creation, automatic shard rebalancing, cross-shard reporting, Kubernetes, microservices, and an AI feature inside the application.

Do not add these as "helpful" extras. AI assistance is the development workflow; it is not an additional product requirement.

### Roles and permissions

Roles are explicit organization permissions, not platform-wide privileges.

| Capability | EMPLOYEE | MANAGER | ADMIN |
| --- | --- | --- | --- |
| Create request; read own requests | Yes | Yes | Yes |
| View company request list and details | No | Yes | Yes |
| Approve/reject someone else's pending request | No | Yes | Yes |
| Approve/reject own request | No | No | No |
| Read company request audit history | No | No | Yes |
| Manage company accounts and roles | No | No | Yes |
| Access another company's data | No | No | No |

No global super-admin is exposed in the app. Local bootstrap scripts provision organizations.

### Request fields and rules

- ID: server-generated UUID.
- Title: trimmed plain text, 3–120 characters.
- Description: plain text, 10–2,000 characters.
- Category: EQUIPMENT, SOFTWARE, or OTHER.
- Status: PENDING, APPROVED, or REJECTED; created as PENDING.
- Submitter, reviewer, tenant, timestamps, and version are server-managed.
- Reviewer comment: optional on approval, required on rejection (3–500 trimmed characters).
- A request can be decided once; no reopening, editing, or deletion in the MVP.
- Two simultaneous decisions must produce exactly one committed outcome and one decision audit event. The losing request gets HTTP 409.
- Role/status/tenant fields supplied by a caller cannot override server ownership.
- A disabled membership or user cannot use an existing session on the next protected request.
- All role checks use current control-database values, not a role copied into a session.
- An organization must retain at least one active ADMIN with an active identity. Guard this against concurrent demotions/disables.
- Creating an account also creates its membership and administrative audit event in one control-database transaction.
- Existing global email conflicts return a generic conflict; do not disclose another organization's account details.
- Changing a password invalidates existing authenticated sessions for that identity. The user signs in again.
- "Must change password" sessions can only use current-user, CSRF, password-change, and logout endpoints until changed.

## 4. Required engineering baseline

- TypeScript strict mode; explicit DTO validation and response shapes.
- NestJS modular monolith: controllers delegate to services; Prisma is used through database infrastructure, not directly from controllers.
- A mandatory tenant context derived from authenticated identity and current membership.
- Application-level tenant scoping plus PostgreSQL RLS as defense in depth, as specified in architecture.md.
- HttpOnly session cookies, CSRF protection, session rotation at login, expiry, and revocation.
- Argon2id password hashing through a maintained library; never implement hashing or crypto primitives.
- Shared, bounded Redis rate limits; tenant-aware cache keys and bounded staleness.
- Consistent API errors; structured logs with request ID and no passwords, cookies, session IDs, or connection strings.
- Explicit database migrations for control and tenant schemas; apply the tenant history to BOTH shards.
- Runtime PostgreSQL roles lack superuser/BYPASSRLS privileges; migration and seed roles are separate.
- No per-process sessions, user/role caches, limiter counters, or private Next.js caches.
- Keep real secrets and generated demo passwords out of Git.
- Commit a lockfile and pin verified tool/runtime/container versions.
- Local scripts must work from Windows PowerShell with Docker Desktop, or document WSL2 as the chosen alternative. Avoid Bash-only package scripts.
- Health checks and graceful shutdown. Cache failure may reduce performance; auth/session failure must not grant access.
- Test important behavior and boundaries. Avoid tests that merely assert implementation details.

## 5. Proposed screens and API boundary

Public: /login.
Authenticated: /change-password, /dashboard, /requests, /requests/new, /requests/[id].
Reviewer access: company view on /requests.
Admin: /admin/users and /admin/audit.

All API paths use /api/v1. Exact request/response contracts are generated into OpenAPI during implementation. See architecture.md for the initial endpoint map.

Next.js owns presentation and transient browser state. NestJS owns authentication, authorization, and all business writes. Hiding a button is only UI behavior; the API must enforce the same permission.

## 6. Milestones and gates

Implement one milestone at a time in the order below. Break a milestone into smaller tasks if needed. Each gate requires real command output; do not mark a checkbox just because code exists.

**Priority if time runs short** (no deadline is set yet; see Q-01). Keep the order; cut from the end, never skip a gate:

| Tier | Milestones | Why |
| --- | --- | --- |
| Core (must demo) | M0–M5 | Login, tenant isolation on two shards, atomic decisions + audit: the heart of every mentor requirement |
| Important | M6–M7 | Admin safety, shared limits, cache: completes the "multi-role" and "Redis" requirements |
| Polish | M8 | Two-replica proof and final rehearsal; still required for D07/D09 |

**Learning checkpoint.** Each milestone ends with a "Learn" line. Before ticking the gate, the learner should be able to explain that concept in their own words and try the small exercise against the running code. Plain-language concept notes live in [learning.md](docs/learning.md) and grow with each milestone.

### M0 — baseline and version selection

- [x] Read this pack; inspect the user's project folder before scaffolding.
- [x] Check installed Node, package manager, Docker, Compose, Git, and Claude Code.
- [x] Use Node 24 LTS as the initial target; verify support at implementation time.
- [x] Verify stable, mutually compatible Next.js, React, NestJS, Prisma, database, Redis, and test-tool versions from official docs.
- [x] Use supported Prisma ORM 7 as the starting baseline for this design; do not use a release candidate. Record a deliberate ADR before choosing another major.
- [x] Choose supporting tools with a one-line reason each: unit/integration test runner, HTTP API test client, browser E2E tool, DTO validation, structured logger, session store adapter, Argon2id library, reverse proxy image.
- [x] Record exact selected versions and rationale in decisions.md; pin them in configuration/lockfiles when created.
- [x] Check repository-local Git user.name and user.email and explain them before the first commit; use values supplied by the user.
- [x] Resolve actual blockers; treat ordinary naming/style choices as authorized implementation work.

Status: M0 and M1 gates passed 2026-10-21; evidence in session_state.md and ADR-010/012/013.

Gate: a short baseline report lists compatible versions, missing prerequisites, and the exact M1 scope. No false "installed" claims.

Learn: why pin exact versions and commit a lockfile? Exercise: find the pinned Node/pnpm versions and explain what would break if two developers used different majors.

### M1 — workspace and local infrastructure

- [x] Create a pnpm workspace: apps/web, apps/api, packages/database, and packages/contracts.
- [x] Add ESLint, Prettier, TypeScript strict configuration, root scripts, and lockfile.
- [x] Add local PostgreSQL control, PostgreSQL shard A, PostgreSQL shard B, Redis, web, API, and reverse proxy configuration.
- [x] Bind public development access to loopback; keep databases and Redis off public interfaces.
- [x] Expose a same-origin app at http://localhost:8080.
- [x] Separate liveness from readiness and configure graceful termination.
- [x] Provide a normal development workflow and a production-build replica demo workflow.
- [x] Create validated environment examples without real secrets and a cross-platform local setup script.

Gate: clean setup can start infrastructure and placeholder web/API; live/readiness behavior is exercised. Record which commands actually exist and run.

Learn: reverse proxy, same-origin, liveness vs readiness. Exercise: stop Redis and watch /api/v1/health/ready turn unready while /api/v1/health/live stays OK.

### M2 — schemas, shard routing, and synthetic data

- [x] Define control schema and tenant schema; generate clients separately for the two schema TYPES.
- [x] Reuse the tenant schema/client type with one bounded client/pool per configured shard.
- [x] Add directory mappings: Atlas and Cedar -> shard A; Birch -> shard B.
- [x] Apply all tenant migrations and RLS policies to both shards.
- [x] Seed 3 organizations and ADMIN/MANAGER/EMPLOYEE accounts for each, using synthetic data only.
- [x] Generate demo credentials locally into a Git-ignored file.
- [x] Seed enough requests to exercise pagination (at least 60 per organization, with varied status).
- [x] Provide non-destructive, idempotent migration/seed verification commands.
- [x] Add integration coverage for same-shard tenant isolation as well as cross-shard routing.

Status: gate passed 2026-10-21 (`pnpm db:verify`: 22 checks; 16 isolation tests as trp_runtime; seed run twice with zero new rows).

Gate: database evidence shows identical tenant schema versions, the expected company distribution, forced RLS, and stable counts after running seed twice. Never run destructive reset against an unknown database.

Learn: migrations, directory-based sharding, idempotent seeding, RLS. Exercise: as the runtime role, run a raw SELECT on shard A with no tenant context and explain why it returns zero rows.

### M3 — secure authentication vertical slice

- [x] Implement login page, current-user display, logout, and password-change UI/API.
- [x] Add Argon2id hashes, normalized email lookup, generic login failures, and password validation.
- [x] Store sessions in Redis; rotate session ID/CSRF material at successful login.
- [x] Enforce idle/absolute expiry and identity sessionVersion revocation.
- [x] Implement CSRF and exact allowed-Origin checks on all unsafe requests, including login.
- [x] Introduce shared login throttling now, not after shipping auth.
- [x] Enforce first-login password change and next-request denial after disablement.
- [x] Ensure public responses and private pages use appropriate no-store behavior.

Status: gate passed 2026-10-22 (28 API integration tests against real Postgres/Redis, stable over 4 runs; 3 Playwright browser tests; one session served by both demo API replicas).

Gate: automated tests cover valid/invalid login, logout, fixation prevention, expiry, password change/revocation, disabled accounts, CSRF failures, and shared login limits.

Learn: password hashing, cookie sessions vs JWT, session fixation, CSRF. Exercise: inspect the session key in Redis (not its cookie value), change the password, and show the old session is rejected.

### M4 — tenant context and request creation/listing

- [x] Resolve current membership and directory mapping on every protected request.
- [x] Build tenant-aware database execution and RLS context with the runtime DB role.
- [x] Implement create/list/detail and tenant-scoped dashboard UI/API.
- [x] Create request + creation audit event atomically on the selected shard.
- [x] Implement bounded cursor pagination and validated status/category filters.
- [x] Map employee access to own records; reviewers can view company records.
- [x] Do not allow the browser to choose a shard or bypass membership via a tenant field.

Status: gate passed 2026-10-22 (20 request integration tests + 25 unit tests; Playwright journey: submit, coworker 404, manager company view; replica demo create/read across api-1 and api-2).

Gate: end-to-end user can submit and read a request. An employee cannot read a coworker's record; Atlas cannot read Cedar even though both share shard A; Atlas cannot read Birch on shard B. Guessed IDs and altered query/body fields fail safely.

Learn: tenant context, ownership filters, cursor pagination, 404 vs 403. Exercise: temporarily remove the tenantId filter in a local branch and show the RLS test still blocks Atlas from Cedar; then restore it.

### M5 — review decisions and transactional audit

- [x] Implement approval/rejection UI/API and ADMIN request-audit page.
- [x] Make the pending-state check, version check, decision update, and audit insert one transaction.
- [x] Reject self-review and invalid transitions.
- [x] Prevent request writes without corresponding business audit events.
- [x] Keep runtime audit permissions append-only for the application role.
- [x] Include actor ID, tenant ID, action, entity ID, timestamp, request ID, and safe metadata.

Status: gate passed 2026-10-27 (13 decision integration tests incl. 10 races per run, 40 races over 4 runs; audit-fault rollback; runtime-role audit UPDATE/DELETE denied; Playwright approve + audit journey; concurrent decisions across api-1/api-2 in the replica demo: one 200, one 409, one event).

Gate: concurrent approve/reject gives exactly one success, one 409, and one decision event. An induced audit-write failure rolls back the decision. Direct runtime-role audit UPDATE/DELETE is denied.

Learn: transactions, atomicity, optimistic concurrency (version check). Exercise: explain why "read status, then update" can produce two decisions, and why the conditional UPDATE cannot.

### M6 — company user administration

- [x] Implement company user list, account creation, role update, enable/disable.
- [x] New accounts receive mustChangePassword=true and a temporary password entered by the admin over the local form; never persist the plaintext password.
- [x] Enforce current ADMIN permissions on every write.
- [x] Guard the last active admin with a control-database transaction and organization-level row lock.
- [x] Write administrative audit events in the same control transaction.
- [x] Ensure one active membership maximum per user in this MVP.

Status: gate passed 2026-10-27 (15 admin integration tests: 403 for manager/employee on list/create/update, demoted session 403 and disabled session 401 on the next call, generic 409 for an email used in another company, cross-company 404, audit-fault rollback; 10 concurrent final-admin removal rounds per run, 30 over 3 runs, and a mutation check without FOR UPDATE that failed; Playwright create -> forced password change -> disable journey; demote on one demo API replica seen as 403 on both; one membership per user via the unique memberships.user_id).

Gate: employee/manager admin calls are rejected. Existing sessions observe role/disable changes on the next protected call. Concurrent removal of the final admins cannot leave the organization without an active admin.

Learn: row locks (pessimistic concurrency), authorization from current data. Exercise: demote a manager in one browser and watch their next call in another browser get 403.

### M7 — dashboard caching and operational behavior

- [x] Cache company-wide counts for reviewers and own counts for employees under separate tenant/scope keys.
- [x] Use a short TTL (5 seconds initially) and invalidate after committed mutations.
- [x] Cache failure falls back to the database; log safe diagnostics.
- [x] Use shared authenticated API limits (120 requests per minute per user/tenant initially).
- [x] Use Redis noeviction and distinct key prefixes; session/limiter errors fail closed with an appropriate 503.
- [x] Include request IDs, safe instance markers in local demo mode, health checks, and DB pool cleanup.

Status: gate passed 2026-10-27 (9 integration tests in cache-and-limits.int-spec.ts: miss then hit, stale until a 2 s test TTL then fresh, invalidation after create and decide, separate keys per company and per person, role checked before the cache, DB fallback on a Redis WRONGTYPE error and on an unreadable value, one session and one 5/min counter shared by two app instances, demo-only X-Instance-ID, one structured log line per request without query string; mutation checks: no invalidation after create and no user id in the "mine" key each failed; readiness 503 when a migration is missing; db:verify confirms SELECT-only on _prisma_migrations; replica demo: cache filled by api-2 read by api-1, create on api-1 invalidated api-2, 429 on the 121st call split 63/62 across api-1/api-2; 6/6 E2E against production images).

Gate: verify cache hits, scope isolation, expiry, and post-write invalidation. Count displays are eventually consistent with a five-second initial cache TTL; do not promise strict read-after-write consistency during races/failures. Request detail/status comes from the database. Security/authorization never comes from this cache.

Learn: cache keys and scope, TTL, eventual consistency, fail-open vs fail-closed. Exercise: explain why a cache outage may degrade the dashboard but a session-store outage must return 503.

### M8 — replica evidence, final verification, and Git handoff

- [x] Run production builds of two web and two API instances behind the local reverse proxy.
- [x] Share build artifacts/configuration and required Next.js instance keys; no private persistent web cache.
- [x] Demonstrate one session across API replicas and shared rate limits across replicas.
- [x] Stop one API instance and demonstrate authenticated requests through the surviving instance.
- [x] Show public web pages can be served by either web instance and tenant data remains correct.
- [x] Run lint, typecheck, unit tests, integration tests, browser E2E, and production build.
- [x] Rehearse docs/demo.md, including shard evidence and failure-path behavior.
- [x] Complete README setup/troubleshooting and architecture diagrams.
- [x] Run the local secret scan over the full Git history and confirm no credentials, .env files, or generated demo passwords are tracked.
- [x] Review git diff and staged files, commit logical changes, and push the user-selected branch/remote under the user's normal workflow.
- [x] Record known limitations honestly and update this checklist and session_state.md.

Status: evidence 2026-10-27 (`pnpm demo:verify` all checks passed on the rebuilt replicas: readiness incl. migrations, both API and web replicas with identical builds, one session on api-1 and api-2, CSRF/Origin refusals, tenant field rejected, cache hit, employee scope, 116 + 4 = 120 calls across both replicas then 429, `db:verify`; failover script: api-1 stopped -> all calls 200 on api-2, restarted api-1 serves the same session, web-1 stopped -> pages from web-2; `docker stop` 0.7 s with `Database pools closed (SIGTERM)`; `pnpm verify`, 16 + 86 integration, 6/6 E2E on the replicas, `pnpm build`; full-history secret scan over 28 commits clean and no `.env`/credential files tracked). The walkthrough was rehearsed with these commands and scripts, not yet presented live to the mentor.

Gate: another developer can reproduce setup and the documented demo from a clean checkout. All required tests pass against real local Postgres/Redis; report any unrun checks instead of claiming completion.

Learn: stateless processes vs stateful stores, horizontal scaling. Exercise: stop api-1 mid-demo and explain why your login survives on api-2.

### M9 — usability: people, projects, and polish (post-MVP, requested 2026-10-28)

Scope added by the user after the MVP review. Display data only: roles still decide every permission.

- [x] System status page for admins only, with the app header and a back link; the public readiness endpoint stays for probes (ADR-021).
- [x] Projects per company, each with its own manager; a member's designation and current project; current manager = the project's manager (control migration, composite same-organization foreign keys, runtime SELECT only on projects).
- [x] Seed: real names and designations, two projects and a second manager per company; earlier placeholder names upgraded once; admin edits never overwritten.
- [x] Profile on `/auth/me` (dashboard, header) and on request details; Users admin sets designation and project (one control transaction with lock and audit event); `GET /admin/projects`.
- [x] Dashboard and navbar redesign: profile card, coloured count tiles, role-based quick-action buttons, brand + pill navigation + user chip; responsive.
- [x] Show/Hide toggle on every password field; a failed sign-in shows the attempts left (per-email counter, so it reveals nothing about which emails exist).
- [x] Tests: 7 new API integration tests (projects isolation, profile, cross-company project refused by API and database, attempts left), 2 seed unit tests, E2E checks for the toggle, attempts, profile, and status access.

Status: evidence 2026-10-28 (`pnpm verify`, 16 + 93 integration, 6/6 E2E against `pnpm dev`, `db:migrate:all`, seed twice (second run changes nothing), `db:verify` incl. the projects grant).

Learn: composite foreign keys as a tenant-safety net; display data vs authorization data.

## 7. Definition of done and evidence

| ID | Required behavior | Evidence |
| --- | --- | --- |
| D01 | Secure local login/logout/password change | API integration + browser auth flow |
| D02 | Current roles and enabled status enforced | Role-change and disabled-session tests |
| D03 | Ownership and tenant isolation | Employee, same-shard, and cross-shard negative tests |
| D04 | Real horizontal routing | SQL checks against both shard databases and directory |
| D05 | Atomic request decisions and audit | Concurrency test and rollback fault test |
| D06 | Tenant-safe pagination | Multiple pages, no duplicates, boundary and invalid cursor tests |
| D07 | Shared Redis limits | Requests distributed across two API instances |
| D08 | Tenant/scope-safe cache | Cache hit, invalidation, TTL, and failure-fallback tests |
| D09 | Stateless application processes | Two web/API replicas; authentication survives one API stopping |
| D10 | Safe account administration | Role checks, password gating, last-admin concurrency test |
| D11 | Reproducible local operation | Fresh setup, migrate-all, seed twice, health, build |
| D12 | Reviewable Git history and demo | Logical commits, clean secret scan/review, architecture + demo docs |

Test the app's actual runtime PostgreSQL role. Superuser-only tests do not prove RLS isolation.

## 8. Command contract to implement

Commands marked M1 exist in the root package.json and were run in M1. The others are targets for the listed milestone; keep this list and README in sync if a name changes.

| Command | Purpose | Available |
| --- | --- | --- |
| pnpm local:setup | Validate prerequisites and create ignored local config/secrets without overwriting existing values | M1 |
| pnpm infra:up / pnpm infra:down | Start/stop local infrastructure without deleting volumes | M1 |
| pnpm db:generate | Generate both client types | M2 |
| pnpm db:migrate:all | Apply control migrations and the same tenant migration history to both shards | M2 |
| pnpm db:seed | Idempotent synthetic seed; protect non-local targets | M2 |
| pnpm db:verify | Read-only evidence: identical shard histories, forced RLS, role flags, tenant distribution | M2 |
| pnpm dev | Start development apps with documented same-origin access | M1 |
| pnpm lint / pnpm typecheck / pnpm format:check | Static quality checks | M1 |
| pnpm verify | Pre-commit gate: format check, lint, typecheck, and unit tests in one command | M1 |
| pnpm secrets:scan | Local secret scan of the Git repository using a pinned container image; no hosted service | M1 |
| pnpm test:unit / pnpm test:integration / pnpm test:e2e | Meaningful test layers with isolated test data | M1; test:e2e M3 (needs the app running at :8080) |
| pnpm build | Build web and API | M1 |
| pnpm demo:up / pnpm demo:down | Start/stop the production-build replica demo | M1 |
| pnpm demo:verify | Run non-destructive checks for the mentor demo (needs `pnpm demo:up`) | M8 |

Do not add a default command that deletes Docker volumes. Destructive resets, if ever needed, require an explicitly named command and a local-target guard.

## 9. Working method and scope changes

Flow: discovery -> bounded scope -> architecture -> testable tasks -> implementation -> evidence -> session handoff. Reusable prompts for each step live in [prompts.md](docs/prompts.md).

Keep it small: no separate proposal, estimator, or replicated requirements document. This project already has its scope defined here.

For a task: read the relevant requirements; state a brief implementation approach; change a small coherent set of files; test; review the diff; update progress. Explain important code choices in plain language so the learner can understand the resulting project.

Log non-blocking questions in decisions.md. Ask only when a real missing requirement changes scope/security, a tool is unavailable, or a destructive action is needed. Do not request approval after every ordinary file edit.

