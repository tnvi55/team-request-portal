import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RateLimitService } from '../redis/rate-limit.service.js';

/**
 * Runs after SessionAuthGuard on every route. Each authenticated call counts against
 * API_LIMIT_PER_MINUTE for this user in this company, in Redis, so every API replica shares
 * one counter (429 + Retry-After when over). Public routes have no principal and are skipped;
 * they have their own login and session-creation limits. Fails closed (503) without Redis.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly limits: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (!principal) return true;
    await this.limits.consume([
      {
        key: `api:${principal.organizationId}:${principal.userId}`,
        limit: this.config.API_LIMIT_PER_MINUTE,
        windowSeconds: 60,
      },
    ]);
    return true;
  }
}
