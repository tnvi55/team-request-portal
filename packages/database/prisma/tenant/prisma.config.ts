import { defineConfig } from 'prisma/config';

// One schema and one migration history for every tenant shard. The migrate-all script sets
// TENANT_MIGRATION_URL to each shard in turn; it is never read from a request.
try {
  process.loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // No .env (CI or containers): rely on the real environment.
}

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations' },
  datasource: { url: process.env.TENANT_MIGRATION_URL ?? '' },
});
