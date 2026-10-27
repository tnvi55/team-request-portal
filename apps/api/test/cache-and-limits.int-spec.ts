// M7 gate: the dashboard cache is scoped (tenant + scope + user), short-lived, invalidated after
// committed writes, never consulted before authorization, and falls back to the database when
// Redis misbehaves. The per-user API limit is one counter shared by every replica.
import { Logger } from '@nestjs/common';
import type { DashboardResponse, RequestDetail } from '@trp/contracts';
import { RequestCategory, ShardKey, withTenant } from '@trp/database';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PASSWORD } from './support/fixture.js';
import { send, signIn, type Agent } from './support/session.js';
import { EMAIL, loadTenantFixture, ORGS, withShard } from './support/tenant-fixture.js';
import { freshPrefix, startApp, type TestApp } from './support/test-app.js';

const TTL_SECONDS = 2;
let t: TestApp;
let ids: Awaited<ReturnType<typeof loadTenantFixture>>;
const agents = {} as Record<'employee' | 'coworker' | 'manager' | 'cedarManager', Agent>;

const dashboard = async (agent: Agent, scope?: 'mine' | 'company') => {
  const res = await agent.get(`/api/v1/dashboard${scope ? `?scope=${scope}` : ''}`);
  expect(res.status).toBe(200);
  return { cache: res.headers['x-dashboard-cache'] as string, body: res.body as DashboardResponse };
};

const companyKey = (tenantId: string) => `${t.config.REDIS_KEY_PREFIX}cache:v1:dashboard:${tenantId}:company`;

/** A raw Redis connection for inspecting and tampering with cache keys. */
const rawClient = () => createClient({ url: t.config.REDIS_URL });
async function withRedis<T>(work: (r: ReturnType<typeof rawClient>) => Promise<T>): Promise<T> {
  const r = rawClient();
  await r.connect();
  try {
    return await work(r);
  } finally {
    await r.close();
  }
}

/** Writes a request straight into the shard, bypassing the API (so nothing invalidates the cache). */
const insertBehindTheApi = () =>
  withShard(ShardKey.SHARD_A, (s) =>
    withTenant(s, ORGS.atlas, (tx) =>
      tx.request.create({
        data: {
          tenantId: ORGS.atlas,
          title: 'Inserted behind the API',
          description: 'Proves the cache serves old counts until it expires.',
          category: RequestCategory.OTHER,
          createdByUserId: ids.atlasPager,
        },
      }),
    ),
  );

beforeAll(async () => {
  ids = await loadTenantFixture();
  t = await startApp({ DASHBOARD_CACHE_TTL_SECONDS: String(TTL_SECONDS) });
  agents.employee = await signIn(t, EMAIL.atlasEmployee);
  agents.coworker = await signIn(t, EMAIL.atlasCoworker);
  agents.manager = await signIn(t, EMAIL.atlasManager);
  agents.cedarManager = await signIn(t, EMAIL.cedarManager);
});

afterAll(async () => {
  await t?.close();
});

