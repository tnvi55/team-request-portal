import type request from 'supertest';
import { expect } from 'vitest';
import { PASSWORD } from './fixture.js';
import type { TestApp } from './test-app.js';

export type Agent = ReturnType<TestApp['agent']>;

/** Signs in through the real CSRF + login flow and returns a cookie-keeping agent. */
export async function signIn(app: TestApp, email: string): Promise<Agent> {
  const agent = app.agent();
  const res = await send(app, agent, 'post', '/api/v1/auth/login', { email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

/** Unsafe request with Origin and the session's current CSRF token. */
export async function send(
  app: TestApp,
  agent: Agent,
  method: 'post' | 'patch',
  path: string,
  body: object,
): Promise<request.Response> {
  const token = (await agent.get('/api/v1/auth/csrf')).body.csrfToken as string;
  return agent[method](path).set('Origin', app.config.APP_ORIGIN).set('X-CSRF-Token', token).send(body);
}
