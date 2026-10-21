// Tenant isolation and shard routing against the real local Postgres *_test databases,
// exercised through the application runtime role (trp_runtime), not a superuser.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InvalidTenantIdError,
  RequestCategory,
  RequestStatus,
  ShardKey,
  ShardRegistry,
  TenantNotRoutedError,
  createControlClient,
  resolveShardKey,
  withTenant,
  type ControlClient,
} from '../dist/index.js';
import { targets } from '../dist/scripts/support.js';

const urls = targets('test');

const ATLAS = '0a7a5000-0000-4000-8000-000000000001';
const CEDAR = '0cedab00-0000-4000-8000-000000000002';
const BIRCH = '0b1bc400-0000-4000-8000-000000000003';
const ATLAS_EMPLOYEE = '1a000000-0000-4000-8000-000000000001';
const ATLAS_COWORKER = '1a000000-0000-4000-8000-000000000002';
const CEDAR_EMPLOYEE = '1c000000-0000-4000-8000-000000000001';
const BIRCH_EMPLOYEE = '1b000000-0000-4000-8000-000000000001';
const ATLAS_REQ = '2a000000-0000-4000-8000-000000000001';
const ATLAS_REQ_COWORKER = '2a000000-0000-4000-8000-000000000002';
const CEDAR_REQ = '2c000000-0000-4000-8000-000000000001';
const BIRCH_REQ = '2b000000-0000-4000-8000-000000000001';

const request = (tenantId: string, id: string, createdByUserId: string, title: string) => ({
  tenantId,
  id,
  title,
  description: 'Integration test fixture request.',
  category: RequestCategory.EQUIPMENT,
  createdByUserId,
});

/** Reset and load the fixture as trp_migrator (owner); tenant rows still go through RLS. */
async function loadFixture(): Promise<void> {
  const reset = async (url: string, sql: string) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      if (!(await c.query('SELECT current_database() AS db')).rows[0].db.endsWith('_test')) {
        throw new Error('fixture reset refused: not a _test database');
      }
      await c.query(sql);
    } finally {
      await c.end();
    }
  };
  await reset(
    urls.control.migration,
    'TRUNCATE control_audit_events, memberships, tenant_directory, users, organizations',
  );
  for (const key of Object.values(ShardKey)) {
    await reset(urls.shards[key].migration, 'TRUNCATE request_audit_events, requests');
  }

  const control = createControlClient(urls.control.migration, { max: 1 });
  const shards = new ShardRegistry(
    { SHARD_A: urls.shards.SHARD_A.migration, SHARD_B: urls.shards.SHARD_B.migration },
    { max: 1 },
  );
  try {
    for (const [id, slug, shardKey] of [
      [ATLAS, 'atlas', ShardKey.SHARD_A],
      [CEDAR, 'cedar', ShardKey.SHARD_A],
      [BIRCH, 'birch', ShardKey.SHARD_B],
    ] as const) {
      await control.organization.create({ data: { id, slug, name: slug } });
      await control.tenantDirectory.create({ data: { organizationId: id, shardKey } });
    }
    await withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
      tx.request.createMany({
        data: [
          request(ATLAS, ATLAS_REQ, ATLAS_EMPLOYEE, 'Atlas monitor'),
          request(ATLAS, ATLAS_REQ_COWORKER, ATLAS_COWORKER, 'Atlas coworker chair'),
        ],
      }),
    );
    await withTenant(shards.get(ShardKey.SHARD_A), CEDAR, (tx) =>
      tx.request.create({ data: request(CEDAR, CEDAR_REQ, CEDAR_EMPLOYEE, 'Cedar headset') }),
    );
    await withTenant(shards.get(ShardKey.SHARD_B), BIRCH, (tx) =>
      tx.request.create({ data: request(BIRCH, BIRCH_REQ, BIRCH_EMPLOYEE, 'Birch laptop') }),
    );
  } finally {
    await Promise.allSettled([control.$disconnect(), shards.disconnectAll()]);
  }
}

let control: ControlClient;
let shards: ShardRegistry;

beforeAll(async () => {
  await loadFixture();
  // What the API will use: runtime role, one connection per pool so reuse is guaranteed.
  control = createControlClient(urls.control.runtime, { max: 1 });
  shards = new ShardRegistry(
    { SHARD_A: urls.shards.SHARD_A.runtime, SHARD_B: urls.shards.SHARD_B.runtime },
    { max: 1 },
  );
});

afterAll(async () => {
  await Promise.allSettled([control.$disconnect(), shards.disconnectAll()]);
});

