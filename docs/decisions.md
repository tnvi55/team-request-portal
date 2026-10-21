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

Status: pending M0 verification.
Initial target: Node 24 LTS and supported Prisma ORM 7; compatible stable Next.js/React/NestJS/Postgres/Redis versions must be verified at implementation time.
Reason: do not invent exact patches or combine incompatible major-version examples.
M0 must replace this section with exact versions, official compatibility links, verification date, and lock/container pinning details. Avoid moving latest tags and prereleases.

## ADR-011 — Lightweight Claude project context

Status: selected.
Keep CLAUDE.md concise, explicitly read the relevant plan/architecture sections, and keep a short session_state.md.
Reason: preserves project intent across sessions without loading a large duplicate requirements set on every task.
Consequence: no mandatory vector database, Claude web Project upload, or extra tool integrations. Reusable prompts live in docs/prompts.md.

## Deferred questions / parking lot

| ID | Question | Treatment |
| --- | --- | --- |
| A-01 | Does the mentor mean a standalone identity provider by "user pool"? | Proceed with chosen interpretation; review before auth implementation if mentor clarifies |
| A-02 | Are locally running open-source packages/containers permitted? | Assumed yes; no hosted runtime services |
| Q-01 | What is the final deadline? | Not provided; use ordered gates, not invented delivery dates |
| Q-02 | Which Git host/remote and work identity? | Inspect existing local configuration in M0; never guess |
| Q-03 | Which OS shell will be used? | Guide supports Windows; M0 selects/tests PowerShell + Docker Desktop or WSL2 |

Add new ADRs only for meaningful choices. Keep resolved facts in their owning document; do not grow this file with every minor code edit.

