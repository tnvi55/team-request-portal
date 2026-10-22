import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RateLimitedException, ServiceUnavailableError } from '../common/errors.js';
import { RedisService } from './redis.service.js';

export interface LimitRule {
  /** Key suffix, e.g. "login:ip:127.0.0.1". Never put raw emails or secrets here; use keyHash(). */
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counters in Redis, shared by every API replica.
 * - Atomic: INCR and the first EXPIRE run in one MULTI, so concurrent requests cannot both
 *   see a fresh counter or leave a key without expiry.
 * - Every attempt counts, including successful ones; a window ends by expiry, never by reset.
 * - Fail closed: if Redis cannot answer, the request is refused with 503.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Counts one attempt against every rule; throws 429 if any rule is now over its limit. */
  async consume(rules: LimitRule[]): Promise<void> {
    let retryAfter = 0;
    for (const rule of rules) {
      const key = `${this.redis.prefix}rl:${rule.key}`;
      let count: number;
      let ttl: number;
      try {
        const [incr, , ttlReply] = await this.redis.client
          .multi()
          .incr(key)
          .expire(key, rule.windowSeconds, 'NX')
          .ttl(key)
          .exec();
        count = Number(incr);
        ttl = Number(ttlReply);
      } catch {
        throw new ServiceUnavailableError();
      }
      if (count > rule.limit) retryAfter = Math.max(retryAfter, ttl > 0 ? ttl : rule.windowSeconds);
    }
    if (retryAfter > 0) throw new RateLimitedException(retryAfter);
  }
}

/** Stable, non-reversible key part for identifiers such as emails (keeps them out of Redis keys). */
export function keyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
