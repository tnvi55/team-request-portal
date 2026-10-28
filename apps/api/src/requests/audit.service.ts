import { Inject, Injectable } from '@nestjs/common';
import type { AuditEvent, AuditListQuery, Page } from '@trp/contracts';
import { decodeCursor, encodeCursor, type CursorBinding } from '../common/cursor.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { requireRole, type TenantContext } from '../tenant/tenant-context.js';
import { TenantDbService } from '../tenant/tenant-db.service.js';
import { PeopleService } from '../people/people.service.js';

/** Read side of the request audit trail (writes happen inside the request transactions). */
@Injectable()
export class AuditService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenantDb: TenantDbService,
    private readonly people: PeopleService,
  ) {}

  /** Company request history, newest first. ADMIN only (re-checked from the current role). */
  async list(ctx: TenantContext, query: AuditListQuery): Promise<Page<AuditEvent>> {
    requireRole(ctx, ['ADMIN'], 'Only admins can read the audit history');
    const binding: CursorBinding = {
      endpoint: 'audit',
      tenantId: ctx.tenantId,
      scope: 'company',
      filters: {},
    };
    const after = query.cursor ? decodeCursor(this.config.CURSOR_SECRET, query.cursor, binding) : null;

    const rows = await this.tenantDb.run(ctx, (tx) =>
      tx.requestAuditEvent.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(after && {
            OR: [
              { occurredAt: { lt: new Date(after.at) } },
              { occurredAt: new Date(after.at), id: { lt: after.id } },
            ],
          }),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        // Same-shard join (the FK includes tenant_id), still filtered by RLS.
        include: { request: { select: { title: true } } },
      }),
    );

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const names = await this.people.displayNames(
      ctx.tenantId,
      page.map((e) => e.actorUserId),
    );
    return {
      items: page.map((e) => ({
        id: e.id,
        action: e.action,
        occurredAt: e.occurredAt.toISOString(),
        actor: { id: e.actorUserId, displayName: names.get(e.actorUserId) ?? null },
        request: { id: e.requestId, title: e.request.title },
        correlationRequestId: e.correlationRequestId,
        metadata: safeMetadata(e.metadata),
      })),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor(this.config.CURSOR_SECRET, binding, {
              at: last.occurredAt.toISOString(),
              id: last.id,
            })
          : null,
    };
  }
}

/** Only flat primitive values leave the API, whatever was stored. */
function safeMetadata(value: unknown): AuditEvent['metadata'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: AuditEvent['metadata'] = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
      out[key] = v as string | number | boolean | null;
  }
  return out;
}
