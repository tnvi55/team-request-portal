import { Injectable } from '@nestjs/common';
import type { ProjectSummary } from '@trp/contracts';
import type { Principal } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { requireRole } from '../tenant/tenant-context.js';

/** A company has a handful of projects, so the list is not paginated (bounded by `take`). */
const MAX_PROJECTS = 200;

@Injectable()
export class ProjectsService {
  constructor(private readonly database: DatabaseService) {}

  /** The admin's own company's projects, with each project's manager and active member count. */
  async list(principal: Principal): Promise<{ items: ProjectSummary[] }> {
    requireRole(principal, ['ADMIN'], 'Only admins can manage users');
    const rows = await this.database.control.project.findMany({
      where: { organizationId: principal.organizationId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_PROJECTS,
      select: {
        id: true,
        name: true,
        manager: {
          select: { jobTitle: true, isActive: true, user: { select: { displayName: true, isActive: true } } },
        },
        _count: { select: { members: { where: { isActive: true } } } },
      },
    });
    return {
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        manager:
          p.manager?.isActive && p.manager.user.isActive
            ? { displayName: p.manager.user.displayName, jobTitle: p.manager.jobTitle }
            : null,
        memberCount: p._count.members,
      })),
    };
  }
}
