import { HttpStatus } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiException } from './errors.js';

/**
 * Opaque, signed pagination cursor: base64url(JSON payload) + "." + HMAC-SHA256 signature.
 * The payload records WHERE the page ended (createdAt + id) and WHAT it was a page of
 * (endpoint, tenant, scope, filters). A cursor is only accepted for exactly the same list,
 * so editing it or replaying it for another company, user, or filter is a 400.
 * It never grants access by itself: tenant and scope still come from the session.
 */
export interface CursorBinding {
  endpoint: string;
  tenantId: string;
  scope: string;
  filters: Record<string, string | undefined>;
}

export interface CursorPosition {
  at: string; // ISO timestamp of the last item
  id: string; // id of the last item (tie-breaker for equal timestamps)
}

interface CursorPayload extends CursorBinding, CursorPosition {
  v: 1;
}

const invalid = () => new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Invalid cursor');

const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function encodeCursor(secret: string, binding: CursorBinding, position: CursorPosition): string {
  const payload: CursorPayload = { v: 1, ...binding, ...position };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(secret, data)}`;
}

export function decodeCursor(secret: string, cursor: string, expected: CursorBinding): CursorPosition {
  const [data, signature, extra] = cursor.split('.');
  if (!data || !signature || extra !== undefined) throw invalid();
  const good = Buffer.from(sign(secret, data));
  const given = Buffer.from(signature);
  if (good.length !== given.length || !timingSafeEqual(good, given)) throw invalid();

  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as CursorPayload;
  } catch {
    throw invalid();
  }
  const sameFilters = (a: CursorBinding['filters'], b: CursorBinding['filters']) =>
    JSON.stringify(
      Object.entries(a)
        .filter(([, v]) => v !== undefined)
        .sort(),
    ) ===
    JSON.stringify(
      Object.entries(b)
        .filter(([, v]) => v !== undefined)
        .sort(),
    );
  if (
    payload.v !== 1 ||
    payload.endpoint !== expected.endpoint ||
    payload.tenantId !== expected.tenantId ||
    payload.scope !== expected.scope ||
    !sameFilters(payload.filters ?? {}, expected.filters) ||
    typeof payload.at !== 'string' ||
    Number.isNaN(Date.parse(payload.at)) ||
    typeof payload.id !== 'string'
  ) {
    throw invalid();
  }
  return { at: payload.at, id: payload.id };
}
