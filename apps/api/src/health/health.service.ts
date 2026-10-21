import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DependencyStatus, ReadinessResponse } from '@trp/contracts';
import { ShardKey } from '@trp/database';
import { createClient } from 'redis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

const CHECK_TIMEOUT_MS = 2000;

/**
 * Readiness probes for the required dependencies. Postgres is probed through the same Prisma
 * clients the API uses for real work, so "ready" means those exact pools can reach their database.
 */
@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private readonly redis: ReturnType<typeof createClient>;
  private readonly redisConnected: Promise<unknown>;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly database: DatabaseService,
  ) {
    this.redis = createClient({
      url: config.REDIS_URL,
      // Fail a command immediately while disconnected instead of queueing it forever.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: CHECK_TIMEOUT_MS,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });
    this.redis.on('error', () => {
      // node-redis emits an error on every failed reconnect; readiness reports it instead.
    });
    // Start connecting in the background: the process stays alive (but unready) if Redis is down.
    this.redisConnected = this.redis.connect();
    this.redisConnected.catch(() => undefined);
  }

  async readiness(): Promise<ReadinessResponse> {
    const [control, shardA, shardB, redis] = await Promise.all([
      this.check(() => this.database.control.$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_A).$queryRaw`SELECT 1`),
      this.check(() => this.database.shards.get(ShardKey.SHARD_B).$queryRaw`SELECT 1`),
      // Wait for the first connection (bounded by the check timeout) instead of failing during startup.
      this.check(async () => {
        await this.redisConnected;
        return this.redis.ping();
      }),
    ]);
    const checks = { control, shardA, shardB, redis };
    const ready = Object.values(checks).every((status) => status === 'up');
    return { status: ready ? 'ready' : 'unready', checks };
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Shutting down${signal ? ` on ${signal}` : ''}: closing Redis (DatabaseService closes the pools)`,
    );
    // close() lets pending commands finish; destroy() stops a client still retrying its connection.
    if (this.redis.isReady) await this.redis.close();
    else if (this.redis.isOpen) this.redis.destroy();
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
