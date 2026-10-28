import { Injectable, Logger } from '@nestjs/common';
import type { MemberProfile, PersonSummary } from '@trp/contracts';
import { ServiceUnavailableError } from '../common/errors.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Prisma `select` for everything a profile needs, in the same query as the membership:
 * designation, current project and its manager, and the projects this person manages.
 * Projects and managers are in the same organization (composite foreign keys enforce it).
 */
export const PROFILE_SELECT = {
  id: true,
  jobTitle: true,
  project: {
    select: {
      id: true,
      name: true,
      manager: {
        select: {
          id: true,
          isActive: true,
          jobTitle: true,
          user: { select: { displayName: true, isActive: true } },
        },
      },
    },
  },
  managedProjects: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
} as const;

export interface ProfileRow {
  id: string;
  jobTitle: string | null;
  project: {
    id: string;
    name: string;
    manager: {
      id: string;
      isActive: boolean;
      jobTitle: string | null;
      user: { displayName: string; isActive: boolean };
    } | null;
  } | null;
  managedProjects: { id: string; name: string }[];
}

/** Current manager: the project's manager while active, and never the person themselves. */
export function managerOf(row: Pick<ProfileRow, 'id' | 'project'>): PersonSummary | null {
  const manager = row.project?.manager;
  if (!manager || manager.id === row.id || !manager.isActive || !manager.user.isActive) return null;
  return { displayName: manager.user.displayName, jobTitle: manager.jobTitle };
}

/** Explicit response DTO for a profile row. */
export function toMemberProfile(row: ProfileRow): MemberProfile {
  return {
    jobTitle: row.jobTitle,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    manager: managerOf(row),
    managedProjects: row.managedProjects,
  };
}

/**
 * Display names and profiles for user ids stored on tenant rows. Users live in the control
 * database and requests in a shard, so there is no SQL join: the app runs ONE batched lookup per
 * page (never one query per row), limited to members of the caller's own organization.
 */
@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(private readonly database: DatabaseService) {}

  async displayNames(organizationId: string, userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    try {
      const users = await this.database.control.user.findMany({
        where: { id: { in: ids }, membership: { organizationId } },
        select: { id: true, displayName: true },
      });
      return new Map(users.map((u) => [u.id, u.displayName]));
    } catch (error) {
      this.fail('Display name lookup', error);
    }
  }

  /** One member's profile inside the organization; null if they are not (or no longer) a member. */
  async profile(organizationId: string, userId: string): Promise<MemberProfile | null> {
    try {
      const row = await this.database.control.membership.findFirst({
        where: { userId, organizationId },
        select: PROFILE_SELECT,
      });
      return row ? toMemberProfile(row) : null;
    } catch (error) {
      this.fail('Profile lookup', error);
    }
  }

  private fail(what: string, error: unknown): never {
    this.logger.error(`${what} failed (${error instanceof Error ? error.name : 'unknown'})`);
    throw new ServiceUnavailableError();
  }
}
