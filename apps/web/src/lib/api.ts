import { CSRF_HEADER, type ApiError, type CsrfResponse } from '@trp/contracts';

/** An API error with the server's stable code; the UI branches on status/code, never on text. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError | null,
    readonly retryAfterSeconds: number | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The CSRF token lives in memory only (never localStorage) and is re-fetched after login/logout.
let csrfToken: string | null = null;

export function forgetCsrfToken(): void {
  csrfToken = null;
}

async function toError(res: Response): Promise<ApiRequestError> {
  let body: ApiError | null = null;
  try {
    body = (await res.json()) as ApiError;
  } catch {
    // Non-JSON error (e.g. the proxy itself): keep the status only.
  }
  const retry = Number(res.headers.get('Retry-After'));
  return new ApiRequestError(res.status, body, Number.isFinite(retry) && retry > 0 ? retry : null);
}

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw await toError(res);
  csrfToken = ((await res.json()) as CsrfResponse).csrfToken;
  return csrfToken;
}

/**
 * Same-origin call to the NestJS API through the proxy. The session cookie is HttpOnly, so the
 * browser attaches it; this code never sees it. Unsafe methods carry the session's CSRF token.
 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const unsafe = UNSAFE.has(method);

  const send = async () => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (unsafe) headers[CSRF_HEADER] = csrfToken ?? (await fetchCsrfToken());
    return fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: options.body === undefined ? null : JSON.stringify(options.body),
    });
  };

  let res = await send();
  if (unsafe && res.status === 403) {
    const error = await toError(res);
    // A stale token (e.g. rotated at login in another tab) is safe to retry once: the server
    // rejected the request before doing anything.
    if (error.body?.code !== 'CSRF_INVALID') throw error;
    await fetchCsrfToken();
    res = await send();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Login only: how many tries remain before this email is paused for the rest of the window. */
function attemptsLeft(remaining: number | undefined): string {
  if (remaining === undefined) return '';
  if (remaining === 0) return ' No attempts left: sign-in for this email is paused for up to 15 minutes.';
  return ` ${remaining} attempt${remaining === 1 ? '' : 's'} left before sign-in is paused for 15 minutes.`;
}

/** A sentence for the user for any API failure. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiRequestError))
    return 'Could not reach the server. Check your connection and try again.';
  switch (error.status) {
    case 400:
      return error.body?.details?.join('; ') ?? error.message;
    case 401:
      return error.body?.code === 'INVALID_CREDENTIALS'
        ? `Email or password is incorrect.${attemptsLeft(error.body.attemptsRemaining)}`
        : 'Please sign in again.';
    case 403:
      return 'You do not have permission to do that.';
    case 409:
      // Conflict messages are written for users (e.g. "must keep at least one active admin").
      return error.body?.message ?? 'That change conflicts with the current state. Reload and try again.';
    case 429: {
      const minutes = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null;
      return minutes
        ? `Too many attempts. Try again in about ${minutes} minute(s).`
        : 'Too many attempts. Try again later.';
    }
    case 503:
      return 'The service is temporarily unavailable. Please try again shortly.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
