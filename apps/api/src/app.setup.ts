import type { NestExpressApplication } from '@nestjs/platform-express';
import { createSessionMiddleware } from './auth/session.middleware.js';
import { createRequestContext } from './common/request-context.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { RedisService } from './redis/redis.service.js';

export const API_PREFIX = 'api/v1';

/** Settings shared by main.ts and the integration tests, so tests exercise the real app shape. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  // Nginx forwards /api/... unchanged, so Nest owns the full /api/v1 prefix.
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  // Trust X-Forwarded-For only from the reverse proxy: loopback (dev) or the private Docker
  // network (demo). Nginx overwrites the header with the real client address.
  app.set('trust proxy', 'loopback, uniquelocal');
  // Order matters: request id + no-store first, then the Redis-backed session.
  app.use(createRequestContext(config));
  app.use(createSessionMiddleware(config, app.get(RedisService)));
  // Close pools and Redis on SIGTERM/SIGINT (docker stop, Ctrl+C).
  app.enableShutdownHooks();
}
