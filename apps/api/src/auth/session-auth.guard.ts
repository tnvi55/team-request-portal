import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiException, UnauthenticatedException } from '../common/errors.js';
import { AuthService } from './auth.service.js';
import { ALLOW_PASSWORD_CHANGE_PENDING, IS_PUBLIC } from './decorators.js';
import { destroySession } from './session.middleware.js';

/**
 * Runs on every non-public route, after CsrfGuard.
 * The session only says WHO signed in; WHAT they may do is re-read from the control database
 * on every request, so a disabled account or changed role takes effect on the next call,
 * on any API replica, with no cache to invalidate.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const { userId, sessionVersion, absoluteExpiresAt } = req.session ?? {};
    if (!userId || sessionVersion === undefined || absoluteExpiresAt === undefined) {
      throw new UnauthenticatedException();
    }

    // Absolute lifetime: rejected after 8 hours even if the user stayed active.
    if (Date.now() > absoluteExpiresAt) {
      await destroySession(req);
      throw new UnauthenticatedException('Session expired');
    }

    const principal = await this.auth.loadActivePrincipal(userId, sessionVersion);
    if (!principal) {
      // Disabled user/membership/organization, or a password change since this session began.
      await destroySession(req);
      throw new UnauthenticatedException('Session is no longer valid');
    }

    const allowedPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING, targets);
    if (principal.mustChangePassword && !allowedPending) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'PASSWORD_CHANGE_REQUIRED', 'Change your password first');
    }

    req.principal = principal;
    return true;
  }
}
