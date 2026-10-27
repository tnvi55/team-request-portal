import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { SchemaValidationPipe } from './common/schema-validation.pipe.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { TenantModule } from './tenant/tenant.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    AuthModule,
    TenantModule,
    RequestsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_PIPE, useClass: SchemaValidationPipe },
  ],
})
export class AppModule {}
