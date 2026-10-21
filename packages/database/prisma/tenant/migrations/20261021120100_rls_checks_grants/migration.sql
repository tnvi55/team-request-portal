-- Hand-written: row-level security, business CHECK constraints, and runtime grants.
-- Prisma's schema language cannot express these, so they live in their own migration.
-- Applied to every shard together with the rest of the tenant history.

-- ---------------------------------------------------------------------------
-- Row-level security: a row is visible/writable only when its tenant_id equals the
-- transaction-local setting app.tenant_id (set by withTenant via set_config(..., true)).
-- No setting -> NULL -> no rows, and writes fail the WITH CHECK.
-- NULLIF turns the empty string a reset custom setting returns into NULL.
-- FORCE applies the policies to the table owner (trp_migrator) as well.
-- ---------------------------------------------------------------------------
ALTER TABLE "requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "requests_tenant_isolation" ON "requests"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "request_audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "request_audit_events_tenant_isolation" ON "request_audit_events"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Business rules from plan.md enforced by the database as a second line of defence.
-- ---------------------------------------------------------------------------
ALTER TABLE "requests"
  ADD CONSTRAINT "requests_title_length" CHECK (char_length(btrim("title")) BETWEEN 3 AND 120),
  ADD CONSTRAINT "requests_description_length" CHECK (char_length(btrim("description")) BETWEEN 10 AND 2000),
  ADD CONSTRAINT "requests_version_nonnegative" CHECK ("version" >= 0),
  -- PENDING has no reviewer; a decided request always has reviewer and time.
  ADD CONSTRAINT "requests_review_state" CHECK (
    ("status" = 'PENDING' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" <> 'PENDING' AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  ),
  -- Nobody reviews their own request.
  ADD CONSTRAINT "requests_no_self_review" CHECK ("reviewed_by_user_id" IS DISTINCT FROM "created_by_user_id"),
  -- A rejection needs a 3-500 character comment.
  ADD CONSTRAINT "requests_rejection_comment" CHECK (
    "status" <> 'REJECTED' OR char_length(btrim(coalesce("review_comment", ''))) BETWEEN 3 AND 500
  );

-- ---------------------------------------------------------------------------
-- Runtime role (used by the API): least privilege.
-- requests: no DELETE (the MVP never deletes requests).
-- request_audit_events: append-only, SELECT and INSERT only.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "requests" TO trp_runtime;
GRANT SELECT, INSERT ON "request_audit_events" TO trp_runtime;
