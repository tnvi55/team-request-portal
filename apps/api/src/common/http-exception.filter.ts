import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiError, ErrorCode } from '@trp/contracts';
import type { Request, Response } from 'express';
import { ApiException, InvalidCredentialsException, RateLimitedException } from './errors.js';

const DEFAULT_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * Renders every error as { code, message, requestId, details? }.
 * Unexpected errors become a generic 500: no stack traces, SQL, or library text reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError = { code: 'INTERNAL_ERROR', message: 'Unexpected error', requestId };

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, requestId };
      if (exception.details) body.details = exception.details;
      if (exception instanceof InvalidCredentialsException && exception.attemptsRemaining !== undefined) {
        body.attemptsRemaining = exception.attemptsRemaining;
      }
      if (exception instanceof RateLimitedException) {
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
    } else if (exception instanceof HttpException) {
      // Framework errors (unknown route, malformed JSON): keep the status, use a generic message.
      status = exception.getStatus();
      body = {
        code: DEFAULT_CODES[status] ?? 'INTERNAL_ERROR',
        message: HttpStatus[status] ?? 'Error',
        requestId,
      };
    } else {
      // Log the error class only: messages from drivers can contain connection details.
      const name = exception instanceof Error ? exception.name : typeof exception;
      this.logger.error(`Unhandled ${name} for ${req.method} ${req.path} (request ${requestId})`);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(body);
  }
}
