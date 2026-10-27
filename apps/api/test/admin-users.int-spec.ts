// M6 gate: only current admins manage their own company's members; changes reach existing
// sessions on their next call; account writes and their audit commit together; and no
// interleaving of concurrent admin changes can leave a company without an active admin.
import type { CompanyUser, Page } from '@trp/contracts';
import { hashPassword, MembershipRole } from '@trp/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, withControl } from './support/fixture.js';
import { send, signIn, type Agent } from './support/session.js';
import { EMAIL, loadTenantFixture, ORGS } from './support/tenant-fixture.js';
import { startApp, type TestApp } from './support/test-app.js';

let t: TestApp;
const agents = {} as Record<'admin' | 'manager' | 'employee', Agent>;

/** Extra accounts owned by this file, so changing them cannot affect other test files. */
const EXTRA = {
  target: 'target@atlas.req', // MANAGER whose role and status the tests change
  birchA: 'admin-a@birch.req', // the two Birch admins used by the race
  birchB: 'admin-b@birch.req',
} as const;

const membershipOf = (email: string) =>
  withControl(async (c) => {
    const user = await c.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      include: { membership: true },
    });
    return user.membership!;
  });

const controlEvents = (targetId: string) =>
  withControl((c) => c.controlAuditEvent.findMany({ where: { targetId }, orderBy: { occurredAt: 'asc' } }));

const patch = (agent: Agent, membershipId: string, body: object) =>
  send(t, agent, 'patch', `/api/v1/admin/users/${membershipId}`, body);

const login = (agent: Agent, email: string, password: string) =>
  send(t, agent, 'post', '/api/v1/auth/login', { email, password });

beforeAll(async () => {
  await loadTenantFixture();
  const passwordHash = await hashPassword(PASSWORD);
  await withControl(async (c) => {
    const make = async (email: string, organizationId: string, role: MembershipRole) => {
      const user = await c.user.create({
        data: { normalizedEmail: email, displayName: email, passwordHash },
      });
      await c.membership.create({ data: { userId: user.id, organizationId, role } });
    };
    await make(EXTRA.target, ORGS.atlas, MembershipRole.MANAGER);
    await make(EXTRA.birchA, ORGS.birch, MembershipRole.ADMIN);
    await make(EXTRA.birchB, ORGS.birch, MembershipRole.ADMIN);
  });
  t = await startApp({
    LOGIN_LIMIT_PER_ACCOUNT: '1000',
    LOGIN_LIMIT_PER_IP: '1000',
    SESSION_CREATE_LIMIT_PER_IP: '1000',
  });
  agents.admin = await signIn(t, EMAIL.atlasAdmin);
  agents.manager = await signIn(t, EMAIL.atlasManager);
  agents.employee = await signIn(t, EMAIL.atlasEmployee);
});

afterAll(async () => {
  await t?.close();
});

