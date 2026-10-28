import { Controller, Get } from '@nestjs/common';
import type { ProjectSummary } from '@trp/contracts';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../common/request-context.js';
import { ProjectsService } from './projects.service.js';

/** ADMIN only (checked in the service). Read-only: projects are created by operators/seed. */
@Controller('admin/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal): Promise<{ items: ProjectSummary[] }> {
    return this.projects.list(principal);
  }
}
