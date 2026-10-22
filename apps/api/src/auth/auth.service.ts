import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { hashPassword, verifyPassword } from '@trp/database';
import type { MeResponse } from '@trp/contracts';
import { randomBytes } from 'node:crypto';
import { ApiException, InvalidCredentialsException, ServiceUnavailableError } from '../common/errors.js';
import type { Principal } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { keyHash, RateLimitService } from '../redis/rate-limit.service.js';

/** Plan rule: trim surrounding whitespace and lowercase; no provider-specific rewriting. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Hash of a random string: unknown emails cost the same Argon2 work as real ones. */
  private readonly dummyHash: Promise<string> = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
    private readonly limits: RateLimitService,
  ) {}

  /**
   * Current identity + membership + organization, or null if anything makes the session invalid:
   * user, membership or organization disabled, or sessionVersion changed (password changed).
   */
  async loadActivePrincipal(userId: string, sessionVersion: number): Promise<Principal | null> {
    const user = await this.findUser({ id: userId });
    if (!user || user.sessionVersion !== sessionVersion) return null;
    return toPrincipal(user);
  }

  /**
   * Verifies credentials. Limits are counted BEFORE the expensive hash, for every attempt
   * (successful ones too), per account and per client IP, shared by every API replica.
   */
  async login(
    email: string,
    password: string,
    clientIp: string,
  ): Promise<{ principal: Principal; sessionVersion: number }> {
    const normalizedEmail = normalizeEmail(email);
    const window = this.config.LIMIT_WINDOW_SECONDS;
    await this.limits.consume([
      {
        key: `login:acct:${keyHash(normalizedEmail)}`,
        limit: this.config.LOGIN_LIMIT_PER_ACCOUNT,
        windowSeconds: window,
      },
      { key: `login:ip:${clientIp}`, limit: this.config.LOGIN_LIMIT_PER_IP, windowSeconds: window },
    ]);

    const user = await this.findUser({ normalizedEmail });
    // Always run one Argon2 verification so timing does not reveal whether the email exists.
    const valid = await verifyPassword(user?.passwordHash ?? (await this.dummyHash), password);
    const principal = user ? toPrincipal(user) : null;
    if (!user || !valid || !principal) throw new InvalidCredentialsException();
    return { principal, sessionVersion: user.sessionVersion };
  }

  /**
   * Changes the password and increments sessionVersion in ONE control transaction, with its
   * audit event. Every existing session of this user fails its next sessionVersion check.
   */
  async changePassword(
    principal: Principal,
    currentPassword: string,
    newPassword: string,
    requestId: string,
  ): Promise<void> {
    await this.limits.consume([
      {
        key: `pwchange:${principal.userId}`,
        limit: this.config.PASSWORD_CHANGE_LIMIT_PER_USER,
        windowSeconds: this.config.LIMIT_WINDOW_SECONDS,
      },
    ]);
    const user = await this.findUser({ id: principal.userId });
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_CURRENT_PASSWORD',
        'Current password is incorrect',
      );
    }
    const passwordHash = await hashPassword(newPassword);
    await this.database.control.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
      });
      await tx.controlAuditEvent.create({
        data: {
          organizationId: principal.organizationId,
          actorUserId: principal.userId,
          action: 'PASSWORD_CHANGED',
          targetId: principal.membershipId,
          requestId,
        },
      });
    });
  }

  private async findUser(where: { id: string } | { normalizedEmail: string }) {
    try {
      return await this.database.control.user.findUnique({
        where,
        // One query: identity, membership, organization and its shard directory entry.
        include: { membership: { include: { organization: { include: { directory: true } } } } },
      });
    } catch (error) {
      // Cannot read identities: fail closed rather than guess.
      this.logger.error(
        `Control database lookup failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      throw new ServiceUnavailableError();
    }
  }
}

type UserWithMembership = NonNullable<Awaited<ReturnType<AuthService['findUser']>>>;

/** Null unless the user, the membership and the organization are all active. */
function toPrincipal(user: UserWithMembership): Principal | null {
  const membership = user.membership;
  if (!user.isActive || !membership?.isActive || !membership.organization.isActive) return null;
  return {
    userId: user.id,
    email: user.normalizedEmail,
    displayName: user.displayName,
    membershipId: membership.id,
    organizationId: membership.organizationId,
    organizationSlug: membership.organization.slug,
    organizationName: membership.organization.name,
    role: membership.role,
    mustChangePassword: user.mustChangePassword,
    shardKey: membership.organization.directory?.shardKey ?? null,
  };
}

/** Explicit response DTO: never the database row (no passwordHash, no sessionVersion). */
export function toMeResponse(p: Principal): MeResponse {
  return {
    user: { id: p.userId, email: p.email, displayName: p.displayName },
    organization: { id: p.organizationId, slug: p.organizationSlug, name: p.organizationName },
    role: p.role,
    mustChangePassword: p.mustChangePassword,
  };
}
