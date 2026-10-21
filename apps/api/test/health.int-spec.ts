import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { APP_CONFIG, parseEnv } from '../src/config/env.js';

let app: NestExpressApplication | undefined;

async function startApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(parseEnv({ ...process.env, ...overrides }))
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health endpoints (real local Postgres and Redis)', () => {
  it('liveness answers without checking dependencies', async () => {
    const res = await request((await startApp()).getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('readiness is 200 when the control DB, both shards, and Redis answer', async () => {
    const res = await request((await startApp()).getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: { control: 'up', shardA: 'up', shardB: 'up', redis: 'up' },
    });
  });

  it('readiness is 503 when Redis is unreachable, while liveness stays 200', async () => {
    // Port 1 on loopback has nothing listening: a deterministic "Redis is down".
    const server = (await startApp({ REDIS_URL: 'redis://127.0.0.1:1' })).getHttpServer();
    const ready = await request(server).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({
      status: 'unready',
      checks: { control: 'up', shardA: 'up', shardB: 'up', redis: 'down' },
    });
    expect((await request(server).get('/api/v1/health/live')).status).toBe(200);
  });

  it('readiness reports only the failing shard and never leaks connection details', async () => {
    const server = (
      await startApp({ SHARD_B_DATABASE_URL: 'postgres://nobody:wrong@127.0.0.1:1/missing' })
    ).getHttpServer();
    const res = await request(server).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ control: 'up', shardA: 'up', shardB: 'down', redis: 'up' });
    expect(res.text).not.toMatch(/postgres:|redis:|127\.0\.0\.1|password/i);
  });
});
