import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { ApiException } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Runs first on every route. Unsafe requests (POST/PUT/PATCH/DELETE), including login, need:
 * 1. an Origin header exactly equal to APP_ORIGIN (blocks other sites outright), and
 * 2. an X-CSRF-Token header equal to the token stored in this caller's session
 *    (a synchronizer token another site cannot read, so cannot forge).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    if (req.get('origin') !== this.config.APP_ORIGIN) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'ORIGIN_INVALID', 'Request origin not allowed');
    }

    const expected = req.session?.csrfToken;
    const provided = req.get('x-csrf-token');
    if (!expected || !provided || !sameToken(expected, provided)) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'CSRF_INVALID', 'Missing or invalid CSRF token');
    }
    return true;
  }
}

/** Constant-time comparison so response timing reveals nothing about the token. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