describe('listing members', () => {
  it('an admin pages through their own company only, without duplicates', async () => {
    const seen: CompanyUser[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const page = (await agents.admin.get(`/api/v1/admin/users${qs}`).expect(200)).body as Page<CompanyUser>;
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    const emails = seen.map((u) => u.user.email);
    expect(new Set(seen.map((u) => u.membershipId)).size).toBe(seen.length);
    expect(emails).toContain(EMAIL.atlasAdmin);
    expect(emails).toContain(EXTRA.target);
    expect(emails.some((e) => e.endsWith('@cedar.req') || e.endsWith('@birch.req'))).toBe(false);
    // Explicit DTO: no password data, no session data.
    expect(JSON.stringify(seen)).not.toMatch(/passwordHash|sessionVersion|argon2/);
  });

  it('managers and employees get 403', async () => {
    expect((await agents.manager.get('/api/v1/admin/users')).status).toBe(403);
    expect((await agents.employee.get('/api/v1/admin/users')).status).toBe(403);
  });

  it('rejects a cursor from another list', async () => {
    const page = (await agents.admin.get('/api/v1/requests?limit=2').expect(200)).body;
    const res = await agents.admin.get(`/api/v1/admin/users?cursor=${encodeURIComponent(page.nextCursor)}`);
    expect(res.status).toBe(400);
  });
});

describe('creating accounts', () => {
  const temporaryPassword = 'temporary pass 1234';

  it('creates user + membership + audit event; the password is hashed and must be changed', async () => {
    const res = await send(t, agents.admin, 'post', '/api/v1/admin/users', {
      email: '  New.Hire@Atlas.REQ ',
      displayName: 'New Hire',
      role: 'EMPLOYEE',
      temporaryPassword,
    });
    expect(res.status).toBe(201);
    const created = res.body as CompanyUser;
    expect(created).toMatchObject({
      user: { email: 'new.hire@atlas.req', displayName: 'New Hire' },
      role: 'EMPLOYEE',
      isActive: true,
      mustChangePassword: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(temporaryPassword);

    const stored = await withControl((c) =>
      c.user.findUniqueOrThrow({
        where: { normalizedEmail: 'new.hire@atlas.req' },
        include: { membership: true },
      }),
    );
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.membership).toMatchObject({ organizationId: ORGS.atlas, role: 'EMPLOYEE' });

    const events = await controlEvents(created.membershipId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'MEMBER_CREATED',
      organizationId: ORGS.atlas,
      metadata: { role: 'EMPLOYEE' },
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(events)).not.toContain(temporaryPassword);
  });

  it('the new user can only change the password first, then works normally', async () => {
    const agent = t.agent();
    const first = await login(agent, 'new.hire@atlas.req', temporaryPassword);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);
    const blocked = await agent.get('/api/v1/requests');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const newPassword = 'my own long password';
    const changed = await send(t, agent, 'post', '/api/v1/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword,
    });
    expect(changed.status).toBe(204);
    const fresh = t.agent();
    expect((await login(fresh, 'new.hire@atlas.req', newPassword)).body.mustChangePassword).toBe(false);
    expect((await fresh.get('/api/v1/requests')).status).toBe(200);
  });

  it('an email used anywhere (even another company) gives a generic 409 and writes nothing', async () => {
    const before = await withControl((c) => Promise.all([c.user.count(), c.controlAuditEvent.count()]));
    for (const email of [EMAIL.cedarEmployee, '  EMPLOYEE@cedar.req ']) {
      const res = await send(t, agents.admin, 'post', '/api/v1/admin/users', {
        email,
        displayName: 'Duplicate',
        role: 'EMPLOYEE',
        temporaryPassword,
      });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: 'CONFLICT',
        message: 'An account cannot be created for this email',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/cedar/i);
    }
    const after = await withControl((c) => Promise.all([c.user.count(), c.controlAuditEvent.count()]));
    expect(after).toEqual(before);
  });

  it('rejects unknown fields, bad values, and non-admins', async () => {
    const valid = { email: 'x@atlas.req', displayName: 'X Person', role: 'EMPLOYEE', temporaryPassword };
    for (const body of [
      { ...valid, organizationId: ORGS.cedar },
      { ...valid, mustChangePassword: false },
      { ...valid, role: 'OWNER' },
      { ...valid, temporaryPassword: 'short' },
      { ...valid, email: 'not-an-email' },
    ]) {
      expect((await send(t, agents.admin, 'post', '/api/v1/admin/users', body)).status).toBe(400);
    }
    expect((await send(t, agents.manager, 'post', '/api/v1/admin/users', valid)).status).toBe(403);
    expect((await send(t, agents.employee, 'post', '/api/v1/admin/users', valid)).status).toBe(403);
  });
});

