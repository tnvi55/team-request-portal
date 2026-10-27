import { Controller, Get, Query } from '@nestjs/common';
import { AuditListQuerySchema, type AuditEvent, type AuditListQuery, type Page } from '@trp/contracts';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../common/request-context.js';
import { tenantContextOf } from '../tenant/tenant-context.js';
import { AuditService } from './audit.service.js';

@Controller('admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query({ schema: AuditListQuerySchema }) query: AuditListQuery,
  ): Promise<Page<AuditEvent>> {
    return this.audit.list(tenantContextOf(principal), query);
  }
}
