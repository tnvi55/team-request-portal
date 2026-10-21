// Server-only: never import this package from apps/web.
export {
  ControlClient,
  TenantClient,
  createControlClient,
  createTenantClient,
  type PoolOptions,
} from './clients.js';
export { resolveShardKey } from './directory.js';
export { InvalidTenantIdError, ShardNotConfiguredError, TenantNotRoutedError } from './errors.js';
export { hashPassword, verifyPassword } from './passwords.js';
export { ShardRegistry, type ShardUrls } from './shard-registry.js';
export { withTenant, type TenantTransaction } from './tenant-transaction.js';

export { MembershipRole, ShardKey } from './generated/control/enums.js';
export { RequestAuditAction, RequestCategory, RequestStatus } from './generated/tenant/enums.js';
