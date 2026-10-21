import type { ControlClient } from './clients.js';
import { TenantNotRoutedError } from './errors.js';
import type { ShardKey } from './generated/control/enums.js';

/**
 * Looks up which shard holds an organization's business records.
 * The organization id must come from the caller's authenticated membership, never from input.
 * A missing entry throws: there is no default shard and no fallback.
 */
export async function resolveShardKey(control: ControlClient, organizationId: string): Promise<ShardKey> {
  const entry = await control.tenantDirectory.findUnique({
    where: { organizationId },
    select: { shardKey: true },
  });
  if (!entry) throw new TenantNotRoutedError();
  return entry.shardKey;
}