describe('dashboard cache', () => {
  it('the first read is a miss, the next one a hit with the same counts', async () => {
    const first = await dashboard(agents.manager);
    const second = await dashboard(agents.manager);
    expect(first.cache).toBe('miss');
    expect(second).toEqual({ cache: 'hit', body: first.body });
    expect(first.body.scope).toBe('company');
  });

  it('serves the cached counts until the TTL expires, then reads the database again', async () => {
    const before = (await dashboard(agents.manager)).body.counts.total;
    await insertBehindTheApi();
    const stale = await dashboard(agents.manager);
    expect(stale.cache).toBe('hit');
    expect(stale.body.counts.total).toBe(before); // eventually consistent, by design

    await new Promise((resolve) => setTimeout(resolve, TTL_SECONDS * 1000 + 300));
    const fresh = await dashboard(agents.manager);
    expect(fresh.cache).toBe('miss');
    expect(fresh.body.counts.total).toBe(before + 1);
  });

  it('a committed create or decision drops the company and the submitter counts at once', async () => {
    const company = (await dashboard(agents.manager)).body.counts;
    const mine = (await dashboard(agents.employee)).body.counts;
    expect((await dashboard(agents.manager)).cache).toBe('hit');
    expect((await dashboard(agents.employee)).cache).toBe('hit');

    const created = await send(t, agents.employee, 'post', '/api/v1/requests', {
      title: 'Invalidation check',
      description: 'Creating this must clear the cached counts.',
      category: 'SOFTWARE',
    });
    expect(created.status).toBe(201);
    const afterCreate = await dashboard(agents.manager);
    expect(afterCreate.cache).toBe('miss');
    expect(afterCreate.body.counts).toMatchObject({ total: company.total + 1, PENDING: company.PENDING + 1 });
    const mineAfterCreate = await dashboard(agents.employee);
    expect(mineAfterCreate.cache).toBe('miss');
    expect(mineAfterCreate.body.counts.PENDING).toBe(mine.PENDING + 1);

    const id = (created.body as RequestDetail).id;
    expect(
      (
        await send(t, agents.manager, 'post', `/api/v1/requests/${id}/decision`, {
          decision: 'APPROVED',
          expectedVersion: 0,
        })
      ).status,
    ).toBe(200);
    const afterDecision = await dashboard(agents.manager);
    expect(afterDecision.cache).toBe('miss');
    expect(afterDecision.body.counts).toMatchObject({
      PENDING: company.PENDING,
      APPROVED: company.APPROVED + 1,
    });
    expect((await dashboard(agents.employee)).body.counts.APPROVED).toBe(mine.APPROVED + 1);
  });

  it('keys separate companies and people: nobody is served another key', async () => {
    await send(t, agents.employee, 'post', '/api/v1/requests', {
      title: 'Only mine',
      description: 'Counts for the employee, never the coworker.',
      category: 'OTHER',
    });
    const employee = await dashboard(agents.employee);
    const coworker = await dashboard(agents.coworker);
    expect(employee.body.counts.total).toBeGreaterThan(0);
    expect(coworker.body.counts.total).toBe(0);
    expect(coworker.cache).toBe('miss'); // its own key, not the employee's cached entry

    const atlas = await dashboard(agents.manager);
    const cedar = await dashboard(agents.cedarManager);
    expect(cedar.body.counts.total).toBe(1); // Cedar's one fixture request, never Atlas's
    expect(atlas.body.counts.total).toBeGreaterThan(40);

    const keys = await withRedis((r) => r.keys(`${t.config.REDIS_KEY_PREFIX}cache:*`));
    expect(keys).toEqual(
      expect.arrayContaining([
        companyKey(ORGS.atlas),
        companyKey(ORGS.cedar),
        `${t.config.REDIS_KEY_PREFIX}cache:v1:dashboard:${ORGS.atlas}:mine:${ids.atlasEmployee}`,
        `${t.config.REDIS_KEY_PREFIX}cache:v1:dashboard:${ORGS.atlas}:mine:${ids.atlasCoworker}`,
      ]),
    );
  });

  it('checks the role before the cache: a cached company entry never reaches an employee', async () => {
    await dashboard(agents.manager); // the company entry is cached now
    const res = await agents.employee.get('/api/v1/dashboard?scope=company');
    expect(res.status).toBe(403);
    expect(res.headers['x-dashboard-cache']).toBeUndefined();
  });

  it('falls back to the database when the cached entry cannot be read', async () => {
    const truth = (await dashboard(agents.cedarManager)).body;
    // A Redis error on read (wrong key type) and an unreadable value: both mean "use the DB".
    await withRedis(async (r) => {
      await r.del(companyKey(ORGS.cedar));
      await r.hSet(companyKey(ORGS.cedar), 'broken', '1');
    });
    const afterError = await dashboard(agents.cedarManager);
    expect(afterError).toEqual({ cache: 'miss', body: truth });

    await withRedis((r) => r.set(companyKey(ORGS.cedar), 'not json'));
    expect(await dashboard(agents.cedarManager)).toEqual({ cache: 'miss', body: truth });
    expect((await dashboard(agents.cedarManager)).cache).toBe('hit'); // healed by the DB read
  });
});

