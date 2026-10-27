import { HttpStatus } from '@nestjs/common';
import type { MembershipRole } from '@trp/contracts';
import type { ShardKey } from '@trp/database';
import { ApiException, ServiceUnavailableError } from '../common/errors.js';
import type { Principal } from '../common/request-context.js';

/**
 * Everything a business query needs to know about the caller, built only from the
 * authenticated, freshly loaded membership. No field here can come from the request.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: MembershipRole;
  shardKey: ShardKey;
}

export const isReviewer = (ctx: TenantContext) => ctx.role === 'MANAGER' || ctx.role === 'ADMIN';

/** 403 unless the caller's CURRENT role (re-read this request) is one of `roles`. */
export function requireRole(ctx: { role: MembershipRole }, roles: MembershipRole[], message: string): void {
  if (!roles.includes(ctx.role)) throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message);
}

/** A company with no directory entry cannot be served: fail closed, never guess a shard. */
export function tenantContextOf(principal: Principal): TenantContext {
  if (!principal.shardKey) throw new ServiceUnavailableError();
  return {
    tenantId: principal.organizationId,
    userId: principal.userId,
    role: principal.role,
    shardKey: principal.shardKey,
  };
}
