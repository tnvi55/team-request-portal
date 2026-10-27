import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { MembershipRole } from '@trp/contracts';
import type { ShardKey } from '@trp/database';
import type { AppConfig } from '../config/env.js';

/** The authenticated caller, rebuilt from current control-database rows on every request. */
export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  membershipId: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: MembershipRole;
  mustChangePassword: boolean;
  /** Directory entry for the organization, loaded in the same query; null = not routed. */
  shardKey: ShardKey | null;
}

declare module 'express-session' {
  interface SessionData {
    /** Session-bound CSRF synchronizer token. */
    csrfToken?: string;
    userId?: string;
    /** User.sessionVersion at login; a password change increments it and revokes the session. */
    sessionVersion?: number;
    /** Epoch ms after which the session is rejected regardless of activity. */
    absoluteExpiresAt?: number;
  }
}

declare global {
  // Express merges this global namespace into its Request type.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      principal?: Principal;
    }
  }
}

const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Gives every request an id (Nginx's X-Request-ID when well-formed, else a new UUID), echoes it
 * in the response, and marks every API response private: nothing here may be cached by a proxy.
 * Optionally names the replica (demo evidence) and writes one structured log line per request.
 */
export function createRequestContext(
  config: Pick<AppConfig, 'INSTANCE_ID' | 'EXPOSE_INSTANCE_ID' | 'LOG_REQUESTS'>,
) {
  const log = new Logger('Http');
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = performance.now();
    const incoming = req.get('x-request-id');
    req.requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    if (config.EXPOSE_INSTANCE_ID) res.setHeader('X-Instance-ID', config.INSTANCE_ID);
    if (config.LOG_REQUESTS) {
      res.on('finish', () => {
        // Path only (no query string, body, cookies, or user data); ids in the path are UUIDs.
        const path = req.originalUrl.split('?')[0]!;
        // Container health probes run every few seconds: log them only when they fail.
        if (path.startsWith('/api/v1/health/') && res.statusCode < 400) return;
        log.log(
          JSON.stringify({
            requestId: req.requestId,
            instance: config.INSTANCE_ID,
            method: req.method,
            path,
            status: res.statusCode,
            durationMs: Math.round(performance.now() - started),
          }),
        );
      });
    }
    next();
  };
}
