# @trp/database

Server-only database layer: two Prisma schemas, their generated clients, migrations, shard routing, the tenant transaction helper, password hashing, and the local seed/verify scripts. Never import it from `apps/web`.

| Path | Purpose |
| --- | --- |
| `prisma/control/` | Control schema (users, organizations, memberships, tenant directory, control audit) + migrations |
| `prisma/tenant/` | Tenant schema (requests, request audit) + ONE migration history applied to every shard |
| `src/clients.ts` | `createControlClient` / `createTenantClient` with bounded pools (Prisma 7 + `@prisma/adapter-pg`) |
| `src/shard-registry.ts` | One long-lived client per configured shard key |
| `src/directory.ts` | `resolveShardKey`: organization -> shard, fails closed |
| `src/tenant-transaction.ts` | `withTenant`: transaction + `set_config('app.tenant_id', $1, true)` for RLS |
| `src/passwords.ts` | Argon2id hashing (OWASP baseline) |
| `src/scripts/` | `migrate-all`, `seed`, `verify`, `test-prepare` |
| `test/` | Isolation and routing tests against `*_test` databases as `trp_runtime` |

## Commands

From the repo root: `pnpm db:generate`, `pnpm db:migrate:all`, `pnpm db:seed`, `pnpm db:verify`.
In this package: `pnpm test:unit`, `pnpm test:integration` (creates/migrates the `*_test` databases first).

## Adding a migration (ADR-014)

1. Edit `prisma/<control|tenant>/schema.prisma`.
2. Generate the SQL against the migrated dev database (as `trp_migrator`), from this folder:
   `npx prisma migrate diff --config prisma/tenant/prisma.config.ts --from-config-datasource --to-schema prisma/tenant/schema.prisma --script -o prisma/tenant/migrations/<timestamp>_<name>/migration.sql`
   (the tenant config reads `TENANT_MIGRATION_URL`; set it to `SHARD_A_MIGRATION_URL` for this step).
3. Add explicit `GRANT ... TO trp_runtime` for any new table, and RLS for any new tenant table.
4. Review the SQL, then `pnpm db:migrate:all` and `pnpm db:verify`.

Never use `prisma migrate dev`, `migrate reset`, or `db push` here: they need privileges the roles deliberately lack, and reset deletes data.
