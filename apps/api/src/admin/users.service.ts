import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CompanyUser, CreateUserBody, Page, UpdateMembershipBody, UserListQuery } from '@trp/contracts';
import { hashPassword, MembershipRole, type ControlClient } from '@trp/database';
import { decodeCursor, encodeCursor, type CursorBinding } from '../common/cursor.js';
import { ApiException } from '../common/errors.js';
import type { Principal } from '../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { managerOf, PROFILE_SELECT, type ProfileRow } from '../people/people.service.js';
import { requireRole } from '../tenant/tenant-context.js';

type ControlTx = Parameters<Parameters<ControlClient['$transaction']>[0]>[0];

const ADMIN_ONLY = 'Only admins can manage users';

/** Only these user columns ever leave the database for this feature (no password data). */
const USER_FIELDS = {
  select: { id: true, normalizedEmail: true, displayName: true, isActive: true, mustChangePassword: true },
} as const;

/** A membership row with its user and current project (and that project's manager). */
const MEMBER_INCLUDE = { user: USER_FIELDS, project: PROFILE_SELECT.project } as const;

/**
 * Company user administration. Everything lives in the control database, so each write is ONE
 * control transaction: lock the organization row, re-check the caller is still an active admin,
 * change the rows, append the audit event. The lock makes admin-changing writes of one company
 * run one after another, so two admins can never both remove "the other last admin".
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly database: DatabaseService,
  ) {}

  async list(principal: Principal, query: UserListQuery): Promise<Page<CompanyUser>> {
    requireRole(principal, ['ADMIN'], ADMIN_ONLY);
    const binding: CursorBinding = {
      endpoint: 'users',
      tenantId: principal.organizationId,
      scope: 'company',
      filters: {},
    };
    const after = query.cursor ? decodeCursor(this.config.CURSOR_SECRET, query.cursor, binding) : null;

    const rows = await this.database.control.membership.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(after && {
          OR: [
            { createdAt: { lt: new Date(after.at) } },
            { createdAt: new Date(after.at), id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: MEMBER_INCLUDE,
    });

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map(toCompanyUser),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor(this.config.CURSOR_SECRET, binding, {
              at: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** New identity + membership + MEMBER_CREATED event, all or nothing. */
  async create(principal: Principal, body: CreateUserBody, requestId: string): Promise<CompanyUser> {
    requireRole(principal, ['ADMIN'], ADMIN_ONLY);
    // Hash before the transaction: Argon2 is deliberately slow and must not hold the lock.
    // Only the hash is stored; the plaintext is never written anywhere.
    const passwordHash = await hashPassword(body.temporaryPassword);
    try {
      const created = await this.database.control.$transaction(async (tx) => {
        await lockOrganizationAsAdmin(tx, principal);
        if (body.projectId) await assertProjectInOrganization(tx, principal.organizationId, body.projectId);
        const user = await tx.user.create({
          data: {
            normalizedEmail: body.email,
            displayName: body.displayName,
            passwordHash,
            mustChangePassword: true,
          },
        });
        const membership = await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: principal.organizationId,
            role: body.role,
            jobTitle: body.jobTitle ?? null,
            projectId: body.projectId ?? null,
          },
          include: MEMBER_INCLUDE,
        });
        await tx.controlAuditEvent.create({
          data: {
            organizationId: principal.organizationId,
            actorUserId: principal.userId,
            action: 'MEMBER_CREATED',
            targetId: membership.id,
            requestId,
            metadata: { role: body.role },
          },
        });
        return membership;
      });
      return toCompanyUser(created);
    } catch (error) {
      // Emails are unique across ALL organizations. Say only that it cannot be used:
      // never whether, or where, the account exists.
      if (isUniqueViolation(error)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'An account cannot be created for this email',
        );
      }
      throw error;
    }
  }

  /**
   * Role change, enable/disable, designation, and project, guarded so the company always keeps
   * an active admin. Designation and project are display data: they grant nothing.
   */
  async update(
    principal: Principal,
    membershipId: string,
    body: UpdateMembershipBody,
    requestId: string,
  ): Promise<CompanyUser> {
    requireRole(principal, ['ADMIN'], ADMIN_ONLY);
    const organizationId = principal.organizationId;
    const updated = await this.database.control.$transaction(async (tx) => {
      await lockOrganizationAsAdmin(tx, principal);

      // Read AFTER taking the lock: we see every change committed by the admin before us.
      const target = await tx.membership.findFirst({
        where: { id: membershipId, organizationId },
        include: MEMBER_INCLUDE,
      });
      if (!target) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found');

      const role = body.role ?? target.role;
      const isActive = body.isActive ?? target.isActive;
      const jobTitle = body.jobTitle === undefined ? target.jobTitle : body.jobTitle;
      const projectId = body.projectId === undefined ? target.projectId : body.projectId;
      if (projectId && projectId !== target.projectId) {
        await assertProjectInOrganization(tx, organizationId, projectId);
      }
      const wasAdmin = isActiveAdmin(target.role, target.isActive, target.user.isActive);
      const staysAdmin = isActiveAdmin(role, isActive, target.user.isActive);
      if (wasAdmin && !staysAdmin) {
        const activeAdmins = await tx.membership.count({
          where: { organizationId, role: MembershipRole.ADMIN, isActive: true, user: { isActive: true } },
        });
        if (activeAdmins <= 1) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            'LAST_ADMIN',
            'The company must keep at least one active admin',
          );
        }
      }

      const events: { action: string; metadata: Record<string, string> }[] = [];
      if (role !== target.role) {
        events.push({ action: 'MEMBER_ROLE_CHANGED', metadata: { from: target.role, to: role } });
      }
      if (isActive !== target.isActive) {
        events.push({ action: isActive ? 'MEMBER_ENABLED' : 'MEMBER_DISABLED', metadata: {} });
      }
      const profileFields = [
        ...(jobTitle !== target.jobTitle ? ['jobTitle'] : []),
        ...(projectId !== target.projectId ? ['projectId'] : []),
      ];
      if (profileFields.length > 0) {
        events.push({ action: 'MEMBER_PROFILE_CHANGED', metadata: { fields: profileFields.join(',') } });
      }
      if (events.length === 0) return target; // nothing changed: no write, no event

      const membership = await tx.membership.update({
        where: { id: target.id, organizationId },
        data: { role, isActive, jobTitle, projectId },
        include: MEMBER_INCLUDE,
      });
      if (target.isActive && !isActive) {
        // Disabling ends every existing session for good: re-enabling later does not revive them.
        await tx.user.update({
          where: { id: target.userId },
          data: { sessionVersion: { increment: 1 } },
        });
      }
      await tx.controlAuditEvent.createMany({
        data: events.map((e) => ({
          organizationId,
          actorUserId: principal.userId,
          action: e.action,
          targetId: target.id,
          requestId,
          metadata: e.metadata,
        })),
      });
      return membership;
    });
    return toCompanyUser(updated);
  }
}

