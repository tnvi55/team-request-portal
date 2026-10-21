import { defineConfig } from 'prisma/config';

// Paths are relative to this file. Prisma does not load .env itself; the repo-root .env is read
// here, and it never overrides a variable the caller already set (scripts pass the target URL).
try {
  process.loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // No .env (CI or containers): rely on the real environment.
}

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations' },
  // Migrations run as trp_migrator (schema owner), never as the runtime role or the superuser.
  // Read directly instead of env() so `prisma generate` works without a database URL.
  datasource: { url: process.env.CONTROL_MIGRATION_URL ?? '' },
});
