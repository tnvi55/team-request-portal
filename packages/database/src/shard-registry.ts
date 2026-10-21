import { createTenantClient, type PoolOptions, type TenantClient } from './clients.js';
import { ShardNotConfiguredError } from './errors.js';
import type { ShardKey } from './generated/control/enums.js';

/** Connection URL per configured shard key, from server configuration only. */
export type ShardUrls = Record<ShardKey, string>;

/**
 * One long-lived, bounded client per configured shard, created on first use.
 * This is connection-pool reuse keyed by configuration, not per-user state.
 * URLs come from server configuration; a caller can only name a key from the directory.
 */
export class ShardRegistry {
  private readonly clients = new Map<ShardKey, TenantClient>();

  constructor(
    private readonly urls: ShardUrls,
    private readonly poolOptions: PoolOptions = {},
  ) {}

  get(shardKey: ShardKey): TenantClient {
    const existing = this.clients.get(shardKey);
    if (existing) return existing;
    const url = this.urls[shardKey];
    if (!url) throw new ShardNotConfiguredError(shardKey);
    const client = createTenantClient(url, this.poolOptions);
    this.clients.set(shardKey, client);
    return client;
  }

  /** Configured keys, for readiness checks and tooling. */
  keys(): ShardKey[] {
    return Object.keys(this.urls) as ShardKey[];
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((client) => client.$disconnect()));
    this.clients.clear();
  }
}
