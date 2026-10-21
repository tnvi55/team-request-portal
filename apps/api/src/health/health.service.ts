import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { DependencyStatus, ReadinessDependency, ReadinessResponse } from '@trp/contracts';
import pg from 'pg';
import { createClient } from 'redis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

const CHECK_TIMEOUT_MS = 2000;

/**
 * Readiness probes for the required dependencies.
 * M1 uses tiny dedicated pools; M2 replaces the Postgres probes with the Prisma clients.
 */
@Injectable()
export class HealthService implements OnApplicationShutdown {
  private readonly logger = new Logger(HealthService.name);
  private readonly pools: Record<Exclude<ReadinessDependency, 'redis'>, pg.Pool>;
  private readonly redis: ReturnType<typeof createClient>;
  private readonly redisConnected: Promise<unknown>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const pool = (connectionString: string) =>
      new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: CHECK_TIMEOUT_MS });
    this.pools = {
      control: pool(config.CONTROL_DATABASE_URL),
      shardA: pool(config.SHARD_A_DATABASE_URL),
      shardB: pool(config.SHARD_B_DATABASE_URL),
    };
    // An idle pooled connection can error when the database restarts; log without crashing.
    for (const [name, p] of Object.entries(this.pools)) {
      p.on('error', () => this.logger.warn(`Idle ${name} connection closed`));
    }

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
      this.check(() => this.pools.control.query('SELECT 1')),
      this.check(() => this.pools.shardA.query('SELECT 1')),
      this.check(() => this.pools.shardB.query('SELECT 1')),
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
    this.logger.log(`Shutting down${signal ? ` on ${signal}` : ''}: closing database pools and Redis`);
    await Promise.allSettled([
      ...Object.values(this.pools).map((p) => p.end()),
      // close() lets pending commands finish; destroy() stops a client still retrying its connection.
      this.redis.isReady ? this.redis.close() : Promise.resolve(this.redis.isOpen && this.redis.destroy()),
    ]);
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
