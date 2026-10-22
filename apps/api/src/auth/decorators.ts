import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from '../common/request-context.js';

export const IS_PUBLIC = 'trp:isPublic';
export const ALLOW_PASSWORD_CHANGE_PENDING = 'trp:allowPasswordChangePending';

/** No sign-in needed (CSRF token, login, health). Every other route requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Usable while the account must still change its temporary password
 * (only: current user, logout, change password — plan.md section 3).
 */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING, true);

/** The authenticated caller set by SessionAuthGuard. */
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const principal = ctx.switchToHttp().getRequest<Request>().principal;
  if (!principal) throw new Error('CurrentPrincipal used on a route without SessionAuthGuard');
  return principal;
});
