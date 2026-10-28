# Session state

Last updated: 2026-10-28
Project: Team Request & Approval Portal
Current milestone: M9 — usability (people, projects, polish) complete
Implementation status: M0–M8 MVP complete; M9 user-requested improvements complete and verified

## Completed

- M0–M8: see plan.md and the Learning Guide. MVP merged 2026-10-27.
- M9 (branch `m9-usability`, requested by the user 2026-10-28):
  - System status page is admin-only, with the header and a back link. `/health/ready` stays public for probes (ADR-021).
  - Control migration `20261028120000_projects_and_job_titles`: `projects` table, `memberships.job_title` and `project_id`, composite same-organization foreign keys, and CHECK rules; runtime role has SELECT only on projects.
  - Seed: realistic names and designations, two projects and a new `manager2` account per company. Placeholder names are upgraded once; admin edits are never overwritten.
  - API: `profile` on `/auth/me` and login; `requester` profile on request details; `GET /admin/projects`; admin create/PATCH accept `jobTitle` and `projectId`, with audit event `MEMBER_PROFILE_CHANGED`. A failed login returns `attemptsRemaining`.
  - Web:
    - New header: brand, pill navigation, user chip.
    - Dashboard: profile card, coloured tiles, quick-action buttons by role.
    - Users page: designation, project and manager columns, project cards.
    - Show/Hide toggle on all password fields; attempts-left message after a wrong password.
- Git: `main` tracks `origin` (https://github.com/tnvi55/team-request-portal.git). Identity `Tanvi <tanvi.jain@fiftyfivetech.io>`.

## Verified commands and results (2026-10-28)

| Command | Result |
| --- | --- |
| `pnpm db:migrate:all` | control migration applied; shards unchanged (3 migrations each) |
| `pnpm db:seed` twice | first: 1 user + 5 profiles per company; second: 0 / 0 (idempotent) |
| `pnpm db:verify` | all checks passed, incl. "runtime can only read projects" |
| `pnpm verify` | clean; unit 17 API + 11 database |
| `pnpm test:integration` | 16/16 database + 93/93 API (7 new M9 tests) |
| `pnpm test:e2e` (against the user's running `pnpm dev`) | 6/6 |
| Screenshots (Playwright) of login, dashboards (admin, manager, mobile employee), Users, status, request detail | reviewed |

## Not run / known gaps

- The body-parser/multer `minimumReleaseAgeExclude` can be removed after 2026-10-29 11:58 UTC.
- Projects can't be created or renamed in the UI yet (seed/operators only; ADR-021).
- Any manager in the company may review any request; restricting reviews to the project's manager would be a new business rule.
- Carried over: X-Forwarded-For spoofable only by local processes calling 127.0.0.1:3001 directly; Argon2 not benchmarked; ESLint 9 unsupported upstream.

## Blockers

None.

## Learning Guide

Long-form guide for the learner (Claude Doc): https://claude.ai/artifact/7aignW34LB1LeGeG37aFYS. Update it after each milestone.

## Next task

None planned. Optional: project management UI, project-scoped approvals, and removing the dependency exclusion after 2026-10-29.

## Handoff discipline

After each milestone, replace this file with a short current summary: actual changes, exact commands/results, remaining blockers, and next task. Do not paste entire chat history or mark unrun checks as passed. Detailed task status stays in plan.md.
