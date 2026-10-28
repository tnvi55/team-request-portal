import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PeopleModule } from '../people/people.module.js';
import { ApiRateLimitGuard } from './api-rate-limit.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Module({
  imports: [PeopleModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards run in this order on every route: CSRF/Origin first, then the session check,
    // then the shared per-user API limit.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: ApiRateLimitGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
