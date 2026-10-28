// M3 gate: authentication against real local Postgres (*_test) and Redis.
import { Controller, Get } from '@nestjs/common';
import type { ApiError, MeResponse } from '@trp/contracts';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAuthFixture, PASSWORD, USERS, withControl } from './support/fixture.js';
import { freshPrefix, startApp, type TestApp } from './support/test-app.js';

/** A protected route that is NOT allowed while a password change is pending. */
@Controller('test-probe')
class ProbeController {
  @Get()
  ok() {
    return { ok: true };
  }
}

type Agent = ReturnType<TestApp['agent']>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let t: TestApp;
let origin: string;

async function csrf(agent: Agent): Promise<string> {
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  return res.body.csrfToken as string;
}

async function login(agent: Agent, email: string, password = PASSWORD) {
  const token = await csrf(agent);
  return agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', token)
    .send({ email, password });
}

/** Unsafe request with the session's current CSRF token. */
async function post(agent: Agent, path: string, body: object = {}) {
  const token = await csrf(agent);
  return agent.post(path).set('Origin', origin).set('X-CSRF-Token', token).send(body);
}

function sessionCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('trp.sid='))?.split(';')[0];
}

/** express-session cookie value is "s:<id>.<signature>" (URL-encoded). */
function sessionId(cookie: string): string {
  return decodeURIComponent(cookie.slice('trp.sid='.length)).slice(2).split('.')[0]!;
}

beforeAll(async () => {
  await loadAuthFixture();
  // High limits here: the limit tests below use their own instances with small thresholds.
  t = await startApp(
    { LOGIN_LIMIT_PER_ACCOUNT: '1000', LOGIN_LIMIT_PER_IP: '1000', SESSION_CREATE_LIMIT_PER_IP: '1000' },
    [ProbeController],
  );
  origin = t.config.APP_ORIGIN;
});

afterAll(async () => {
  await t?.close();
});

