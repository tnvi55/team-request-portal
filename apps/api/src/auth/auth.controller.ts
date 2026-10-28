import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  type ChangePasswordRequest,
  type CsrfResponse,
  type LoginRequest,
  type MeResponse,
} from '@trp/contracts';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { Principal } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PeopleService } from '../people/people.service.js';
import { RateLimitService } from '../redis/rate-limit.service.js';
import { AuthService, toMeResponse } from './auth.service.js';
import { AllowPasswordChangePending, CurrentPrincipal, Public } from './decorators.js';
import {
  destroySession,
  regenerateSession,
  saveSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './session.middleware.js';

const newCsrfToken = () => randomBytes(32).toString('base64url');

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly limits: RateLimitService,
    private readonly people: PeopleService,
  ) {}

  /**
   * Returns this session's CSRF token, creating an anonymous session if needed.
   * Creating sessions is rate-limited per IP so anonymous callers cannot fill Redis.
   */
  @Public()
  @Get('csrf')
  async csrf(@Req() req: Request): Promise<CsrfResponse> {
    if (!req.session.csrfToken) {
      await this.limits.consume([
        {
          key: `session-create:ip:${req.ip}`,
          limit: this.config.SESSION_CREATE_LIMIT_PER_IP,
          windowSeconds: this.config.LIMIT_WINDOW_SECONDS,
        },
      ]);
      req.session.csrfToken = newCsrfToken();
    }
    return { csrfToken: req.session.csrfToken };
  }

  /**
   * Public, but CsrfGuard still applies: the caller needs the anonymous session's token first.
   * On success the session id is REGENERATED (the pre-login id is destroyed), which defeats
   * session fixation, and a new CSRF token is issued; the client fetches it from /auth/csrf.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() req: Request,
    @Body({ schema: LoginRequestSchema }) body: LoginRequest,
  ): Promise<MeResponse> {
    const { principal, sessionVersion } = await this.auth.login(
      body.email,
      body.password,
      req.ip ?? 'unknown',
    );
    await regenerateSession(req);
    const now = Date.now();
    req.session.userId = principal.userId;
    req.session.sessionVersion = sessionVersion;
    req.session.absoluteExpiresAt = now + this.config.SESSION_ABSOLUTE_SECONDS * 1000;
    req.session.csrfToken = newCsrfToken();
    await saveSession(req);
    return this.meResponse(principal);
  }

  @AllowPasswordChangePending()
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.meResponse(principal);
  }

  @AllowPasswordChangePending()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.config));
  }

  /** Success ends this session too: every session of the user must sign in again. */
  @AllowPasswordChangePending()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentPrincipal() principal: Principal,
    @Body({ schema: ChangePasswordRequestSchema }) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword, req.requestId);
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.config));
  }

  private async meResponse(principal: Principal): Promise<MeResponse> {
    return toMeResponse(principal, await this.people.profile(principal.organizationId, principal.userId));
  }
}
