# Claude Code project instructions

Version: 1.0 | 2026-10-19

## Product and learning goal

Build the Team Request & Approval Portal defined in plan.md.
The developer knows JavaScript/React and is learning backend engineering.
Explain important decisions simply, with the request flow and relevant file paths.
Deliver small working milestones; do not generate the entire application at once.

## Read and resume

@session_state.md

- This instruction file is intentionally short. Read the current milestone and business rules in plan.md before implementing.
- Read docs/architecture.md for the relevant component; docs/decisions.md for rationale/assumptions.
- plan.md owns scope, task checkboxes, and acceptance criteria.
- docs/architecture.md owns technical mechanics; docs/decisions.md owns ADRs.
- session_state.md owns the current handoff and last verified commands.
- README.md owns user-facing setup; docs/demo.md owns the mentor walkthrough.
- docs/learning.md owns plain-language concept notes; add or update the relevant entry when a milestone implements a concept.
- These Markdown files are project context, not proof of enforcement. Implement checks in code, tests, and configuration.
- Auto memory is supplementary. Promote enduring decisions into the appropriate versioned document.

## Selected architecture

- Next.js App Router frontend, NestJS modular monolith, PostgreSQL, Prisma, Redis.
- pnpm workspace; TypeScript strict; no microservices or added hosted services.
- Central local identities + organization memberships + shard directory.
- One organization per user for the MVP; ADMIN, MANAGER, EMPLOYEE are tenant roles.
- Two tenant databases share one schema/migration history; directory-based routing.
- Redis sessions, limits, and short-lived dashboard cache are shared between API replicas.
- Local same-origin reverse proxy; normal app access is localhost:8080.
- The app must run without hosted APIs once packages/images are installed.
- Use the supported stable version baseline in plan.md; verify and pin exact versions in M0.
- Keep all auth and business writes in NestJS; no Prisma in web components or parallel business APIs in Next.js.

## Non-negotiable trust boundaries

- Derive tenant context from the current authenticated membership. Never trust a caller's tenant/shard/role field.
- Query current active identity/membership/organization and role on every protected request.
- Apply tenant filters to every business query, including joins, audits, and dashboard aggregates.
- Apply ownership filters for employee record access.
- Use transaction-local RLS context and the correct non-owner runtime role.
- Query only through the scoped transaction client; do not leak tenant settings across pooled connections.
- A missing directory entry or unavailable selected shard fails closed; never use another tenant shard as fallback.
- Request mutation + request audit commit together on the same shard.
- Concurrency must produce one decision; reject self-approval and stale versions.
- Control mutations + control audit commit together; lock/check before removing an active admin.
- Do not claim cross-database foreign keys or a distributed Prisma transaction.

## Authentication and data protection

- Use maintained Argon2id and Redis session libraries; do not invent cryptographic algorithms.
- Use HttpOnly/SameSite cookies, appropriate Secure settings, session rotation, expiry, and CSRF.
- Apply current sessionVersion checks for password-based revocation.
- mustChangePassword identities have only the limited auth routes allowed by plan.md.
- Roles, sessions, and limits must not be stored authoritatively in application process memory.
- Never store authentication tokens in localStorage or cache private data publicly.
- Do not log secrets, passwords, cookies, session IDs, raw auth bodies, database URLs, or private descriptions.
- Keep real environment files and generated demo credentials out of Git.
- Use locally served assets; no external fonts, analytics, email, identity, or database dependency.

## Implementation style

- Validate DTOs and reject unknown fields. Use explicit API response DTOs.
- Thin controllers, focused services, bounded database pools, consistent errors/request IDs.
- Share browser-safe contracts only; never expose Prisma models or passwordHash fields.
- Make pages keyboard-accessible, responsive, and clear about loading/empty/error states.
- Handle 401/403/409/429/503 in UI; avoid duplicate decision submissions.
- Use stable cursor pagination and tenant/scope-aware cache keys.
- Authentication and limits fail closed; dashboard cache failure falls back to the DB.
- Do not add generic frameworks, Redux, queues, payments, or deferred features without a real need.
- Scripts must support the documented Windows PowerShell/WSL2 environment.
- Use official documentation when a library API or version compatibility is uncertain.

## Verification and evidence

- Run relevant checks after a coherent change; avoid full-suite runs after every tiny edit.
- Use real local Postgres/Redis for isolation, transactions, concurrency, and shared-state tests.
- RLS tests must exercise the actual application runtime role, not only a superuser.
- Cover both same-shard isolation (Atlas vs Cedar) and cross-shard routing (Atlas vs Birch).
- Do not weaken tests, silence type errors, bypass guards, or fake success to pass a gate.
- Keep production-only secrets/configuration out of test fixtures.
- Report exact commands and actual results; say when a check was not run and why.
- Update the relevant milestone checkboxes only after acceptance evidence exists.

## Commands and hooks

- This pack contains documentation only. No pnpm/Compose application scripts exist yet.
- M1 implements the target command contract in plan.md and replaces this note with verified commands.
- Inspect existing package.json scripts before claiming a command is available.
- Add formatting/lint hooks only after their commands exist and have been tested.
- Prefer a local formatter for changed files; do not call an LLM to format files in a hook.
- Keep hook output short. Run expensive integration/E2E checks at milestone/commit gates, not on every file edit.

## Session and Git workflow

1. Inspect the worktree and relevant documents; preserve unrelated user work.
2. State a short approach for the current milestone; proceed with routine authorized edits.
3. Implement, run meaningful checks, review the diff, and explain important changes.
4. Update plan.md, affected docs/ADRs, and session_state.md with actual progress.
5. Use logical commits and the user's configured work identity/remote/branch.
- Do not invent Git identity, remote, repository, or credentials.
- Before the first commit, check effective repository identity with its configuration origin.
- Do not push to a guessed remote or force-push; use the user's established workflow.
- Do not delete data/volumes, reset user changes, or rewrite Git history as routine cleanup.
- Ask only for a material missing requirement, external blocker, destructive operation, or genuine scope/security decision.
- Do not stop for approval after ordinary file edits.

