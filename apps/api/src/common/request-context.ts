import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { MembershipRole } from '@trp/contracts';
import type { ShardKey } from '@trp/database';

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
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  next();
}
