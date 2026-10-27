import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { startApp, toTestUrl, type TestApp } from './support/test-app.js';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('health endpoints (real local Postgres and Redis)', () => {
  it('liveness answers without checking dependencies', async () => {
    t = await startApp();
    const res = await request(t.app.getHttpServer()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('readiness is 200 when the control DB, both shards, Redis, and every migration are in place', async () => {
    t = await startApp();
    const res = await request(t.app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ready',
      checks: { control: 'up', shardA: 'up', shardB: 'up', redis: 'up', migrations: 'up' },
    });
  });

  it('readiness is 503 when Redis is unreachable, while liveness stays 200', async () => {
    // Port 1 on loopback has nothing listening: a deterministic "Redis is down".
    t = await startApp({ REDIS_URL: 'redis://127.0.0.1:1' });
    const server = t.app.getHttpServer();
    const ready = await request(server).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({
      status: 'unready',
      checks: { control: 'up', shardA: 'up', shardB: 'up', redis: 'down', migrations: 'up' },
    });
    expect((await request(server).get('/api/v1/health/live')).status).toBe(200);
  });

  it('readiness is 503 when a database lacks a committed migration', async () => {
    // A shard database standing in for control: reachable, but its history has no control-only
    // migration, exactly like a replica started before `pnpm db:migrate:all` ran.
    t = await startApp({ CONTROL_DATABASE_URL: toTestUrl(process.env.SHARD_A_DATABASE_URL!) });
    const res = await request(t.app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unready',
      checks: { control: 'up', shardA: 'up', shardB: 'up', redis: 'up', migrations: 'down' },
    });
  });

  it('readiness reports only the failing shard and never leaks connection details', async () => {
    t = await startApp({ SHARD_B_DATABASE_URL: 'postgres://nobody:wrong@127.0.0.1:1/missing' });
    const res = await request(t.app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    // Shard B's migration history cannot be read either, so migrations are not confirmed.
    expect(res.body.checks).toEqual({
      control: 'up',
      shardA: 'up',
      shardB: 'down',
      redis: 'up',
      migrations: 'down',
    });
    expect(res.text).not.toMatch(/postgres:|redis:|127\.0\.0\.1|password/i);
  });
});
