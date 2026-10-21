# Session state

Last updated: 2026-10-21
Project: Team Request & Approval Portal
Current milestone: M2 — schemas, shard routing, and synthetic data (not started)
Implementation status: M0 and M1 complete and verified

## Completed

- Docs: START_HERE.md prompts moved to docs/prompts.md; added docs/learning.md, per-milestone "Learn" checkpoints, priority tiers, `pnpm verify` and `pnpm secrets:scan` in plan.md; data-model and concurrent-decision diagrams in architecture.md.
- M0: environment checked (Node 24.21.0, Docker 29.8.2 / Compose 5.5.1, Git 2.41, WSL2 with docker-desktop distro only; `claude` CLI not on PATH, VS Code extension used). pnpm 12.13.0 installed via npm. Versions recorded in ADR-010; ADR-012 (PowerShell + Docker Desktop, apps on host in dev), ADR-013 (supply-chain guards).
- M1: pnpm workspace (apps/web, apps/api, packages/contracts, packages/database placeholder), strict TS 6.0, ESLint 9 + Prettier, Compose infra (3× Postgres 18.6 with trp_migrator/trp_runtime roles, Redis 8.10.2 noeviction, Nginx 1.30.6 on 127.0.0.1:8080), Nest health live/ready, Next placeholder page showing readiness, Dockerfiles, replica demo overlay, local setup and secret-scan scripts.
- Git: repo initialized on `main`; identity `Tanvi <tanvi.jain@fiftyfivetech.io>` from global config, confirmed by the user. No remote; nothing pushed.

## Verified commands and results (2026-10-21)

| Command | Result |
| --- | --- |
| `pnpm local:setup` (twice) | All prerequisites ok; first run created .env, second run "nothing changed" |
| `pnpm infra:up` | 5 containers healthy; all ports bound to 127.0.0.1 |
| Role check via psql | trp_migrator/trp_runtime on all 3 DBs: not superuser, no BYPASSRLS; public schema owned by trp_migrator |
| `pnpm verify` | Prettier clean, ESLint clean, typecheck ok, 5/5 unit tests |
| `pnpm test:integration` | 4/4 against real Postgres/Redis (live 200; ready 200; Redis down → 503; shard B down → 503 with no connection details) |
| `pnpm build` | contracts, API (nest build), web (next build) ok |
| `pnpm dev` + curl via :8080 | page 200; /api/v1/health/live 200 no-store; /ready 200 |
| Stop Redis during dev | ready 503 (redis down), live 200; ready 200 again ~2 s after restart |
| `pnpm demo:up` | images built; api-1/2, web-1/2 healthy; requests alternate between replicas (X-Upstream) |
| Stop api-1 in demo | all reads 200 via api-2; api-1 logged graceful "Shutting down on SIGTERM", exit 143 in 1.6 s |
| `pnpm demo:down` | replicas removed; proxy back to dev config |
| `pnpm infra:down` then `infra:up` | containers removed, 4 volumes kept, probe row survived |
| `pnpm secrets:scan` | see final M1 commit report (run after commit) |

## Not run / known gaps

- Hot reload through the proxy WebSocket was not exercised manually.
- `test:e2e`, `db:*`, `demo:verify` do not exist yet (M2/M3/M8).
- Redis password is visible on the container command line (local-only trade-off, noted in README).

## Blockers

None.

## Next task

M2 from plan.md: control and tenant Prisma 7.10.1 schemas, two generated clients, migrations applied to both shards with RLS and runtime grants, directory (Atlas/Cedar → shard A, Birch → shard B), idempotent synthetic seed with Git-ignored demo credentials, and same-shard plus cross-shard isolation tests. Replace the M1 pg readiness probes with the database package clients.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
