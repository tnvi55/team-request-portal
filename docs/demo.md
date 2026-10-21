# Mentor demo and evidence checklist

Status: NOT RUN. This is the target walkthrough for M8, not a claim that the app works.

Product rules: [plan.md](../plan.md).
Technical design: [architecture.md](architecture.md).

## Preparation

- Finish the milestone gates and fill README with verified commands.
- Use synthetic data only.
- Keep the ignored demo credentials file off screen and out of Git.
- Verify the control database, both tenant shards, and Redis are healthy.
- Start the production-build demo with two web and two API instances.
- Prepare separate browser profiles/private contexts for different companies/roles.
- Ensure the API documentation and instance markers expose no secrets.
- Record actual script/SQL commands here once implemented; target script names in the plan are not executable yet.

## 1. Explain the product and topology

Say: "Each company has admins, managers, and employees. Requests belong to one company. Identities are central; business records are routed to one of two local shards. Web/API processes share state through databases and Redis."

Show the architecture diagram and explain:
- tenant = company,
- identity = who can sign in,
- role = what they may do in that company,
- shard = database holding that company's business records,
- stateless app process = no required per-user memory inside that process.

## 2. Employee journey

- Sign in as Atlas employee.
- If required, change the temporary password and sign in again.
- Submit "Monitor for workstation" under EQUIPMENT.
- Open its PENDING detail and list entry.
- Show pagination and a status/category filter.
- Attempt company administration; API rejects it.
- Attempt reading a coworker's request; record remains inaccessible.

Evidence: browser flow plus API ownership/role tests.

## 3. Manager journey and transaction

- Sign in as Atlas manager in another browser context.
- Open the employee's request and approve it.
- Employee refreshes detail and sees APPROVED.
- Attempt a second decision; receive 409 and no second decision event.
- Attempt self-review; receive 403.
- Show automated simultaneous approve/reject result: exactly one success and one conflict.
- Show audit-write fault test: the whole business change rolls back.

Evidence: tests against real Postgres, final request row, and exactly one decision audit entry.

## 4. Admin journey and current permissions

- Sign in as Atlas admin.
- Show paginated company users and request audit history.
- Create a local employee account; demonstrate mandatory password change.
- Change a user's role, then show the existing session observes the new role on its next call.
- Disable that membership; show its existing session is rejected.
- Show a last-active-admin removal is prevented.
- Show the concurrency test for attempted removal of all remaining active admins.

Evidence: current-control-data checks and control transaction tests.

## 5. Prove tenant isolation and real sharding

Show the control directory:
- Atlas -> shard A.
- Cedar -> shard A.
- Birch -> shard B.

Using safe read-only inspection, show tenantId counts in each physical database.
Show both tenant databases have the same migration history.

Try:
- Atlas requesting a Cedar record ID: inaccessible despite sharing shard A.
- Atlas requesting a Birch record ID: inaccessible across shards.
- Supplying tenantId/shard/role in request input: rejected.
- Raw runtime-role SQL without tenant context: cannot see tenant rows.
- Runtime-role write attempting a different tenant: denied by RLS.

Use runtime-role evidence for RLS. An administrator/superuser query can inspect all data and does not prove isolation.

## 6. Redis cache, rate limits, and sessions

- Load the same scoped dashboard repeatedly and show cache hit/miss diagnostics without private data.
- Decide a request and show post-commit invalidation; explain short-lived count staleness.
- Show employee dashboard keys cannot serve company-wide counts.
- Run controlled login/API throttling and demonstrate 429 + retry guidance.
- Distribute requests across api-1/api-2 and show one shared limit.
- Change password and show the old session is invalid on either instance.
- Show missing/invalid CSRF is rejected.
- Simulate a cache operation failure: scoped DB fallback works.
- Simulate a required session/limiter-store failure: protected work fails closed.

Evidence: integration results and safe request IDs/instance markers. Do not print session IDs/cookies/Redis secrets to a demo transcript.

## 7. Stateless processes and failure behavior

- Show authenticated GET requests reaching both API instances without sticky sessions.
- Stop one API process and show requests recover through the other.
- Acknowledge a possible transient proxy failure during detection; do not promise zero downtime.
- Show public/page-shell requests reaching both identical web builds.
- Restart an API process: it can use the existing shared session.
- Show user data is in PostgreSQL volumes, not in the application container filesystem.
- Explain that the local databases/Redis remain stateful and are not replicated for high availability.

Do not automatically retry ambiguous writes during this demonstration.

## 8. Git and reproducibility

Show:
- readable commit history per milestone,
- committed schemas/migrations/lockfile/config examples,
- a clean staged-secret review,
- fresh setup/migrate/seed instructions,
- seed idempotency evidence,
- passing static/API/browser/build checks.

## Evidence record to fill after implementation

| Area | Actual command or test | Actual result | Notes |
| --- | --- | --- | --- |
| Local startup and health | Not run | Not run | |
| Auth, password change, CSRF | Not run | Not run | |
| Current-role and disabled-session checks | Not run | Not run | |
| Same-shard/cross-shard isolation and RLS | Not run | Not run | |
| Shard distribution and migration status | Not run | Not run | |
| Transaction rollback and concurrency | Not run | Not run | |
| Last-admin protection | Not run | Not run | |
| Pagination | Not run | Not run | |
| Cache behavior | Not run | Not run | |
| Shared rate limits | Not run | Not run | |
| Two web/API instances and process restart | Not run | Not run | |
| Lint, typecheck, unit/integration/E2E, build | Not run | Not run | |
| Fresh checkout and seed twice | Not run | Not run | |

## Honest limitations to state

This is a local learning system with fixed shard mapping and one organization per identity. It does not implement automatic rebalancing, distributed transactions, public onboarding, billing, production backup/restore, or high availability. Passing the local checks is evidence for the tested behavior, not proof of production scale.