describe('changing roles and status', () => {
  it("a demoted manager's existing session gets 403 on the next company call", async () => {
    const target = await signIn(t, EXTRA.target);
    expect((await target.get('/api/v1/requests?scope=company')).status).toBe(200);
    const { id } = await membershipOf(EXTRA.target);

    const res = await patch(agents.admin, id, { role: 'EMPLOYEE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'EMPLOYEE', isActive: true });
    expect((await target.get('/api/v1/requests?scope=company')).status).toBe(403);
    expect((await target.get('/api/v1/requests?scope=mine')).status).toBe(200);

    const events = await controlEvents(id);
    expect(events.at(-1)).toMatchObject({
      action: 'MEMBER_ROLE_CHANGED',
      actorUserId: expect.any(String),
      metadata: { from: 'MANAGER', to: 'EMPLOYEE' },
    });
    expect((await patch(agents.admin, id, { role: 'MANAGER' })).status).toBe(200);
  });

  it('disabling ends existing sessions for good; re-enabling allows a NEW sign-in', async () => {
    const target = await signIn(t, EXTRA.target);
    const { id } = await membershipOf(EXTRA.target);

    expect((await patch(agents.admin, id, { isActive: false })).body.isActive).toBe(false);
    expect((await target.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login(t.agent(), EXTRA.target, PASSWORD)).status).toBe(401);

    expect((await patch(agents.admin, id, { isActive: true })).body.isActive).toBe(true);
    expect((await target.get('/api/v1/auth/me')).status).toBe(401); // old session stays dead
    const again = await signIn(t, EXTRA.target);
    expect((await again.get('/api/v1/auth/me')).status).toBe(200);

    const actions = (await controlEvents(id)).map((e) => e.action);
    expect(actions.slice(-2)).toEqual(['MEMBER_DISABLED', 'MEMBER_ENABLED']);
  });

  it('a no-op change writes no event', async () => {
    const { id } = await membershipOf(EXTRA.target);
    const before = (await controlEvents(id)).length;
    expect((await patch(agents.admin, id, { role: 'MANAGER', isActive: true })).status).toBe(200);
    expect(await controlEvents(id)).toHaveLength(before);
  });

  it("another company's member is 404, even on the same shard", async () => {
    const cedar = await membershipOf(EMAIL.cedarEmployee);
    const res = await patch(agents.admin, cedar.id, { role: 'ADMIN' });
    expect(res.status).toBe(404);
    expect((await membershipOf(EMAIL.cedarEmployee)).role).toBe('EMPLOYEE');
  });

  it('managers and employees cannot change anyone (403), and bodies are strict', async () => {
    const { id } = await membershipOf(EXTRA.target);
    expect((await patch(agents.manager, id, { role: 'ADMIN' })).status).toBe(403);
    expect((await patch(agents.employee, id, { isActive: false })).status).toBe(403);
    for (const body of [{}, { role: 'OWNER' }, { organizationId: ORGS.cedar, role: 'EMPLOYEE' }]) {
      expect((await patch(agents.admin, id, body)).status).toBe(400);
    }
    expect((await patch(agents.admin, 'not-a-uuid', { role: 'EMPLOYEE' })).status).toBe(400);
  });

  it('the only admin cannot demote or disable themselves (409 LAST_ADMIN)', async () => {
    const { id } = await membershipOf(EMAIL.atlasAdmin);
    for (const body of [{ role: 'MANAGER' }, { isActive: false }]) {
      const res = await patch(agents.admin, id, body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LAST_ADMIN');
    }
    expect(await controlEvents(id)).toHaveLength(0);
  });

  it('a failed audit insert rolls the change back', async () => {
    const { id } = await membershipOf(EXTRA.target);
    await withControl((c) => c.$executeRaw`REVOKE INSERT ON control_audit_events FROM trp_runtime`);
    try {
      const res = await patch(agents.admin, id, { role: 'EMPLOYEE' });
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    } finally {
      await withControl((c) => c.$executeRaw`GRANT INSERT ON control_audit_events TO trp_runtime`);
    }
    expect((await membershipOf(EXTRA.target)).role).toBe('MANAGER');
  });
});

describe('concurrency: the last active admin is protected', () => {
  const activeBirchAdmins = () =>
    withControl((c) =>
      c.membership.count({
        where: { organizationId: ORGS.birch, role: 'ADMIN', isActive: true, user: { isActive: true } },
      }),
    );

  const resetBirchAdmins = () =>
    withControl((c) =>
      c.membership.updateMany({
        where: { user: { normalizedEmail: { in: [EXTRA.birchA, EXTRA.birchB] } } },
        data: { role: 'ADMIN', isActive: true },
      }),
    );

  it('two admins removing admins at the same moment always leave exactly one (10 rounds)', async () => {
    const a = await membershipOf(EXTRA.birchA);
    const b = await membershipOf(EXTRA.birchB);
    for (let round = 0; round < 10; round += 1) {
      await resetBirchAdmins();
      const [agentA, agentB] = await Promise.all([signIn(t, EXTRA.birchA), signIn(t, EXTRA.birchB)]);
      // Even rounds: each demotes themselves. Odd rounds: each disables the other.
      const [ra, rb] =
        round % 2 === 0
          ? await Promise.all([
              patch(agentA, a.id, { role: 'EMPLOYEE' }),
              patch(agentB, b.id, { role: 'EMPLOYEE' }),
            ])
          : await Promise.all([
              patch(agentA, b.id, { isActive: false }),
              patch(agentB, a.id, { isActive: false }),
            ]);

      const statuses = [ra.status, rb.status].sort();
      expect(statuses[0]).toBe(200);
      // The loser is refused: 409 LAST_ADMIN, or 403/401 because it was itself removed first.
      expect([401, 403, 409]).toContain(statuses[1]);
      expect(await activeBirchAdmins()).toBe(1);
    }
    await resetBirchAdmins();
  });
});
