import { Injectable, Logger } from '@nestjs/common';
import { ShardNotConfiguredError, withTenant, type TenantTransaction } from '@trp/database';
import { ApiException, ServiceUnavailableError } from '../common/errors.js';
import { DatabaseService } from '../database/database.service.js';
import type { TenantContext } from './tenant-context.js';

/**
 * The only way business code reaches tenant data: one transaction on the caller's shard,
 * with app.tenant_id set for row-level security, as the runtime role. Use only `tx`.
 */
@Injectable()
export class TenantDbService {
  private readonly logger = new Logger(TenantDbService.name);

  constructor(private readonly database: DatabaseService) {}

  async run<T>(ctx: TenantContext, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    try {
      return await withTenant(this.database.shards.get(ctx.shardKey), ctx.tenantId, work);
    } catch (error) {
      if (error instanceof ApiException) throw error;
      if (error instanceof ShardNotConfiguredError || isUnavailable(error)) {
        // The selected shard is down: this company's request fails; no other shard is tried.
        this.logger.warn(`Shard ${ctx.shardKey} unavailable (${errorName(error)})`);
        throw new ServiceUnavailableError();
      }
      throw error;
    }
  }
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** Connection-level failures (refused, timed out, pool exhausted) as opposed to query errors. */
function isUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  const cause = (error as { cause?: { code?: unknown } }).cause?.code;
  return (
    error.name === 'PrismaClientInitializationError' ||
    ['P1001', 'P1002', 'P1017', 'P2024'].includes(String(code)) ||
    ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(String(cause ?? code)) ||
    /ECONNREFUSED|connect ETIMEDOUT|Connection terminated|timeout exceeded when trying to connect/i.test(
      error.message,
    )
  );
}
