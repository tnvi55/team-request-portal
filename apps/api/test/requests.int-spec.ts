// M4 gate: tenant context, ownership, same-shard and cross-shard isolation, atomic create+audit,
// and cursor pagination, through the real API against *_test Postgres and Redis.
import type { Page, RequestDetail, RequestSummary } from '@trp/contracts';
import { ShardKey, withTenant } from '@trp/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD } from './support/fixture.js';
import {
  BIRCH_REQUEST,
  CEDAR_REQUEST,
  EMAIL,
  loadTenantFixture,
  ORGS,
  PAGER_REQUESTS,
  withShard,
} from './support/tenant-fixture.js';
import { startApp, type TestApp } from './support/test-app.js';

type Agent = ReturnType<TestApp['agent']>;

let t: TestApp;
let ids: Awaited<ReturnType<typeof loadTenantFixture>>;
const agents = {} as Record<keyof typeof EMAIL, Agent>;

async function signIn(app: TestApp, email: string): Promise<Agent> {
  const agent = app.agent();
  const token = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', app.config.APP_ORIGIN)
    .set('X-CSRF-Token', token)
    .send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

async function createRequest(agent: Agent, body: object, app: TestApp = t) {
  const token = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
  return agent
    .post('/api/v1/requests')
    .set('Origin', app.config.APP_ORIGIN)
    .set('X-CSRF-Token', token)
    .send(body);
}

const valid = {
  title: 'Monitor for workstation',
  description: 'A 27-inch monitor for design work.',
  category: 'EQUIPMENT',
};

beforeAll(async () => {
  ids = await loadTenantFixture();
  t = await startApp({
    LOGIN_LIMIT_PER_ACCOUNT: '1000',
    LOGIN_LIMIT_PER_IP: '1000',
    SESSION_CREATE_LIMIT_PER_IP: '1000',
  });
  for (const key of Object.keys(EMAIL) as (keyof typeof EMAIL)[]) agents[key] = await signIn(t, EMAIL[key]);
});

afterAll(async () => {
  await t?.close();
});

describe('creating a request', () => {
  it('creates a PENDING request owned by the caller, with its audit event in the same shard', async () => {
    const res = await createRequest(agents.atlasEmployee, { ...valid, title: '  Monitor for workstation  ' });
    expect(res.status).toBe(201);
    const created = res.body as RequestDetail;
    expect(created.title).toBe('Monitor for workstation'); // trimmed
    expect(created.status).toBe('PENDING');
    expect(created.version).toBe(0);
    expect(created.createdBy).toEqual({ id: ids.atlasEmployee, displayName: 'atlasEmployee' });
    expect(JSON.stringify(created)).not.toContain(ORGS.atlas); // tenant id never leaves the API

    const audit = await withShard(ShardKey.SHARD_A, (shard) =>
      withTenant(shard, ORGS.atlas, (tx) =>
        tx.requestAuditEvent.findMany({ where: { requestId: created.id } }),
      ),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'REQUEST_CREATED', actorUserId: ids.atlasEmployee });
    expect(audit[0]!.correlationRequestId).toBe(res.headers['x-request-id']);
  });

  it('rejects server-owned fields sent by the caller', async () => {
    for (const extra of [
      { tenantId: ORGS.cedar },
      { status: 'APPROVED' },
      { createdByUserId: ids.atlasManager },
      { shard: 'SHARD_B' },
    ]) {
      const res = await createRequest(agents.atlasEmployee, { ...valid, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('validates lengths and category', async () => {
    expect((await createRequest(agents.atlasEmployee, { ...valid, title: 'ab' })).status).toBe(400);
    expect((await createRequest(agents.atlasEmployee, { ...valid, description: 'too short' })).status).toBe(
      400,
    );
    expect((await createRequest(agents.atlasEmployee, { ...valid, category: 'CARS' })).status).toBe(400);
  });

  it('stores a Birch request on shard B only (routing through the directory)', async () => {
    const res = await createRequest(agents.birchEmployee, { ...valid, title: 'Birch scanner' });
    expect(res.status).toBe(201);
    const id = (res.body as RequestDetail).id;
    const onB = await withShard(ShardKey.SHARD_B, (s) =>
      withTenant(s, ORGS.birch, (tx) => tx.request.count({ where: { id } })),
    );
    const onA = await withShard(ShardKey.SHARD_A, (s) =>
      withTenant(s, ORGS.birch, (tx) => tx.request.count({ where: { id } })),
    );
    expect([onA, onB]).toEqual([0, 1]);
  });

  it('commits nothing when the audit insert fails (real database fault, no test hook in the app)', async () => {
    const before = await withShard(ShardKey.SHARD_A, (s) =>
      withTenant(s, ORGS.atlas, (tx) => tx.request.count()),
    );
    // Owner revokes the runtime role's INSERT on the audit table for a moment.
    await withShard(
      ShardKey.SHARD_A,
      (s) => s.$executeRaw`REVOKE INSERT ON request_audit_events FROM trp_runtime`,
    );
    try {
      const res = await createRequest(agents.atlasEmployee, { ...valid, title: 'Should roll back' });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(/permission|request_audit_events|trp_runtime/i);
    } finally {
      await withShard(
        ShardKey.SHARD_A,
        (s) => s.$executeRaw`GRANT INSERT ON request_audit_events TO trp_runtime`,
      );
    }
    const after = await withShard(ShardKey.SHARD_A, (s) =>
      withTenant(s, ORGS.atlas, (tx) => tx.request.count()),
    );
    expect(after).toBe(before);
  });
});

describe('ownership: employees see only their own requests', () => {
  let coworkerRequest: string;

  beforeAll(async () => {
    coworkerRequest = (
      (await createRequest(agents.atlasCoworker, { ...valid, title: 'Coworker chair' })).body as RequestDetail
    ).id;
  });

  it("an employee cannot read a coworker's request (404, not 403)", async () => {
    const res = await agents.atlasEmployee.get(`/api/v1/requests/${coworkerRequest}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await agents.atlasCoworker.get(`/api/v1/requests/${coworkerRequest}`)).status).toBe(200);
  });

  it("an employee's list contains only their own requests, and the company view is refused", async () => {
    const page = (await agents.atlasEmployee.get('/api/v1/requests').expect(200))
      .body as Page<RequestSummary>;
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((r) => r.createdBy.id === ids.atlasEmployee)).toBe(true);
    const company = await agents.atlasEmployee.get('/api/v1/requests?scope=company');
    expect(company.status).toBe(403);
    expect(company.body.code).toBe('FORBIDDEN');
  });

  it("a manager sees the company's requests, including the coworker's", async () => {
    expect((await agents.atlasManager.get(`/api/v1/requests/${coworkerRequest}`)).status).toBe(200);
    const page = (await agents.atlasManager.get('/api/v1/requests?limit=100').expect(200))
      .body as Page<RequestSummary>;
    const creators = new Set(page.items.map((r) => r.createdBy.id));
    expect(creators.has(ids.atlasCoworker)).toBe(true);
    expect(creators.has(ids.atlasPager)).toBe(true);
  });
});

describe('tenant isolation through the API', () => {
  it('Atlas cannot read Cedar although both live on shard A', async () => {
    expect((await agents.atlasManager.get(`/api/v1/requests/${CEDAR_REQUEST}`)).status).toBe(404);
    const page = (await agents.atlasManager.get('/api/v1/requests?limit=100').expect(200))
      .body as Page<RequestSummary>;
    expect(page.items.some((r) => r.id === CEDAR_REQUEST)).toBe(false);
    expect((await agents.cedarManager.get(`/api/v1/requests/${CEDAR_REQUEST}`)).status).toBe(200);
  });

  it('Atlas cannot read Birch, which lives on shard B', async () => {
    expect((await agents.atlasManager.get(`/api/v1/requests/${BIRCH_REQUEST}`)).status).toBe(404);
    expect((await agents.birchEmployee.get(`/api/v1/requests/${BIRCH_REQUEST}`)).status).toBe(200);
  });

  it('query parameters cannot choose another tenant or shard', async () => {
    for (const q of [`tenantId=${ORGS.cedar}`, 'shard=SHARD_B', 'createdByUserId=x']) {
      const res = await agents.atlasManager.get(`/api/v1/requests?${q}`);
      expect(res.status).toBe(400);
    }
  });

  it('rejects malformed ids before touching the database', async () => {
    const res = await agents.atlasManager.get("/api/v1/requests/1' OR '1'='1");
    expect(res.status).toBe(400);
  });

  it('dashboard counts stay inside the tenant and the caller scope', async () => {
    const pager = (await agents.atlasPager.get('/api/v1/dashboard').expect(200)).body;
    expect(pager.scope).toBe('mine');
    expect(pager.counts).toEqual({ PENDING: 15, APPROVED: 15, REJECTED: 15, total: PAGER_REQUESTS });

    const atlas = (await agents.atlasManager.get('/api/v1/dashboard').expect(200)).body;
    expect(atlas.scope).toBe('company');
    const cedar = (await agents.cedarManager.get('/api/v1/dashboard').expect(200)).body;
    expect(cedar.counts.total).toBe(1); // only Cedar's own request, despite sharing shard A with Atlas
    expect(atlas.counts.total).toBeGreaterThan(PAGER_REQUESTS);

    expect((await agents.atlasEmployee.get('/api/v1/dashboard?scope=company')).status).toBe(403);
  });

  it('fails closed with 503 for a company without a directory entry', async () => {
    const res = await agents.ghostEmployee.get('/api/v1/requests');
    expect(res.status).toBe(503);
    expect((await agents.ghostEmployee.get('/api/v1/auth/me')).status).toBe(200); // identity still works
  });

  it("an unavailable shard fails only that shard's companies, never falling back", async () => {
    const broken = await startApp({
      SHARD_B_DATABASE_URL: 'postgres://trp_runtime:wrong@127.0.0.1:1/trp_shard_b_test',
      LOGIN_LIMIT_PER_ACCOUNT: '1000',
    });
    try {
      const birch = await signIn(broken, EMAIL.birchEmployee);
      const res = await birch.get('/api/v1/requests');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
      const atlas = await signIn(broken, EMAIL.atlasPager);
      expect((await atlas.get('/api/v1/requests')).status).toBe(200);
    } finally {
      await broken.close();
    }
  });
});

describe('cursor pagination', () => {
  async function allPages(agent: Agent, query = '') {
    const seen: RequestSummary[] = [];
    const flags: boolean[] = [];
    let cursor: string | null = null;
    do {
      const qs = [query, 'limit=20', cursor ? `cursor=${encodeURIComponent(cursor)}` : '']
        .filter(Boolean)
        .join('&');
      const page = (await agent.get(`/api/v1/requests?${qs}`).expect(200)).body as Page<RequestSummary>;
      seen.push(...page.items);
      flags.push(page.hasMore);
      cursor = page.nextCursor;
    } while (cursor);
    return { seen, flags };
  }

  it('walks every request once, newest first, with ties broken by id', async () => {
    const { seen, flags } = await allPages(agents.atlasPager);
    expect(seen).toHaveLength(PAGER_REQUESTS);
    expect(new Set(seen.map((r) => r.id)).size).toBe(PAGER_REQUESTS); // no duplicates, no gaps
    expect(flags).toEqual([true, true, false]); // 20 + 20 + 5
    for (let i = 1; i < seen.length; i += 1) {
      const [a, b] = [seen[i - 1]!, seen[i]!];
      expect(a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id)).toBe(true);
    }
  });

  it('applies status and category filters across pages', async () => {
    const { seen } = await allPages(agents.atlasPager, 'status=APPROVED');
    expect(seen).toHaveLength(15);
    expect(seen.every((r) => r.status === 'APPROVED')).toBe(true);
    const { seen: software } = await allPages(agents.atlasPager, 'category=SOFTWARE&status=REJECTED');
    expect(software.every((r) => r.category === 'SOFTWARE' && r.status === 'REJECTED')).toBe(true);
  });

  it('returns an empty page for no matches', async () => {
    const page = (await agents.cedarEmployee.get('/api/v1/requests?status=APPROVED').expect(200)).body;
    expect(page).toEqual({ items: [], hasMore: false, nextCursor: null });
  });

  it('rejects cursors that are tampered with or replayed for another list, user, or company', async () => {
    const first = (await agents.atlasPager.get('/api/v1/requests?limit=5').expect(200))
      .body as Page<RequestSummary>;
    const cursor = encodeURIComponent(first.nextCursor!);
    expect((await agents.atlasPager.get(`/api/v1/requests?limit=5&cursor=${cursor}`)).status).toBe(200);

    const cases = [
      agents.atlasPager.get(`/api/v1/requests?limit=5&status=PENDING&cursor=${cursor}`), // other filter
      agents.atlasEmployee.get(`/api/v1/requests?limit=5&cursor=${cursor}`), // other user (mine scope)
      agents.cedarEmployee.get(`/api/v1/requests?limit=5&cursor=${cursor}`), // other company
      agents.atlasPager.get(`/api/v1/requests?limit=5&cursor=${cursor.slice(0, -2)}xx`), // tampered
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid cursor');
    }
  });

  it('bounds the page size', async () => {
    expect((await agents.atlasPager.get('/api/v1/requests?limit=101')).status).toBe(400);
    expect((await agents.atlasPager.get('/api/v1/requests?limit=0')).status).toBe(400);
    const page = (await agents.atlasPager.get('/api/v1/requests').expect(200)).body as Page<RequestSummary>;
    expect(page.items).toHaveLength(20); // default
  });
});
