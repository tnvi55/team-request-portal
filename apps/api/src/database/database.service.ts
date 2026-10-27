import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createControlClient, ShardRegistry, type ControlClient } from '@trp/database';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

// Small, fixed pools: each API replica holds one pool per database.
const POOL_MAX = 5;

/**
 * Owns the database clients for this process: one control client and one bounded client
 * per configured shard. Shard URLs come only from configuration; requests can only reach a
 * shard through the directory (M4).
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly control: ControlClient;
  readonly shards: ShardRegistry;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.control = createControlClient(config.CONTROL_DATABASE_URL, { max: POOL_MAX });
    this.shards = new ShardRegistry(
      { SHARD_A: config.SHARD_A_DATABASE_URL, SHARD_B: config.SHARD_B_DATABASE_URL },
      { max: POOL_MAX },
    );
  }

  /** Runs after the HTTP server stopped accepting requests (SIGTERM from `docker stop`, Ctrl+C). */
  async onApplicationShutdown(signal?: string): Promise<void> {
    await Promise.allSettled([this.control.$disconnect(), this.shards.disconnectAll()]);
    this.logger.log(`Database pools closed${signal ? ` (${signal})` : ''}`);
  }
}
