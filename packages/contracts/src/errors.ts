/** Stable machine-readable error codes. The UI branches on these, never on message text. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'FORBIDDEN',
  'ORIGIN_INVALID',
  'CSRF_INVALID',
  'PASSWORD_CHANGE_REQUIRED',
  'INVALID_CURRENT_PASSWORD',
  'NOT_FOUND',
  'CONFLICT',
  /** 409: the change would leave the organization without an active admin. */
  'LAST_ADMIN',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Every API error response has this shape. Never contains stack traces or database text. */
export interface ApiError {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: string[];
}

/** Header carrying the session-bound CSRF token on unsafe requests. */
export const CSRF_HEADER = 'X-CSRF-Token';
