import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DashboardResponse } from '@trp/contracts';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import type { TenantContext } from '../tenant/tenant-context.js';

/** Bump when the cached value's shape changes, so old entries are simply never read. */
const CACHE_VERSION = 'v1';

/**
 * Short-lived dashboard counts in Redis, shared by every API replica.
 *
 * - Keys always contain the tenant, and "mine" keys also the user, so one company or person
 *   can never be served another's numbers. The caller's scope is authorized BEFORE the cache
 *   is read; the cache never decides who may see what.
 * - Fail open: this is only a speed-up. Any Redis error means "no cache" and the dashboard is
 *   read from the database (unlike sessions and limits, which fail closed).
 * - Eventually consistent: entries live DASHBOARD_CACHE_TTL_SECONDS and are deleted after a
 *   committed request change; a failed delete is logged and the TTL bounds the staleness.
 */
@Injectable()
export class DashboardCacheService {
  private readonly logger = new Logger(DashboardCacheService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  key(ctx: Pick<TenantContext, 'tenantId' | 'userId'>, scope: DashboardResponse['scope']): string {
    const base = `${this.redis.prefix}cache:${CACHE_VERSION}:dashboard:${ctx.tenantId}`;
    return scope === 'company' ? `${base}:company` : `${base}:mine:${ctx.userId}`;
  }

  async get(key: string): Promise<DashboardResponse | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as DashboardResponse;
      return typeof value?.counts?.total === 'number' ? value : null;
    } catch (error) {
      this.warn('read', error);
      return null;
    }
  }

  async set(key: string, value: DashboardResponse): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), {
        expiration: { type: 'EX', value: this.config.DASHBOARD_CACHE_TTL_SECONDS },
      });
    } catch (error) {
      this.warn('write', error);
    }
  }

  /**
   * After a committed request change: the company counts and the submitter's own counts.
   * Never throws; the business change already succeeded.
   */
  async invalidate(tenantId: string, submitterId: string): Promise<void> {
    try {
      await this.redis.client.del([
        this.key({ tenantId, userId: submitterId }, 'company'),
        this.key({ tenantId, userId: submitterId }, 'mine'),
      ]);
    } catch (error) {
      this.warn('invalidate', error);
    }
  }

  /** Error class only: Redis errors can include addresses. */
  private warn(operation: string, error: unknown): void {
    const name = error instanceof Error ? error.name : 'unknown';
    this.logger.warn(`Dashboard cache ${operation} failed (${name}); using the database`);
  }
}
