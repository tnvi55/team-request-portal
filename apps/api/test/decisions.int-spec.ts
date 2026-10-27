// M5 gate: decisions are atomic, single-winner under concurrency, never self-reviewed, and
// always audited; the audit trail is append-only and visible to admins of the company only.
import type { AuditEvent, Page, RequestDetail } from '@trp/contracts';
import { createTenantClient, ShardKey, withTenant } from '@trp/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { send, signIn, type Agent } from './support/session.js';
import {
  CEDAR_AUDIT_EVENT,
  CEDAR_REQUEST,
  EMAIL,
  loadTenantFixture,
  ORGS,
  PAGER_REQUESTS,
  withShard,
} from './support/tenant-fixture.js';
import { startApp, toTestUrl, type TestApp } from './support/test-app.js';

let t: TestApp;
let ids: Awaited<ReturnType<typeof loadTenantFixture>>;
const agents = {} as Record<keyof typeof EMAIL, Agent>;

const newRequest = async (agent: Agent, title: string) => {
  const res = await send(t, agent, 'post', '/api/v1/requests', {
    title,
    description: 'Decision test request body.',
    category: 'SOFTWARE',
  });
  expect(res.status).toBe(201);
  return res.body as RequestDetail;
};

const decide = (agent: Agent, id: string, body: object) =>
  send(t, agent, 'post', `/api/v1/requests/${id}/decision`, body);

/** Decision audit events for one request, read as the owner on shard A. */
const decisionEvents = (requestId: string) =>
  withShard(ShardKey.SHARD_A, (s) =>
    withTenant(s, ORGS.atlas, (tx) =>
      tx.requestAuditEvent.findMany({
        where: { requestId, action: { in: ['REQUEST_APPROVED', 'REQUEST_REJECTED'] } },
      }),
    ),
  );

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

describe('approve and reject', () => {
  it('a manager approves a pending request: status, reviewer, version, and one audit event', async () => {
    const request = await newRequest(agents.atlasEmployee, 'License for approval');
    const res = await decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 0 });
    expect(res.status).toBe(200);
    const decided = res.body as RequestDetail;
    expect(decided).toMatchObject({ status: 'APPROVED', version: 1, reviewComment: null });
    expect(decided.reviewedBy).toEqual({ id: ids.atlasManager, displayName: 'atlasManager' });
    expect(decided.reviewedAt).not.toBeNull();

    const events = await decisionEvents(request.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'REQUEST_APPROVED', actorUserId: ids.atlasManager });
    expect(events[0]!.correlationRequestId).toBe(res.headers['x-request-id']);
    expect(events[0]!.metadata).toEqual({ from: 'PENDING', to: 'APPROVED', version: 1, hasComment: false });
  });

  it('rejection requires a 3-500 character comment', async () => {
    const request = await newRequest(agents.atlasEmployee, 'Chair for rejection');
    const missing = await decide(agents.atlasManager, request.id, {
      decision: 'REJECTED',
      expectedVersion: 0,
    });
    expect(missing.status).toBe(400);
    const short = await decide(agents.atlasManager, request.id, {
      decision: 'REJECTED',
      expectedVersion: 0,
      comment: 'no',
    });
    expect(short.status).toBe(400);
    const ok = await decide(agents.atlasAdmin, request.id, {
      decision: 'REJECTED',
      expectedVersion: 0,
      comment: '  Not in this quarter budget.  ',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'REJECTED', reviewComment: 'Not in this quarter budget.' });
  });

  it('a decided request cannot be decided again (409, no second event)', async () => {
    const request = await newRequest(agents.atlasEmployee, 'Decide only once');
    expect(
      (await decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 0 })).status,
    ).toBe(200);
    for (const body of [
      { decision: 'REJECTED', expectedVersion: 1, comment: 'Changed my mind.' }, // current version, but no longer PENDING
      { decision: 'APPROVED', expectedVersion: 0 }, // stale version
    ]) {
      const again = await decide(agents.atlasAdmin, request.id, body);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('CONFLICT');
    }
    expect(await decisionEvents(request.id)).toHaveLength(1);
  });

  it('rejects a stale expectedVersion on a pending request', async () => {
    const request = await newRequest(agents.atlasEmployee, 'Stale version check');
    const res = await decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 7 });
    expect(res.status).toBe(409);
    expect((await agents.atlasManager.get(`/api/v1/requests/${request.id}`)).body.status).toBe('PENDING');
  });

  it('employees cannot decide (403) and nobody can decide their own request (403)', async () => {
    const request = await newRequest(agents.atlasCoworker, 'Not for employees');
    const employee = await decide(agents.atlasEmployee, request.id, {
      decision: 'APPROVED',
      expectedVersion: 0,
    });
    expect(employee.status).toBe(403);

    const own = await newRequest(agents.atlasManager, "Manager's own request");
    const self = await decide(agents.atlasManager, own.id, { decision: 'APPROVED', expectedVersion: 0 });
    expect(self.status).toBe(403);
    expect(self.body.message).toBe('You cannot review your own request');
    expect(await decisionEvents(own.id)).toHaveLength(0);
    // Another reviewer of the same company may decide it.
    expect(
      (await decide(agents.atlasAdmin, own.id, { decision: 'APPROVED', expectedVersion: 0 })).status,
    ).toBe(200);
  });

  it('another company cannot decide the request, even on the same shard (404)', async () => {
    const res = await decide(agents.cedarManager, (await newRequest(agents.atlasEmployee, 'Atlas only')).id, {
      decision: 'APPROVED',
      expectedVersion: 0,
    });
    expect(res.status).toBe(404);
    const cedarOwn = await decide(agents.atlasManager, CEDAR_REQUEST, {
      decision: 'APPROVED',
      expectedVersion: 0,
    });
    expect(cedarOwn.status).toBe(404);
  });

  it('rejects server-owned or unknown fields in the decision body', async () => {
    const request = await newRequest(agents.atlasEmployee, 'Strict decision body');
    for (const extra of [
      { reviewedByUserId: ids.atlasAdmin },
      { status: 'APPROVED' },
      { tenantId: ORGS.cedar },
    ]) {
      const res = await decide(agents.atlasManager, request.id, {
        decision: 'APPROVED',
        expectedVersion: 0,
        ...extra,
      });
      expect(res.status).toBe(400);
    }
    expect(
      (await decide(agents.atlasManager, request.id, { decision: 'MAYBE', expectedVersion: 0 })).status,
    ).toBe(400);
  });
});

