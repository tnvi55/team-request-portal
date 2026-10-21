import type { TenantClient } from './clients.js';
import { InvalidTenantIdError } from './errors.js';
import type { Prisma } from './generated/tenant/client.js';

export type TenantTransaction = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` in one transaction on the given shard with app.tenant_id set for row-level security.
 *
 * - set_config(..., true) is transaction-local: Postgres clears it at COMMIT/ROLLBACK, so the
 *   pooled connection cannot carry this tenant into the next request.
 * - The value is a bound parameter, never concatenated SQL.
 * - Use only the `tx` passed to `work`; queries on the outer client run outside this context
 *   and RLS returns no tenant rows for them.
 */
export async function withTenant<T>(
  client: TenantClient,
  tenantId: string,
  work: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) throw new InvalidTenantIdError();
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(tx);
  });
}
