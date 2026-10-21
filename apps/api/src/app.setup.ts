import type { NestExpressApplication } from '@nestjs/platform-express';

export const API_PREFIX = 'api/v1';

/** Settings shared by main.ts and the integration tests, so tests exercise the real app shape. */
export function configureApp(app: NestExpressApplication): void {
  // Nginx forwards /api/... unchanged, so Nest owns the full /api/v1 prefix.
  app.setGlobalPrefix(API_PREFIX);
  app.disable('x-powered-by');
  // Close pools and Redis on SIGTERM/SIGINT (docker stop, Ctrl+C).
  app.enableShutdownHooks();
}
