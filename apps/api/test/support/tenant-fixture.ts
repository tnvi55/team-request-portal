import {
  createControlClient,
  createTenantClient,
  hashPassword,
  MembershipRole,
  RequestCategory,
  RequestStatus,
  ShardKey,
  withTenant,
} from '@trp/database';
import { PASSWORD } from './fixture.js';
import { toTestUrl } from './test-app.js';

export const ORGS = {
  atlas: '0a7a5000-0000-4000-8000-000000000001',
  cedar: '0cedab00-0000-4000-8000-000000000002',
  birch: '0b1bc400-0000-4000-8000-000000000003',
  ghost: '06405700-0000-4000-8000-000000000004', // no directory entry: must fail closed
} as const;

export const EMAIL = {
  atlasEmployee: 'employee@atlas.req',
  atlasCoworker: 'coworker@atlas.req',
  atlasManager: 'manager@atlas.req',
  atlasPager: 'pager@atlas.req',
  cedarEmployee: 'employee@cedar.req',
  cedarManager: 'manager@cedar.req',
  birchEmployee: 'employee@birch.req',
  ghostEmployee: 'employee@ghost.req',
} as const;

export const CEDAR_REQUEST = '2c000000-0000-4000-8000-0000000000c1';
export const BIRCH_REQUEST = '2b000000-0000-4000-8000-0000000000b1';
export const PAGER_REQUESTS = 45;

const controlUrl = () => toTestUrl(process.env.CONTROL_MIGRATION_URL!);
export const shardUrl = (key: ShardKey) =>
  toTestUrl(process.env[key === ShardKey.SHARD_A ? 'SHARD_A_MIGRATION_URL' : 'SHARD_B_MIGRATION_URL']!);

/** Owner-role (trp_migrator) access to a test shard, for setup and assertions. */
export async function withShard<T>(
  key: ShardKey,
  work: (client: ReturnType<typeof createTenantClient>) => Promise<T>,
): Promise<T> {
  const client = createTenantClient(shardUrl(key), { max: 1 });
  try {
    return await work(client);
  } finally {
    await client.$disconnect();
  }
}

/** Resets control + both shard *_test databases and loads three routed companies and one unrouted. */
export async function loadTenantFixture(): Promise<Record<keyof typeof EMAIL, string>> {
  const control = createControlClient(controlUrl(), { max: 1 });
  const userIds = {} as Record<keyof typeof EMAIL, string>;
  try {
    const [row] = await control.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    if (!row?.db.endsWith('_test')) throw new Error('fixture reset refused: not a _test database');
    await control.$executeRaw`TRUNCATE control_audit_events, memberships, tenant_directory, users, organizations`;

    for (const [slug, id] of Object.entries(ORGS)) {
      await control.organization.create({ data: { id, slug, name: `${slug} test co` } });
    }
    await control.tenantDirectory.createMany({
      data: [
        { organizationId: ORGS.atlas, shardKey: ShardKey.SHARD_A },
        { organizationId: ORGS.cedar, shardKey: ShardKey.SHARD_A },
        { organizationId: ORGS.birch, shardKey: ShardKey.SHARD_B },
      ],
    });

    const passwordHash = await hashPassword(PASSWORD);
    const members: [keyof typeof EMAIL, string, MembershipRole][] = [
      ['atlasEmployee', ORGS.atlas, MembershipRole.EMPLOYEE],
      ['atlasCoworker', ORGS.atlas, MembershipRole.EMPLOYEE],
      ['atlasManager', ORGS.atlas, MembershipRole.MANAGER],
      ['atlasPager', ORGS.atlas, MembershipRole.EMPLOYEE],
      ['cedarEmployee', ORGS.cedar, MembershipRole.EMPLOYEE],
      ['cedarManager', ORGS.cedar, MembershipRole.MANAGER],
      ['birchEmployee', ORGS.birch, MembershipRole.EMPLOYEE],
      ['ghostEmployee', ORGS.ghost, MembershipRole.EMPLOYEE],
    ];
    for (const [key, organizationId, role] of members) {
      const user = await control.user.create({
        data: { normalizedEmail: EMAIL[key], displayName: key, passwordHash },
      });
      await control.membership.create({ data: { userId: user.id, organizationId, role } });
      userIds[key] = user.id;
    }
  } finally {
    await control.$disconnect();
  }

  for (const key of Object.values(ShardKey)) {
    await withShard(key, async (shard) => {
      const [row] = await shard.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
      if (!row?.db.endsWith('_test')) throw new Error('fixture reset refused: not a _test database');
      await shard.$executeRaw`TRUNCATE request_audit_events, requests`;
    });
  }

  const base = Date.parse('2026-09-01T09:00:00.000Z');
  await withShard(ShardKey.SHARD_A, async (shardA) => {
    // 45 requests for the pager; every 5th shares its predecessor's timestamp (tie-break by id).
    await withTenant(shardA, ORGS.atlas, (tx) =>
      tx.request.createMany({
        data: Array.from({ length: PAGER_REQUESTS }, (_, i) => {
          const status = [RequestStatus.PENDING, RequestStatus.APPROVED, RequestStatus.REJECTED][i % 3]!;
          const decided = status !== RequestStatus.PENDING;
          const slot = (i + 1) % 5 === 0 ? i - 1 : i;
          return {
            tenantId: ORGS.atlas,
            title: `Pager request ${i + 1}`,
            description: 'Pagination fixture request.',
            category: i % 2 === 0 ? RequestCategory.EQUIPMENT : RequestCategory.SOFTWARE,
            status,
            createdByUserId: userIds.atlasPager,
            reviewedByUserId: decided ? userIds.atlasManager : null,
            reviewedAt: decided ? new Date(base + slot * 60_000 + 1000) : null,
            reviewComment: status === RequestStatus.REJECTED ? 'Not this quarter.' : null,
            createdAt: new Date(base + slot * 60_000),
          };
        }),
      }),
    );
    await withTenant(shardA, ORGS.cedar, (tx) =>
      tx.request.create({
        data: {
          id: CEDAR_REQUEST,
          tenantId: ORGS.cedar,
          title: 'Cedar secret request',
          description: 'Must never be visible to Atlas.',
          category: RequestCategory.OTHER,
          createdByUserId: userIds.cedarEmployee,
        },
      }),
    );
  });
  await withShard(ShardKey.SHARD_B, (shardB) =>
    withTenant(shardB, ORGS.birch, (tx) =>
      tx.request.create({
        data: {
          id: BIRCH_REQUEST,
          tenantId: ORGS.birch,
          title: 'Birch secret request',
          description: 'Lives on shard B only.',
          category: RequestCategory.OTHER,
          createdByUserId: userIds.birchEmployee,
        },
      }),
    ),
  );
  return userIds;
}
