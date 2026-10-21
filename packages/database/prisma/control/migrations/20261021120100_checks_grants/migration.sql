-- Hand-written: CHECK constraints and runtime grants for the control database.
-- Control tables hold rows for every organization; the API filters by the caller's organization
-- explicitly. RLS is applied to the tenant shards, where companies share business tables.

ALTER TABLE "users"
  -- Stored normalized: trimmed and lowercased (plan: global email normalization).
  ADD CONSTRAINT "users_email_normalized" CHECK ("normalized_email" = lower(btrim("normalized_email"))),
  ADD CONSTRAINT "users_session_version_nonnegative" CHECK ("session_version" >= 0);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,39}$');

-- ---------------------------------------------------------------------------
-- Runtime role: least privilege.
-- organizations: UPDATE is granted only because SELECT ... FOR UPDATE (the last-admin
--   row lock in M6) requires it; the API has no organization edit endpoint.
-- tenant_directory: read-only; shard placement is changed only by operators/seed.
-- control_audit_events: append-only.
-- No DELETE anywhere: the MVP never deletes identities, organizations, or memberships.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "users" TO trp_runtime;
GRANT SELECT, INSERT, UPDATE ON "memberships" TO trp_runtime;
GRANT SELECT, UPDATE ON "organizations" TO trp_runtime;
GRANT SELECT ON "tenant_directory" TO trp_runtime;
GRANT SELECT, INSERT ON "control_audit_events" TO trp_runtime;
