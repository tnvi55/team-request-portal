import { Injectable } from '@nestjs/common';
import type { DependencyStatus, ReadinessResponse } from '@trp/contracts';
import { ShardKey } from '@trp/database';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';

const CHECK_TIMEOUT_MS = 2000;

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
    const [control, shardA, shardB, redis] = await Promise.all([
      this.check(() => this.database.control.$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_A).$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_B).$queryRaw`SELECT 1`),
      // Wait for the first connection (bounded by the timeout) instead of failing during startup.
      this.check(async () => {
        await this.redis.connected();
        return this.redis.client.ping();
      }),
    ]);
    const checks = { control, shardA, shardB, redis };
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
