import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@trp/contracts';

/** An HTTP error with a stable code from @trp/contracts. The exception filter renders it. */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super(message, status);
  }
}

export class UnauthenticatedException extends ApiException {
  constructor(message = 'Sign in required') {
    super(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);
  }
}

/** One message for unknown email, wrong password and disabled accounts: no account enumeration. */
export class InvalidCredentialsException extends ApiException {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
}

export class RateLimitedException extends ApiException {
  constructor(readonly retryAfterSeconds: number) {
    super(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
}

/** A required dependency (Redis, a database) is unavailable: fail closed. */
export class ServiceUnavailableError extends ApiException {
  constructor() {
    super(HttpStatus.SERVICE_UNAVAILABLE, 'SERVICE_UNAVAILABLE', 'Service temporarily unavailable');
  }
}
