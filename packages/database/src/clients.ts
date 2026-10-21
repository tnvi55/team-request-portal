import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as ControlClient } from './generated/control/client.js';
import { PrismaClient as TenantClient } from './generated/tenant/client.js';

export { ControlClient, TenantClient };

export interface PoolOptions {
  /** Maximum connections in this client's pool. Keep small: every API replica opens one pool per database. */
  max?: number;
}

const DEFAULT_POOL_MAX = 5;

// Bounded pool: a fixed maximum, a connect timeout, and idle connections released.
function adapter(connectionString: string, { max = DEFAULT_POOL_MAX }: PoolOptions) {
  return new PrismaPg({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
}

/** Client for the control database (identities, memberships, directory). */
export function createControlClient(connectionString: string, options: PoolOptions = {}): ControlClient {
  return new ControlClient({ adapter: adapter(connectionString, options) });
}

/** Client for one tenant shard. The same generated type serves every shard. */
export function createTenantClient(connectionString: string, options: PoolOptions = {}): TenantClient {
  return new TenantClient({ adapter: adapter(connectionString, options) });
}
