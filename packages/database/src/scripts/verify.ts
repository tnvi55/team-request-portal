// pnpm db:verify [--test] — read-only evidence for the M2 gate. Changes nothing.
// 1. Both shards have the identical tenant migration history (names + checksums).
// 2. RLS is enabled AND forced on tenant tables; tables are owned by trp_migrator.
// 3. App roles are not superuser and cannot bypass RLS.
// 4. Each organization's rows exist on its directory shard and on no other shard.
// 5. The runtime role sees zero tenant rows without a tenant context.
import pg from 'pg';
import { ShardKey } from '../generated/control/enums.js';
import { assertLocal, databaseName, loadRootEnv, targetFromArgs, targets } from './support.js';

loadRootEnv();
const target = targetFromArgs();
const urls = targets(target);
const failures: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

async function withClient<T>(url: string, work: (c: pg.Client) => Promise<T>): Promise<T> {
  assertLocal(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Count rows for one tenant inside a read-only transaction with its RLS context. */
async function tenantCounts(c: pg.Client, tenantId: string): Promise<{ requests: number; events: number }> {
  await c.query('BEGIN READ ONLY');
  try {
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const r = await c.query<{ requests: string; events: string }>(
      'SELECT (SELECT count(*) FROM requests) AS requests, (SELECT count(*) FROM request_audit_events) AS events',
    );
    return { requests: Number(r.rows[0]!.requests), events: Number(r.rows[0]!.events) };
  } finally {
    await c.query('ROLLBACK');
  }
}

console.log(`Target: ${target}\n`);

// --- Directory --------------------------------------------------------------
const directory = await withClient(urls.control.migration, async (c) => {
  const r = await c.query<{ id: string; slug: string; shard_key: string }>(
    `SELECT o.id, o.slug, d.shard_key FROM organizations o
     LEFT JOIN tenant_directory d ON d.organization_id = o.id ORDER BY o.slug`,
  );
  return r.rows;
});
console.log('Directory (control):');
for (const row of directory) console.log(`  ${row.slug.padEnd(8)} -> ${row.shard_key ?? 'MISSING'}`);
check(
  directory.every((row) => row.shard_key !== null),
  'every organization has a directory entry',
);

// --- Per-shard structure ----------------------------------------------------
const shardKeyToDb: Record<string, ShardKey> = { 'shard-a': ShardKey.SHARD_A, 'shard-b': ShardKey.SHARD_B };
const histories: Record<string, string> = {};
for (const key of Object.values(ShardKey)) {
  const url = urls.shards[key].migration;
  await withClient(url, async (c) => {
    console.log(`\n${key} (${databaseName(url)}):`);
    const migrations = await c.query<{ migration_name: string; checksum: string }>(
      `SELECT migration_name, checksum FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    histories[key] = migrations.rows.map((m) => `${m.migration_name}:${m.checksum}`).join('|');
    console.log(`  migrations: ${migrations.rows.map((m) => m.migration_name).join(', ')}`);

    const tables = await c.query<{ relname: string; rls: boolean; forced: boolean; owner: string }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced, pg_get_userbyid(c.relowner) AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('requests', 'request_audit_events') ORDER BY c.relname`,
    );
    for (const t of tables.rows) {
      check(
        t.rls && t.forced && t.owner === 'trp_migrator',
        `${key}.${t.relname}: RLS forced, owner ${t.owner}`,
      );
    }
    check(tables.rows.length === 2, `${key}: both tenant tables exist`);

    const roles = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('trp_migrator', 'trp_runtime') ORDER BY 1`,
    );
    check(
      roles.rows.length === 2 && roles.rows.every((r) => !r.rolsuper && !r.rolbypassrls),
      `${key}: trp_migrator and trp_runtime are not superuser and cannot bypass RLS`,
    );

    const audit = await c.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'trp_runtime' AND table_name = 'request_audit_events' ORDER BY 1`,
    );
    const auditGrants = audit.rows.map((r) => r.privilege_type).join(',');
    check(auditGrants === 'INSERT,SELECT', `${key}: runtime audit grants are append-only (${auditGrants})`);
  });
}
check(
  histories.SHARD_A === histories.SHARD_B && histories.SHARD_A !== '',
  'shard A and shard B have identical migration histories',
);

// --- Distribution -----------------------------------------------------------
console.log('\nDistribution (rows visible per tenant context, counted as trp_migrator under FORCE RLS):');
console.log('  org       shard A req/events   shard B req/events');
for (const org of directory) {
  const counts: Record<string, { requests: number; events: number }> = {};
  for (const key of Object.values(ShardKey)) {
    counts[key] = await withClient(urls.shards[key].migration, (c) => tenantCounts(c, org.id));
  }
  const a = counts.SHARD_A!;
  const b = counts.SHARD_B!;
  console.log(
    `  ${org.slug.padEnd(8)}  ${`${a.requests}/${a.events}`.padEnd(19)}  ${b.requests}/${b.events}`,
  );
  const home = shardKeyToDb[org.shard_key]!;
  const other = home === ShardKey.SHARD_A ? ShardKey.SHARD_B : ShardKey.SHARD_A;
  check(counts[home]!.requests >= 60, `${org.slug}: at least 60 requests on its shard ${home}`);
  check(counts[other]!.requests === 0 && counts[other]!.events === 0, `${org.slug}: no rows on ${other}`);
}

// --- Runtime role without context -------------------------------------------
for (const key of Object.values(ShardKey)) {
  const visible = await withClient(urls.shards[key].runtime, async (c) => {
    const r = await c.query<{ n: string }>('SELECT count(*) AS n FROM requests');
    return Number(r.rows[0]!.n);
  });
  check(visible === 0, `${key}: runtime role without tenant context sees ${visible} requests`);
}

console.log(failures.length === 0 ? '\nAll checks passed.' : `\n${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);
