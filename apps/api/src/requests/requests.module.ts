import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { DashboardCacheService } from './dashboard-cache.service.js';
import { PeopleService } from './people.service.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  controllers: [RequestsController, AuditController],
  providers: [RequestsService, AuditService, PeopleService, DashboardCacheService],
})
export class RequestsModule {}
