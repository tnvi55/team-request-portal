// pnpm --filter @trp/database test:prepare — create and migrate the isolated *_test databases.
// Integration tests write and truncate data, so they never use the development databases.
// Creating a database needs the local superuser; everything after that uses the normal roles.
import pg from 'pg';
import { assertLocal, databaseName, loadRootEnv, requireEnv, runPrisma, targets } from './support.js';
import { ShardKey } from '../generated/control/enums.js';

loadRootEnv();
const adminPassword = requireEnv('POSTGRES_ADMIN_PASSWORD');
const urls = targets('test');

/** Superuser connection to the maintenance database on the same server as `url`. */
function adminUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = 'postgres';
  parsed.password = adminPassword;
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function ensureDatabase(runtimeUrl: string): Promise<void> {
  assertLocal(runtimeUrl);
  const name = databaseName(runtimeUrl);
  if (!/^trp_[a-z_]+_test$/.test(name)) throw new Error(`Refusing unexpected test database name ${name}`);

  const admin = new pg.Client({ connectionString: adminUrl(runtimeUrl) });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      // Identifiers cannot be bound parameters; the name is validated by the regex above.
      await admin.query(`CREATE DATABASE "${name}"`);
      console.log(`created ${name}`);
    }
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE "${name}" TO trp_migrator`);
    await admin.query(`GRANT CONNECT ON DATABASE "${name}" TO trp_runtime`);
  } finally {
    await admin.end();
  }

  // Same schema privileges as infra/postgres/init/01-roles.sh gives the development databases.
  const dbAdminUrl = new URL(adminUrl(runtimeUrl));
  dbAdminUrl.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: dbAdminUrl.toString() });
  await db.connect();
  try {
    await db.query('ALTER SCHEMA public OWNER TO trp_migrator');
    await db.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    await db.query('GRANT USAGE ON SCHEMA public TO trp_runtime');
  } finally {
    await db.end();
  }
}

await ensureDatabase(urls.control.runtime);
for (const key of Object.values(ShardKey)) await ensureDatabase(urls.shards[key].runtime);

const steps = [
  { config: 'prisma/control/prisma.config.ts', env: { CONTROL_MIGRATION_URL: urls.control.migration } },
  ...Object.values(ShardKey).map((key) => ({
    config: 'prisma/tenant/prisma.config.ts',
    env: { TENANT_MIGRATION_URL: urls.shards[key].migration },
  })),
];
for (const step of steps) {
  if (!runPrisma(['migrate', 'deploy', '--config', step.config], step.env)) {
    console.error('Test database migration failed.');
    process.exit(1);
  }
}
console.log('Test databases ready.');
