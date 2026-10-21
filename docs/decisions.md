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
| Next.js / React | 16.4.0 / 19.3.0 | Current stable App Router; React 19 satisfies Next's peer range |
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
- M2: Prisma ORM 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`). Note: npm's `latest` tag currently points to 8.0.0-rc.23, a release candidate; pin 7.x explicitly.
- M3: express-session 1.19.x + connect-redis 10.x (Redis session store), argon2 0.45.x (Argon2id), Playwright 1.64.x (browser E2E), class-validator 0.15.x + class-transformer 0.5.x with Nest `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` for DTOs.
- M7: nestjs-pino 5.x / pino-http for structured logs with request IDs.

Install-script policy: pnpm runs dependency install scripts only when listed in `allowBuilds` (`@swc/core` allowed; `unrs-resolver` denied because pnpm already installs its native binary).

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

## ADR-013 — Supply-chain guards for dependencies

Status: selected in M1.
pnpm `minimumReleaseAge: 10080` (7 days), `allowBuilds` allowlist for install scripts, exact versions, committed lockfile, exact image tags, local gitleaks scan.
Reason: compromised packages are typically discovered within days of publication; install scripts are the usual execution path.
Consequence: brand-new patch releases are adopted a week late. An urgent security fix can be added to `minimumReleaseAgeExclude` with a note.

## Deferred questions / parking lot

| ID | Question | Treatment |
| --- | --- | --- |
| A-01 | Does the mentor mean a standalone identity provider by "user pool"? | Proceed with chosen interpretation; review before auth implementation if mentor clarifies |
| A-02 | Are locally running open-source packages/containers permitted? | Assumed yes; no hosted runtime services |
| Q-01 | What is the final deadline? | Not provided; use ordered gates, not invented delivery dates |
| Q-02 | Which Git host/remote and work identity? | Identity confirmed by user in M0: global `Tanvi <tanvi.jain@fiftyfivetech.io>`. No remote configured yet; ask before first push |
| Q-03 | Which OS shell will be used? | Resolved: Windows PowerShell + Docker Desktop (ADR-012) |

Add new ADRs only for meaningful choices. Keep resolved facts in their owning document; do not grow this file with every minor code edit.

