-- Hand-written (M7): let the runtime role READ Prisma's migration history, so the API's
-- readiness check can confirm every committed migration is applied before taking traffic.
-- Read-only: the runtime role still cannot change the history or run migrations.
GRANT SELECT ON "_prisma_migrations" TO trp_runtime;
