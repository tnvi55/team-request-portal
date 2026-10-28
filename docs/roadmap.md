# Future scope

Version: 1.0 | 2026-10-28

The current release is the **MVP** (M0–M8) plus the M9 usability milestone. It covers one complete workflow: secure multi-company sign-in, requests, approvals with an audit trail, user and project administration, sharded tenant data, and scalable stateless app processes. Everything below was deliberately left out of the MVP (plan.md section 3) so the core could be finished, tested, and verified first.

The MVP foundations make each item an extension rather than a rewrite. Each section notes which existing part it builds on.

## At a glance

| Horizon | Theme | Highlights |
| --- | --- | --- |
| Next | Smarter approvals | Project-based routing, multi-step chains, budgets, delegation, SLAs |
| Next | Notifications | Email, Slack and Microsoft Teams with one-click approve; in-app notification centre |
| Next | Engineering pipeline | CI on every push, OpenAPI from the shared contracts, project management UI |
| Later | Private AI assistant | Auto-categorise, duplicate detection, policy checks, approver summaries on a self-hosted model |
| Later | Enterprise identity | SSO (OIDC/SAML), SCIM, MFA/passkeys, multi-company accounts, invitations |
| Later | Insights | Lead time, approval rate, spend per project, bottleneck reports |
| Later | Platform scale | Online tenant moves between shards, replicas and backups, Kubernetes, OpenTelemetry |
| Vision | Any approval, one engine | Leave, travel, expenses, access, purchase orders: configurable request types |

## 1. Smarter approval workflows

- **Project-based routing.** Send a request first to the requester's project manager. The data already exists: every member has a project and every project a manager (M9, ADR-021).
- **Multi-step approval chains.** For example manager, then finance above an amount, then IT for software. Configured per company and category. Each step reuses the M5 pattern: a conditional update plus its audit event in one transaction.
- **Budgets and costs.** An amount field, per-project budgets, and remaining-budget checks shown to the approver.
- **Delegation and escalation.** Out-of-office delegates, reminders after N days, and escalation to the next approver.
- **Request lifecycle.** Withdraw, edit while pending, and reopen with a version history (the `version` column already exists).
- **Attachments.** Quotes and invoices in a local S3-compatible store (for example MinIO), with size limits and malware scanning.

## 2. Notifications and collaboration

- **Email, Slack and Microsoft Teams** messages when a request is submitted, decided, or waiting too long, with signed one-click approve and reject links.
- **Reliable delivery.** A transactional outbox: the notification row commits with the decision, and a worker sends it. This avoids "approved but never notified" and "notified but rolled back". The worker can use the existing Redis.
- **Comments and @mentions** on a request; an in-app notification centre.

## 3. Private AI assistant inside the product

AI suggests and humans decide. Every suggestion is labelled and recorded in the audit trail.

- **Smart intake.** Suggest the category and a clear title from free text, and ask for missing details before submission.
- **Duplicate and reuse detection.** For example: "Two people on Vision Platform already have this licence. Reuse a seat?"
- **Policy check.** Flag requests that break company policy (spending limits, approved vendors) before they reach a manager.
- **Approver brief.** A one-paragraph summary with the requester's history, budget impact, and similar past decisions.
- **Ask your data.** Natural-language questions such as "How much did Atlas spend on software this quarter?", answered only from the asker's permitted scope.
- **Privacy by design.** A self-hosted model, so tenant data never leaves the company's environment. The same tenant context and RLS boundaries apply to every AI query.

## 4. Enterprise identity and compliance

- **Single sign-on** through OIDC/SAML (Microsoft Entra ID, Okta, Google Workspace) and SCIM user provisioning, placed in front of the existing membership and role model (ADR-003).
- **Multi-factor authentication** with TOTP or passkeys (WebAuthn).
- **Multi-company accounts** with an organization switcher (lifts ADR-008).
- **Invitations and self-service onboarding** for new companies, with automatic shard placement.
- **Compliance tooling.** A viewer for account-administration events (stored since M6), audit export to CSV or a SIEM, retention policies, and data export/delete requests.

## 5. Insights

- Approval lead time, approval rate by category and project, spend per project, and slowest approval steps.
- Scheduled reports for managers and finance. They are computed per tenant, so the dashboard cache keys (M7) extend naturally.

## 6. Platform and scale

- **Shard operations.** Move a company to another shard online: copy, verify, then flip its directory entry (the directory-based design from ADR-004 exists for this). Also add shards.
- **Data durability.** Postgres replicas with automatic failover, Redis Sentinel, backups with point-in-time recovery, and regular restore drills.
- **Deployment.** Container images are already built (M8). Next: Kubernetes with autoscaling of the stateless web and API replicas, TLS everywhere, and a secrets manager.
- **Observability.** OpenTelemetry traces and metrics on top of the existing request IDs and structured logs; dashboards and service-level objectives.
- **Engineering pipeline.** CI on every push (`pnpm verify`, integration tests with Postgres and Redis service containers, E2E, build), a software bill of materials (SBOM), and signed images.
- **Developer API.** OpenAPI generated from the shared zod contracts, a public API with scoped tokens, and webhooks for ERP or ticketing tools (for example ServiceNow or Jira).
- **Hardening.** Benchmark Argon2 on production hardware, run a penetration test, and do a WCAG 2.2 AA accessibility audit.

## 7. Vision: one approval engine for the whole company

Equipment and software requests are the first use case. The same engine fits leave, travel, expense reimbursements, access requests, purchase orders, and document sign-offs. Each would be a configurable request type with its own fields, approval chain, and reports, with the same tenant isolation, audit, and security in every one. Later additions are a mobile-friendly app (PWA) and multiple languages.
