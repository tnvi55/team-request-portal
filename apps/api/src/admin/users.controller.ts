import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  CreateUserSchema,
  MembershipIdSchema,
  UpdateMembershipSchema,
  UserListQuerySchema,
  type CompanyUser,
  type CreateUserBody,
  type Page,
  type UpdateMembershipBody,
  type UserListQuery,
} from '@trp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../common/request-context.js';
import { UsersService } from './users.service.js';

/** ADMIN only (checked in the service from the role re-read this request). Own company only. */
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Query({ schema: UserListQuerySchema }) query: UserListQuery,
  ): Promise<Page<CompanyUser>> {
    return this.users.list(principal, query);
  }

  /** 201 with the new member; 409 generic if the email cannot be used. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentPrincipal() principal: Principal,
    @Req() req: Request,
    @Body({ schema: CreateUserSchema }) body: CreateUserBody,
  ): Promise<CompanyUser> {
    return this.users.create(principal, body, req.requestId);
  }

  /** 200 with the member; 404 outside the company; 409 LAST_ADMIN. */
  @Patch(':membershipId')
  update(
    @CurrentPrincipal() principal: Principal,
    @Req() req: Request,
    @Param('membershipId', { schema: MembershipIdSchema }) membershipId: string,
    @Body({ schema: UpdateMembershipSchema }) body: UpdateMembershipBody,
  ): Promise<CompanyUser> {
    return this.users.update(principal, membershipId, body, req.requestId);
  }
}
