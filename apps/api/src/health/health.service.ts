import { Injectable } from '@nestjs/common';
import type { DependencyStatus, ReadinessResponse } from '@trp/contracts';
import { CONTROL_MIGRATIONS, ShardKey, TENANT_MIGRATIONS } from '@trp/database';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

interface MigrationRow {
  migration_name: string;
  applied: boolean;
}

/** The one method both Prisma clients (control and tenant) share that this check needs. */
interface RawQueryable {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}

/**
 * Reads Prisma's own history table (the runtime role may only SELECT it, M7 migration) and
 * throws unless every expected migration is applied and none failed or is still running.
 */
async function assertMigrated(expected: readonly string[], db: RawQueryable): Promise<void> {
  const rows = await db.$queryRaw<MigrationRow[]>`SELECT migration_name,
    (finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied FROM _prisma_migrations`;
  const applied = new Set(rows.filter((r) => r.applied).map((r) => r.migration_name));
  const stuck = rows.some((r) => !r.applied && !applied.has(r.migration_name));
  if (stuck || expected.some((name) => !applied.has(name))) throw new Error('migrations pending');
}

/**
 * Readiness probes through the same clients the API uses for real work (Prisma pools and the
 * shared Redis client), so "ready" means those exact connections can reach their dependency.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    const [control, shardA, shardB, redis, migrations] = await Promise.all([
      this.check(() => this.database.control.$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_A).$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_B).$queryRaw`SELECT 1`),
      // Wait for the first connection (bounded by the timeout) instead of failing during startup.
      this.check(async () => {
        await this.redis.connected();
        return this.redis.client.ping();
      }),
      // Committed migrations (built into this image) must all be applied everywhere: a replica
      // started against a half-migrated database reports unready instead of serving errors.
      this.check(() =>
        Promise.all([
          assertMigrated(CONTROL_MIGRATIONS, this.database.control),
          assertMigrated(TENANT_MIGRATIONS, this.database.shards.get(ShardKey.SHARD_A)),
          assertMigrated(TENANT_MIGRATIONS, this.database.shards.get(ShardKey.SHARD_B)),
        ]),
      ),
    ]);
    const checks = { control, shardA, shardB, redis, migrations };
    const ready = Object.values(checks).every((status) => status === 'up');
    return { status: ready ? 'ready' : 'unready', checks };
  }

  private async check(probe: () => Promise<unknown>): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
    });
    try {
      await Promise.race([probe(), timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
