import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  CreateRequestBody,
  DashboardResponse,
  DecisionBody,
  ListRequestsQuery,
  Page,
  RequestDetail,
  RequestScope,
  RequestSummary,
} from '@trp/contracts';
import { RequestAuditAction, RequestStatus } from '@trp/database';
import { decodeCursor, encodeCursor, type CursorBinding } from '../common/cursor.js';
import { ApiException } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { isReviewer, requireRole, type TenantContext } from '../tenant/tenant-context.js';
import { TenantDbService } from '../tenant/tenant-db.service.js';
import { DashboardCacheService } from './dashboard-cache.service.js';
import { PeopleService } from './people.service.js';

/** The tenant row shape the service maps from (only the fields it reads). */
interface RequestRow {
  id: string;
  title: string;
  description: string;
  category: RequestSummary['category'];
  status: RequestSummary['status'];
  createdByUserId: string;
  reviewedByUserId: string | null;
  reviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  reviewedAt: Date | null;
  version: number;
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDbService,
    private readonly people: PeopleService,
    private readonly dashboardCache: DashboardCacheService,
  ) {}

  /** Request + REQUEST_CREATED audit event in ONE shard transaction: both commit or neither. */
  async create(ctx: TenantContext, body: CreateRequestBody, requestId: string): Promise<RequestDetail> {
    const row = await this.tenantDb.run(ctx, async (tx) => {
      const created = await tx.request.create({
        data: {
          tenantId: ctx.tenantId, // from the session, never from the body
          createdByUserId: ctx.userId,
          title: body.title,
          description: body.description,
          category: body.category,
        },
      });
      await tx.requestAuditEvent.create({
        data: {
          tenantId: ctx.tenantId,
          requestId: created.id,
          actorUserId: ctx.userId,
          action: RequestAuditAction.REQUEST_CREATED,
          correlationRequestId: requestId,
          metadata: { status: created.status, category: created.category },
        },
      });
      return created;
    });
    // After COMMIT: the counts that include this request are now out of date.
    await this.dashboardCache.invalidate(ctx.tenantId, row.createdByUserId);
    return this.toDetail(ctx, row);
  }

  async list(ctx: TenantContext, query: ListRequestsQuery): Promise<Page<RequestSummary>> {
    const scope = this.resolveScope(ctx, query.scope);
    const binding: CursorBinding = {
      endpoint: 'requests',
      tenantId: ctx.tenantId,
      scope: scope === 'mine' ? `mine:${ctx.userId}` : 'company',
      filters: { status: query.status, category: query.category },
    };
    const after = query.cursor ? decodeCursor(this.config.CURSOR_SECRET, query.cursor, binding) : null;

    const rows = await this.tenantDb.run(ctx, (tx) =>
      tx.request.findMany({
        where: {
          tenantId: ctx.tenantId, // explicit tenant filter in addition to RLS
          ...(scope === 'mine' && { createdByUserId: ctx.userId }),
          ...(query.status && { status: query.status }),
          ...(query.category && { category: query.category }),
          // Keyset pagination: strictly after the last item in (createdAt desc, id desc) order.
          ...(after && {
            OR: [
              { createdAt: { lt: new Date(after.at) } },
              { createdAt: new Date(after.at), id: { lt: after.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1, // one extra row tells us whether another page exists
      }),
    );

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const names = await this.people.displayNames(
      ctx.tenantId,
      page.map((r) => r.createdByUserId),
    );
    return {
      items: page.map((r) => toSummary(r, names)),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor(this.config.CURSOR_SECRET, binding, {
              at: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }

  /** 404 (not 403) outside the caller's tenant or ownership scope: existence is not revealed. */
  async detail(ctx: TenantContext, id: string): Promise<RequestDetail> {
    const row = await this.tenantDb.run(ctx, (tx) =>
      tx.request.findFirst({
        where: { id, tenantId: ctx.tenantId, ...(!isReviewer(ctx) && { createdByUserId: ctx.userId }) },
      }),
    );
    if (!row) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Request not found');
    return this.toDetail(ctx, row);
  }

  /**
   * Approve or reject, as ONE shard transaction:
   *  1. find the request inside the caller's company (404 otherwise),
   *  2. refuse self-review (403),
   *  3. conditional UPDATE: only if still PENDING at the version the reviewer saw,
   *  4. 0 rows updated -> 409 (someone decided first, or the reviewer's copy is stale),
   *  5. insert the decision audit event, then commit.
   * Two simultaneous decisions cannot both match step 3: Postgres makes the second UPDATE wait
   * for the first and re-checks its WHERE after the first commits, so exactly one wins.
   * Any error (including a failed audit insert) rolls the whole decision back.
   */
  async decide(
    ctx: TenantContext,
    id: string,
    body: DecisionBody,
    requestId: string,
  ): Promise<RequestDetail> {
    requireRole(ctx, ['MANAGER', 'ADMIN'], 'Only managers and admins can decide requests');
    const row = await this.tenantDb.run(ctx, async (tx) => {
      const current = await tx.request.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { createdByUserId: true },
      });
      if (!current) throw new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Request not found');
      if (current.createdByUserId === ctx.userId) {
        throw new ApiException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'You cannot review your own request');
      }

      const updated = await tx.request.updateMany({
        where: {
          id,
          tenantId: ctx.tenantId,
          status: RequestStatus.PENDING,
          version: body.expectedVersion,
        },
        data: {
          status: body.decision,
          reviewedByUserId: ctx.userId,
          reviewComment: body.comment ?? null,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This request was already decided or has changed. Reload it and try again.',
        );
      }

      const decided = await tx.request.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } });
      await tx.requestAuditEvent.create({
        data: {
          tenantId: ctx.tenantId,
          requestId: id,
          actorUserId: ctx.userId,
          action:
            body.decision === 'APPROVED'
              ? RequestAuditAction.REQUEST_APPROVED
              : RequestAuditAction.REQUEST_REJECTED,
          correlationRequestId: requestId,
          // Allowlisted state change only; the comment text itself stays on the request row.
          metadata: {
            from: RequestStatus.PENDING,
            to: decided.status,
            version: decided.version,
            hasComment: !!body.comment,
          },
        },
      });
      return decided;
    });
    await this.dashboardCache.invalidate(ctx.tenantId, row.createdByUserId);
    return this.toDetail(ctx, row);
  }

  /**
   * Status counts for the caller's scope. The scope is authorized first (from the role re-read
   * this request); only then is the cache, keyed by tenant + scope (+ user), consulted.
   */
  async dashboard(
    ctx: TenantContext,
    requested: RequestScope | undefined,
  ): Promise<{ body: DashboardResponse; cache: 'hit' | 'miss' }> {
    const scope = this.resolveScope(ctx, requested);
    const key = this.dashboardCache.key(ctx, scope);
    const cached = await this.dashboardCache.get(key);
    if (cached?.scope === scope) return { body: cached, cache: 'hit' };

    const body = await this.countByStatus(ctx, scope);
    await this.dashboardCache.set(key, body);
    return { body, cache: 'miss' };
  }

  private async countByStatus(ctx: TenantContext, scope: RequestScope): Promise<DashboardResponse> {
    const groups = await this.tenantDb.run(ctx, (tx) =>
      tx.request.groupBy({
        by: ['status'],
        where: { tenantId: ctx.tenantId, ...(scope === 'mine' && { createdByUserId: ctx.userId }) },
        _count: { _all: true },
      }),
    );
    const counts = { PENDING: 0, APPROVED: 0, REJECTED: 0, total: 0 };
    for (const g of groups) {
      counts[g.status] = g._count._all;
      counts.total += g._count._all;
    }
    return { scope, counts };
  }

  /** Employees may only see their own requests; reviewers default to the company view. */
  private resolveScope(ctx: TenantContext, requested: RequestScope | undefined): RequestScope {
    if (requested === 'company' && !isReviewer(ctx)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Only managers and admins can view company requests',
      );
    }
    return requested ?? (isReviewer(ctx) ? 'company' : 'mine');
  }

  private async toDetail(ctx: TenantContext, row: RequestRow): Promise<RequestDetail> {
    const ids = [row.createdByUserId, ...(row.reviewedByUserId ? [row.reviewedByUserId] : [])];
    const names = await this.people.displayNames(ctx.tenantId, ids);
    return {
      ...toSummary(row, names),
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: row.reviewedByUserId
        ? { id: row.reviewedByUserId, displayName: names.get(row.reviewedByUserId) ?? null }
        : null,
      reviewComment: row.reviewComment,
      version: row.version,
    };
  }
}

/** Explicit response mapping: only these fields leave the API (never tenantId or raw rows). */
function toSummary(row: RequestRow, names: Map<string, string>): RequestSummary {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdByUserId, displayName: names.get(row.createdByUserId) ?? null },
  };
}