describe('shared authenticated API limit across replicas', () => {
  let one: TestApp;
  let two: TestApp;

  beforeAll(async () => {
    // Two app instances sharing Redis and its key prefix: exactly what api-1 and api-2 are.
    const shared = {
      REDIS_KEY_PREFIX: freshPrefix(),
      API_LIMIT_PER_MINUTE: '5',
      EXPOSE_INSTANCE_ID: 'true',
    };
    one = await startApp({ ...shared, INSTANCE_ID: 'api-1' });
    two = await startApp({ ...shared, INSTANCE_ID: 'api-2' });
  });

  afterAll(async () => {
    await Promise.all([one?.close(), two?.close()]);
  });

  /** Signs in through replica `app` and returns the session cookie. */
  async function cookieFor(app: TestApp, email: string): Promise<string> {
    const csrf = await request(app.app.getHttpServer()).get('/api/v1/auth/csrf');
    const anon = (csrf.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const login = await request(app.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', anon)
      .set('Origin', app.config.APP_ORIGIN)
      .set('X-CSRF-Token', csrf.body.csrfToken)
      .send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return (login.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  }

  it('one session works on both replicas and both count against the same limit', async () => {
    const cookie = await cookieFor(one, EMAIL.atlasManager);
    const seen: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const app = i % 2 === 0 ? one : two;
      const res = await request(app.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(200);
      seen.push(res.headers['x-instance-id'] as string);
    }
    expect(seen).toEqual(['api-1', 'api-2', 'api-1', 'api-2', 'api-1']);

    const sixth = await request(two.app.getHttpServer()).get('/api/v1/requests').set('Cookie', cookie);
    expect(sixth.status).toBe(429);
    expect(sixth.body.code).toBe('RATE_LIMITED');
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(sixth.headers['retry-after'])).toBeLessThanOrEqual(60);

    // Another person has their own counter; public endpoints are not counted.
    const other = await cookieFor(two, EMAIL.atlasEmployee);
    expect((await request(one.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', other)).status).toBe(
      200,
    );
    expect((await request(one.app.getHttpServer()).get('/api/v1/health/live')).status).toBe(200);
  });
});

describe('observability', () => {
  it('names the replica only when EXPOSE_INSTANCE_ID is on', async () => {
    const res = await request(t.app.getHttpServer()).get('/api/v1/health/live');
    expect(res.headers['x-instance-id']).toBeUndefined();
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs one structured line per request: id, path without query, status, duration', async () => {
    const logged = await startApp({ LOG_REQUESTS: 'true', INSTANCE_ID: 'api-log' });
    const spy = vi.spyOn(Logger.prototype, 'log');
    try {
      const agent = await signIn(logged, EMAIL.atlasManager);
      const res = await agent.get('/api/v1/requests?scope=company&limit=1');
      const lines = spy.mock.calls
        .map(([message]) => String(message))
        .filter((m) => m.includes(res.headers['x-request-id'] as string));
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]!);
      expect(entry).toMatchObject({
        requestId: res.headers['x-request-id'],
        instance: 'api-log',
        method: 'GET',
        path: '/api/v1/requests',
        status: 200,
      });
      expect(typeof entry.durationMs).toBe('number');
      expect(lines[0]).not.toMatch(/scope=|cookie|trp\.sid|password/i);

      // Successful health probes (Docker polls them every few seconds) are not logged.
      const probe = await request(logged.app.getHttpServer()).get('/api/v1/health/live');
      const probeId = probe.headers['x-request-id'] as string;
      expect(spy.mock.calls.some(([message]) => String(message).includes(probeId))).toBe(false);
    } finally {
      spy.mockRestore();
      await logged.close();
    }
  });
});