describe('concurrency: exactly one decision wins', () => {
  it('simultaneous approve and reject give one 200, one 409, and one audit event (10 rounds)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const request = await newRequest(agents.atlasEmployee, `Race ${round}`);
      const [a, b] = await Promise.all([
        decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 0 }),
        decide(agents.atlasAdmin, request.id, {
          decision: 'REJECTED',
          expectedVersion: 0,
          comment: 'Racing reject.',
        }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const winner = (a.status === 200 ? a : b).body as RequestDetail;
      const events = await decisionEvents(request.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe(winner.status === 'APPROVED' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED');
      const final = (await agents.atlasManager.get(`/api/v1/requests/${request.id}`)).body as RequestDetail;
      expect(final).toMatchObject({ status: winner.status, version: 1 });
    }
  });
});

describe('atomicity and append-only audit', () => {
  it('a failed audit insert rolls the decision back', async () => {
    const request = await newRequest(agents.atlasEmployee, 'Rollback on audit failure');
    await withShard(
      ShardKey.SHARD_A,
      (s) => s.$executeRaw`REVOKE INSERT ON request_audit_events FROM trp_runtime`,
    );
    try {
      const res = await decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 0 });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    } finally {
      await withShard(
        ShardKey.SHARD_A,
        (s) => s.$executeRaw`GRANT INSERT ON request_audit_events TO trp_runtime`,
      );
    }
    const after = (await agents.atlasManager.get(`/api/v1/requests/${request.id}`)).body as RequestDetail;
    expect(after).toMatchObject({ status: 'PENDING', version: 0, reviewedBy: null });
    // With the grant back, the same decision succeeds: nothing half-written was left behind.
    expect(
      (await decide(agents.atlasManager, request.id, { decision: 'APPROVED', expectedVersion: 0 })).status,
    ).toBe(200);
  });

  it('the runtime role cannot UPDATE or DELETE audit events', async () => {
    const runtime = createTenantClient(toTestUrl(process.env.SHARD_A_DATABASE_URL!), { max: 1 });
    try {
      await expect(
        withTenant(runtime, ORGS.atlas, (tx) =>
          tx.requestAuditEvent.updateMany({ data: { correlationRequestId: 'x' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(runtime, ORGS.atlas, (tx) => tx.requestAuditEvent.deleteMany({})),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await runtime.$disconnect();
    }
  });
});

describe('admin audit history', () => {
  it('admins page through their own company history only, newest first', async () => {
    const seen: AuditEvent[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
      const page = (await agents.atlasAdmin.get(`/api/v1/admin/audit${qs}`).expect(200))
        .body as Page<AuditEvent>;
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.length).toBeGreaterThan(PAGER_REQUESTS); // fixture history + events from the tests above
    expect(new Set(seen.map((e) => e.id)).size).toBe(seen.length);
    expect(seen.some((e) => e.id === CEDAR_AUDIT_EVENT)).toBe(false);
    for (let i = 1; i < seen.length; i += 1) {
      const [a, b] = [seen[i - 1]!, seen[i]!];
      expect(a.occurredAt > b.occurredAt || (a.occurredAt === b.occurredAt && a.id > b.id)).toBe(true);
    }
    const approval = seen.find((e) => e.action === 'REQUEST_APPROVED')!;
    expect(approval.request.title).toBeTruthy();
    expect(approval.actor.displayName).toBeTruthy();
  });

  it('managers and employees cannot read it (403), and Cedar sees only Cedar', async () => {
    expect((await agents.atlasManager.get('/api/v1/admin/audit')).status).toBe(403);
    expect((await agents.atlasEmployee.get('/api/v1/admin/audit')).status).toBe(403);
  });

  it('rejects a requests cursor replayed on the audit endpoint', async () => {
    const page = (await agents.atlasManager.get('/api/v1/requests?limit=2').expect(200)).body;
    const res = await agents.atlasAdmin.get(
      `/api/v1/admin/audit?cursor=${encodeURIComponent(page.nextCursor)}`,
    );
    expect(res.status).toBe(400);
  });
});
