import { RedisStore } from 'connect-redis';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import session from 'express-session';
import type { ApiError } from '@trp/contracts';
import type { AppConfig } from '../config/env.js';
import type { RedisService } from '../redis/redis.service.js';

export const SESSION_COOKIE = 'trp.sid';

export function sessionCookieOptions(config: AppConfig) {
  return {
    httpOnly: true, // JavaScript cannot read it
    sameSite: 'lax' as const, // not sent on cross-site POSTs
    secure: config.COOKIE_SECURE, // true for any https origin; false only for loopback http
    path: '/',
  };
}

/**
 * Cookie sessions stored in Redis (shared by every API replica), never in process memory.
 * - saveUninitialized false: no Redis key until something is stored (the CSRF endpoint or login).
 * - rolling + TTL = idle timeout: each response pushes the expiry 30 minutes forward.
 * - The absolute 8-hour limit is enforced by the auth guard from absoluteExpiresAt.
 */
export function createSessionMiddleware(config: AppConfig, redis: RedisService): RequestHandler {
  const handler = session({
    name: SESSION_COOKIE,
    secret: config.SESSION_SECRET,
    store: new RedisStore({
      client: redis.client,
      prefix: `${redis.prefix}sess:`,
      ttl: config.SESSION_IDLE_SECONDS,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: 'destroy',
    cookie: { ...sessionCookieOptions(config), maxAge: config.SESSION_IDLE_SECONDS * 1000 },
  });

  // express-session reports store failures through next(err). Without Redis we cannot know who
  // the caller is, so fail closed with a 503 instead of continuing anonymously.
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (err?: unknown) => {
      if (!err) return next();
      // A failed save at the END of a response arrives after it was sent; nothing more to send.
      if (res.headersSent) return;
      const body: ApiError = {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
        requestId: req.requestId,
      };
      res.status(503).json(body);
    });
  };
}

/** Promise wrappers so guards and controllers can await session operations. */
export const regenerateSession = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
export const saveSession = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));
export const destroySession = (req: Request) =>
  new Promise<void>((resolve, reject) => req.session.destroy((err) => (err ? reject(err) : resolve())));