describe('directory routing', () => {
  it('maps Atlas and Cedar to shard A and Birch to shard B', async () => {
    expect(await resolveShardKey(control, ATLAS)).toBe(ShardKey.SHARD_A);
    expect(await resolveShardKey(control, CEDAR)).toBe(ShardKey.SHARD_A);
    expect(await resolveShardKey(control, BIRCH)).toBe(ShardKey.SHARD_B);
  });

  it('fails closed for an organization without a directory entry', async () => {
    await expect(resolveShardKey(control, '00000000-0000-4000-8000-00000000dead')).rejects.toBeInstanceOf(
      TenantNotRoutedError,
    );
  });

  it('runtime role cannot change the directory', async () => {
    await expect(
      control.tenantDirectory.update({
        where: { organizationId: ATLAS },
        data: { shardKey: ShardKey.SHARD_B },
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('same-shard isolation: Atlas vs Cedar on shard A', () => {
  it('Atlas context lists only Atlas rows', async () => {
    const rows = await withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
      tx.request.findMany({ select: { id: true, tenantId: true }, orderBy: { id: 'asc' } }),
    );
    expect(rows.map((r) => r.id)).toEqual([ATLAS_REQ, ATLAS_REQ_COWORKER]);
    expect(rows.every((r) => r.tenantId === ATLAS)).toBe(true);
  });

  it('a guessed Cedar id is invisible to Atlas although both rows share the database', async () => {
    const found = await withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
      tx.request.findUnique({ where: { id: CEDAR_REQ } }),
    );
    expect(found).toBeNull();
  });

  it('RLS still hides Cedar when application code filters by the wrong tenant', async () => {
    const rows = await withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
      tx.request.findMany({ where: { tenantId: CEDAR } }),
    );
    expect(rows).toEqual([]);
  });

  it('Atlas cannot insert a row for Cedar', async () => {
    await expect(
      withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
        tx.request.create({
          data: request(CEDAR, '2c000000-0000-4000-8000-0000000000ff', ATLAS_EMPLOYEE, 'Smuggled'),
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Atlas cannot update a Cedar row', async () => {
    const result = await withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
      tx.request.updateMany({ where: { id: CEDAR_REQ }, data: { title: 'Changed by Atlas' } }),
    );
    expect(result.count).toBe(0);
  });
});

describe('cross-shard routing: Atlas vs Birch', () => {
  it('Birch is reached through its directory shard', async () => {
    const shard = shards.get(await resolveShardKey(control, BIRCH));
    const found = await withTenant(shard, BIRCH, (tx) => tx.request.findUnique({ where: { id: BIRCH_REQ } }));
    expect(found?.title).toBe('Birch laptop');
  });

  it('Birch rows do not exist on shard A, and Atlas rows do not exist on shard B', async () => {
    const onA = await withTenant(shards.get(ShardKey.SHARD_A), BIRCH, (tx) => tx.request.count());
    const onB = await withTenant(shards.get(ShardKey.SHARD_B), ATLAS, (tx) => tx.request.count());
    expect(onA).toBe(0);
    expect(onB).toBe(0);
  });
});

describe('missing or unsafe tenant context', () => {
  it('runtime queries outside withTenant see no rows', async () => {
    expect(await shards.get(ShardKey.SHARD_A).request.count()).toBe(0);
  });

  it('the tenant setting does not leak to the next use of the pooled connection', async () => {
    const shardA = shards.get(ShardKey.SHARD_A); // pool max 1: the same physical connection
    await withTenant(shardA, ATLAS, (tx) => tx.request.count());
    const [setting] = await shardA.$queryRaw<{ value: string | null }[]>`
      SELECT current_setting('app.tenant_id', true) AS value`;
    expect(setting?.value ?? '').toBe('');
    expect(await shardA.request.count()).toBe(0);
  });

  it('a non-UUID tenant id is rejected before any SQL runs', async () => {
    await expect(
      withTenant(shards.get(ShardKey.SHARD_A), "x' OR '1'='1", (tx) => tx.request.count()),
    ).rejects.toBeInstanceOf(InvalidTenantIdError);
  });
});

describe('runtime role privileges and database rules', () => {
  it('request audit events are append-only', async () => {
    const shardA = shards.get(ShardKey.SHARD_A);
    await withTenant(shardA, ATLAS, (tx) =>
      tx.requestAuditEvent.create({
        data: {
          tenantId: ATLAS,
          requestId: ATLAS_REQ,
          actorUserId: ATLAS_EMPLOYEE,
          action: 'REQUEST_CREATED',
        },
      }),
    );
    await expect(
      withTenant(shardA, ATLAS, (tx) => tx.requestAuditEvent.deleteMany({ where: { requestId: ATLAS_REQ } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(shardA, ATLAS, (tx) =>
        tx.requestAuditEvent.updateMany({
          where: { requestId: ATLAS_REQ },
          data: { correlationRequestId: 'x' },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('requests cannot be deleted by the runtime role', async () => {
    await expect(
      withTenant(shards.get(ShardKey.SHARD_A), ATLAS, (tx) =>
        tx.request.deleteMany({ where: { id: ATLAS_REQ } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the database rejects self-review and a rejection without a comment', async () => {
    const shardA = shards.get(ShardKey.SHARD_A);
    await expect(
      withTenant(shardA, ATLAS, (tx) =>
        tx.request.updateMany({
          where: { id: ATLAS_REQ },
          data: { status: RequestStatus.APPROVED, reviewedByUserId: ATLAS_EMPLOYEE, reviewedAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/requests_no_self_review/);
    await expect(
      withTenant(shardA, ATLAS, (tx) =>
        tx.request.updateMany({
          where: { id: ATLAS_REQ },
          data: { status: RequestStatus.REJECTED, reviewedByUserId: ATLAS_COWORKER, reviewedAt: new Date() },
        }),
      ),
    ).rejects.toThrow(/requests_rejection_comment/);
  });
});