/**
 * Locks this organization's row until the transaction ends (other admin writes of the same
 * company wait here), then re-checks that the caller is STILL an active admin: another admin
 * may have demoted or disabled them after the session guard ran.
 */
async function lockOrganizationAsAdmin(tx: ControlTx, principal: Principal): Promise<void> {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${principal.organizationId}::uuid FOR UPDATE`;
  const actor = await tx.membership.findFirst({
    where: {
      id: principal.membershipId,
      organizationId: principal.organizationId,
      role: MembershipRole.ADMIN,
      isActive: true,
      user: { isActive: true },
    },
    select: { id: true },
  });
  if (!actor) throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', ADMIN_ONLY);
}

/** 400 unless the project belongs to this organization (a composite foreign key also enforces it). */
async function assertProjectInOrganization(tx: ControlTx, organizationId: string, projectId: string) {
  const project = await tx.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true },
  });
  if (!project) {
    throw new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Unknown project', [
      'projectId: unknown project',
    ]);
  }
}

const isActiveAdmin = (role: MembershipRole, memberActive: boolean, userActive: boolean) =>
  role === MembershipRole.ADMIN && memberActive && userActive;

/** Prisma's code for a unique-constraint violation. */
const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

interface MembershipRow {
  id: string;
  role: MembershipRole;
  jobTitle: string | null;
  project: ProfileRow['project'];
  isActive: boolean;
  createdAt: Date;
  user: {
    id: string;
    normalizedEmail: string;
    displayName: string;
    isActive: boolean;
    mustChangePassword: boolean;
  };
}

/** Explicit response DTO: never the database rows. */
function toCompanyUser(m: MembershipRow): CompanyUser {
  return {
    membershipId: m.id,
    user: { id: m.user.id, email: m.user.normalizedEmail, displayName: m.user.displayName },
    role: m.role,
    jobTitle: m.jobTitle,
    project: m.project ? { id: m.project.id, name: m.project.name } : null,
    manager: managerOf(m),
    isActive: m.isActive && m.user.isActive,
    mustChangePassword: m.user.mustChangePassword,
    createdAt: m.createdAt.toISOString(),
  };
}