describe('login and current user', () => {
  it('logs in with valid credentials and returns the current user without secrets', async () => {
    const agent = t.agent();
    const res = await login(agent, USERS.employee);
    expect(res.status).toBe(200);
    const me = res.body as MeResponse;
    expect(me.user.email).toBe(USERS.employee);
    expect(me.organization.slug).toBe('atlas');
    expect(me.role).toBe('EMPLOYEE');
    expect(JSON.stringify(me)).not.toMatch(/passwordHash|sessionVersion|argon2/);
    const meRes = await agent.get('/api/v1/auth/me').expect(200);
    expect(meRes.body.user.email).toBe(USERS.employee);
    expect(meRes.headers['cache-control']).toBe('no-store');
    expect(meRes.headers['x-request-id']).toBeTruthy();
  });

  it('normalizes the email (trim + lowercase)', async () => {
    const res = await login(t.agent(), '  Employee@ATLAS.test ');
    expect(res.status).toBe(200);
  });

  it('gives the same generic 401 for a wrong password, an unknown email and disabled accounts', async () => {
    const results = await Promise.all([
      login(t.agent(), USERS.employee, 'wrong password value'),
      login(t.agent(), 'nobody@atlas.test'),
      login(t.agent(), USERS.disabledUser),
      login(t.agent(), USERS.disabledMember),
      login(t.agent(), USERS.dormant),
    ]);
    for (const res of results) {
      expect(res.status).toBe(401);
      const { code, message } = res.body as ApiError;
      expect({ code, message }).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }
  });

  it('rejects unknown fields and malformed bodies with 400', async () => {
    const agent = t.agent();
    const res = await post(agent, '/api/v1/auth/login', {
      email: USERS.employee,
      password: PASSWORD,
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const missing = await post(agent, '/api/v1/auth/login', { email: USERS.employee });
    expect(missing.status).toBe(400);
  });

  it('requires a session for protected routes', async () => {
    const res = await t.agent().get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect((await t.agent().get('/api/v1/test-probe')).status).toBe(401);
  });

  it('returns a consistent 404 body for unknown routes', async () => {
    const res = await t.agent().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeTruthy();
  });
});

describe('session fixation and storage', () => {
  it('issues a new session id at login and destroys the pre-login session', async () => {
    const agent = t.agent();
    const anonymous = sessionCookie(await agent.get('/api/v1/auth/csrf'));
    expect(anonymous).toBeDefined();
    const res = await login(agent, USERS.employee);
    const authenticated = sessionCookie(res);
    expect(authenticated).toBeDefined();
    expect(authenticated).not.toBe(anonymous);

    // The old cookie (what an attacker could have planted) is not signed in.
    const replay = await request(t.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', anonymous!);
    expect(replay.status).toBe(401);

    // The session lives in Redis under our prefix, and holds no password.
    const redis = createClient({ url: t.config.REDIS_URL });
    await redis.connect();
    try {
      const prefix = `${t.config.REDIS_KEY_PREFIX}sess:`;
      expect(await redis.exists(`${prefix}${sessionId(anonymous!)}`)).toBe(0);
      const stored = await redis.get(`${prefix}${sessionId(authenticated!)}`);
      expect(stored).toContain('"userId"');
      expect(stored).not.toContain(PASSWORD);
      expect(await redis.ttl(`${prefix}${sessionId(authenticated!)}`)).toBeGreaterThan(0);
    } finally {
      await redis.close();
    }
  });

  it('marks the cookie HttpOnly and SameSite=Lax', async () => {
    const res = await t.agent().get('/api/v1/auth/csrf');
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('trp.sid='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
  });
});

describe('CSRF and Origin', () => {
  it('rejects login without a CSRF token', async () => {
    const agent = t.agent();
    await csrf(agent);
    const res = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: USERS.employee, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it("rejects another session's token", async () => {
    const victim = t.agent();
    await csrf(victim);
    const attackerToken = await csrf(t.agent());
    const res = await victim
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', attackerToken)
      .send({ email: USERS.employee, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('rejects a foreign or missing Origin even with a valid token', async () => {
    const agent = t.agent();
    const token = await csrf(agent);
    const body = { email: USERS.employee, password: PASSWORD };
    const foreign = await agent
      .post('/api/v1/auth/login')
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', token)
      .send(body);
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('ORIGIN_INVALID');
    const missing = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', token).send(body);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('ORIGIN_INVALID');
  });

  it('rotates the CSRF token at login', async () => {
    const agent = t.agent();
    const before = await csrf(agent);
    await login(agent, USERS.employee);
    expect(await csrf(agent)).not.toBe(before);
  });

  it('protects logout too', async () => {
    const agent = t.agent();
    await login(agent, USERS.employee);
    const res = await agent.post('/api/v1/auth/logout').set('Origin', origin).send();
    expect(res.status).toBe(403);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });
});

describe('logout and expiry', () => {
  it('logout destroys the session and clears the cookie', async () => {
    const agent = t.agent();
    await login(agent, USERS.employee);
    const res = await post(agent, '/api/v1/auth/logout');
    expect(res.status).toBe(204);
    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('trp.sid='))!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  // Cookie Expires has one-second precision, so timeouts here are a few seconds and the final
  // checks replay the cookie by hand: the SERVER must reject it, not just the client's cookie jar.
  it('expires after the idle timeout, and activity keeps it alive', async () => {
    const short = await startApp({ SESSION_IDLE_SECONDS: '3', SESSION_ABSOLUTE_SECONDS: '60' });
    try {
      const active = short.agent();
      await login(active, USERS.employee);
      for (let i = 0; i < 4; i += 1) {
        await sleep(1000); // 4 s in total, never 3 s idle
        expect((await active.get('/api/v1/auth/me')).status).toBe(200);
      }

      const idleLogin = await login(short.agent(), USERS.employee);
      const cookie = sessionCookie(idleLogin)!;
      await sleep(4500);
      const res = await request(short.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(res.status).toBe(401);
    } finally {
      await short.close();
    }
  });

  it('expires at the absolute limit even while active', async () => {
    const short = await startApp({ SESSION_IDLE_SECONDS: '3', SESSION_ABSOLUTE_SECONDS: '4' });
    try {
      const agent = short.agent();
      await login(agent, USERS.employee);
      for (let i = 0; i < 3; i += 1) {
        await sleep(1000);
        expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
      }
      await sleep(1500); // 4.5 s after login, 1.5 s since the last request
      const res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Session expired');
    } finally {
      await short.close();
    }
  });
});

describe('revocation through current control data', () => {
  it('rejects an existing session on its next request after the membership is disabled', async () => {
    const agent = t.agent();
    await login(agent, USERS.toggle);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    await withControl((c) =>
      c.membership.updateMany({
        where: { user: { normalizedEmail: USERS.toggle } },
        data: { isActive: false },
      }),
    );
    try {
      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    } finally {
      await withControl((c) =>
        c.membership.updateMany({
          where: { user: { normalizedEmail: USERS.toggle } },
          data: { isActive: true },
        }),
      );
    }
  });

  it('password change revokes every session of the user and records an audit event', async () => {
    const first = t.agent();
    const second = t.agent();
    await login(first, USERS.changer);
    await login(second, USERS.changer);

    const wrong = await post(first, '/api/v1/auth/change-password', {
      currentPassword: 'not the password',
      newPassword: 'a brand new passphrase',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');

    const short = await post(first, '/api/v1/auth/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'short',
    });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('VALIDATION_FAILED');

    const newPassword = 'a brand new passphrase';
    const ok = await post(first, '/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword });
    expect(ok.status).toBe(204);

    expect((await first.get('/api/v1/auth/me')).status).toBe(401); // this session destroyed
    expect((await second.get('/api/v1/auth/me')).status).toBe(401); // other session: sessionVersion changed
    expect((await login(t.agent(), USERS.changer)).status).toBe(401); // old password
    expect((await login(t.agent(), USERS.changer, newPassword)).status).toBe(200);

    const events = await withControl((c) =>
      c.controlAuditEvent.count({ where: { action: 'PASSWORD_CHANGED' } }),
    );
    expect(events).toBe(1);
  });

  it('a must-change-password session can only use me, logout and change-password', async () => {
    const agent = t.agent();
    const res = await login(agent, USERS.mustChange);
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    const blocked = await agent.get('/api/v1/test-probe');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const newPassword = 'my own long passphrase';
    expect(
      (await post(agent, '/api/v1/auth/change-password', { currentPassword: PASSWORD, newPassword })).status,
    ).toBe(204);
    const fresh = t.agent();
    const again = await login(fresh, USERS.mustChange, newPassword);
    expect(again.body.mustChangePassword).toBe(false);
    expect((await fresh.get('/api/v1/test-probe')).status).toBe(200);
  });
});

describe('shared rate limits (Redis)', () => {
  it('limits attempts per account, counting before the password check, with Retry-After', async () => {
    const limited = await startApp({ LOGIN_LIMIT_PER_ACCOUNT: '3' });
    try {
      for (let i = 0; i < 3; i += 1) {
        const res = await login(limited.agent(), USERS.employee, 'wrong password value');
        expect(res.status).toBe(401);
        // The form can say how many tries are left before the account's window locks.
        expect(res.body.attemptsRemaining).toBe(2 - i);
      }
      // An unknown email is counted the same way, so the number reveals nothing about accounts.
      const unknown = await login(limited.agent(), 'nobody-limited@atlas.test');
      expect(unknown.body).toMatchObject({ code: 'INVALID_CREDENTIALS', attemptsRemaining: 2 });
      const blocked = await login(limited.agent(), USERS.employee); // correct password, still blocked
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(limited.config.LIMIT_WINDOW_SECONDS);
    } finally {
      await limited.close();
    }
  });

  it('shares one counter across two API instances', async () => {
    const prefix = freshPrefix();
    const api1 = await startApp({ REDIS_KEY_PREFIX: prefix, LOGIN_LIMIT_PER_ACCOUNT: '3' });
    const api2 = await startApp({ REDIS_KEY_PREFIX: prefix, LOGIN_LIMIT_PER_ACCOUNT: '3' });
    try {
      expect((await login(api1.agent(), USERS.employee)).status).toBe(200);
      expect((await login(api2.agent(), USERS.employee)).status).toBe(200);
      expect((await login(api1.agent(), USERS.employee)).status).toBe(200);
      // Fourth attempt overall: blocked on the second instance, which saw only one before.
      expect((await login(api2.agent(), USERS.employee)).status).toBe(429);
    } finally {
      await Promise.all([api1.close(), api2.close()]);
    }
  });

  it('limits attempts per client IP across different accounts', async () => {
    const limited = await startApp({ LOGIN_LIMIT_PER_IP: '4', LOGIN_LIMIT_PER_ACCOUNT: '100' });
    try {
      for (let i = 0; i < 4; i += 1) {
        expect((await login(limited.agent(), `user${i}@atlas.test`)).status).toBe(401);
      }
      expect((await login(limited.agent(), USERS.employee)).status).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('limits anonymous session creation per IP', async () => {
    const limited = await startApp({ SESSION_CREATE_LIMIT_PER_IP: '2' });
    try {
      expect((await limited.agent().get('/api/v1/auth/csrf')).status).toBe(200);
      expect((await limited.agent().get('/api/v1/auth/csrf')).status).toBe(200);
      expect((await limited.agent().get('/api/v1/auth/csrf')).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('fail closed when Redis is unavailable', () => {
  it('returns 503, never anonymous or authenticated access', async () => {
    const agent = t.agent();
    const res = await login(agent, USERS.employee);
    const cookie = sessionCookie(res)!;

    const down = await startApp({
      REDIS_URL: 'redis://127.0.0.1:1',
      REDIS_KEY_PREFIX: t.config.REDIS_KEY_PREFIX,
    });
    try {
      const me = await request(down.app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(503);
      expect(me.body.code).toBe('SERVICE_UNAVAILABLE');
      const token = await request(down.app.getHttpServer()).get('/api/v1/auth/csrf');
      expect(token.status).toBe(503);
    } finally {
      await down.close();
    }
  });
});
