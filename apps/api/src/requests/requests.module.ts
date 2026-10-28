import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { DashboardCacheService } from './dashboard-cache.service.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  imports: [PeopleModule],
  controllers: [RequestsController, AuditController],
  providers: [RequestsService, AuditService, DashboardCacheService],
})
export class RequestsModule {}
