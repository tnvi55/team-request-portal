import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  CreateRequestSchema,
  DashboardQuerySchema,
  DecisionSchema,
  ListRequestsQuerySchema,
  RequestIdSchema,
  type CreateRequestBody,
  type DashboardQuery,
  type DashboardResponse,
  type DecisionBody,
  type ListRequestsQuery,
  type Page,
  type RequestDetail,
  type RequestSummary,
} from '@trp/contracts';
import type { Request, Response } from 'express';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../common/request-context.js';
import { tenantContextOf } from '../tenant/tenant-context.js';
import { RequestsService } from './requests.service.js';

/**
 * Thin controller: validate input (schemas), build the tenant context from the session,
 * delegate. There is no tenant, shard, or role parameter anywhere in these routes.
 */
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post('requests')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentPrincipal() principal: Principal,
    @Req() req: Request,
    @Body({ schema: CreateRequestSchema }) body: CreateRequestBody,
  ): Promise<RequestDetail> {
    return this.requests.create(tenantContextOf(principal), body, req.requestId);
  }

  @Get('requests')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query({ schema: ListRequestsQuerySchema }) query: ListRequestsQuery,
  ): Promise<Page<RequestSummary>> {
    return this.requests.list(tenantContextOf(principal), query);
  }

  @Get('requests/:id')
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('id', { schema: RequestIdSchema }) id: string,
  ): Promise<RequestDetail> {
    return this.requests.detail(tenantContextOf(principal), id);
  }

  /** 200 with the decided request; 403 role/self-review; 404 outside the company; 409 stale. */
  @Post('requests/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() principal: Principal,
    @Req() req: Request,
    @Param('id', { schema: RequestIdSchema }) id: string,
    @Body({ schema: DecisionSchema }) body: DecisionBody,
  ): Promise<RequestDetail> {
    return this.requests.decide(tenantContextOf(principal), id, body, req.requestId);
  }

  /** X-Dashboard-Cache tells whether the counts came from Redis (hit) or the database (miss). */
  @Get('dashboard')
  async dashboard(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: Response,
    @Query({ schema: DashboardQuerySchema }) query: DashboardQuery,
  ): Promise<DashboardResponse> {
    const { body, cache } = await this.requests.dashboard(tenantContextOf(principal), query.scope);
    res.setHeader('X-Dashboard-Cache', cache);
    return body;
  }
}
