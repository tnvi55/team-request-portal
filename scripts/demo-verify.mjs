// pnpm demo:verify — non-destructive checks of the running replica demo (pnpm demo:up) through
// the proxy at http://localhost:8080, then the read-only database evidence (pnpm db:verify).
// It signs in manager@cedar.example and employee@cedar.example once each (so it can run twice
// per 15 minutes under the login limit) and finishes by using up the employee's 120 calls per
// minute to show the shared limit; that account is throttled for up to a minute afterwards.
// Passwords come from the Git-ignored .local/demo-credentials.json and are never printed;
// neither are cookies or session ids. Nothing is created, changed, or deleted.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://localhost:8080';
const root = resolve(import.meta.dirname, '..');
const MANAGER = 'manager@cedar.example';
const EMPLOYEE = 'employee@cedar.example';

let failures = 0;
function report(ok, message) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures += 1;
}

let credentials;
try {
  credentials = JSON.parse(readFileSync(resolve(root, '.local/demo-credentials.json'), 'utf8'));
} catch {
  console.error('No .local/demo-credentials.json: run pnpm db:seed first.');
  process.exit(1);
}

/** Minimal same-origin browser: keeps the session cookie and the CSRF token in memory. */
function browser() {
  let cookie = '';
  let csrf = null;
  async function call(method, path, { body, headers = {}, withCsrf = true } = {}) {
    const h = { Origin: BASE, ...headers };
    if (method !== 'GET' && withCsrf) {
      if (!csrf) csrf = (await call('GET', '/api/v1/auth/csrf')).json?.csrfToken ?? null;
      if (csrf) h['X-CSRF-Token'] = csrf;
    }
    if (cookie) h.Cookie = cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // HTML page: keep the text.
    }
    return { status: res.status, headers: res.headers, json, text };
  }
  return {
    call,
    async signIn(email) {
      const res = await call('POST', '/api/v1/auth/login', { body: { email, password: credentials[email] } });
      csrf = null; // rotated at login
      return res;
    },
  };
}

const anonymous = browser();

// --- 1. Proxy, readiness, and both API replicas -------------------------------------------
const instances = new Set();
let ready = null;
for (let i = 0; i < 8; i += 1) {
  const res = await anonymous.call('GET', '/api/v1/health/ready').catch(() => null);
  if (!res) break;
  ready = res;
  const id = res.headers.get('x-instance-id');
  if (id) instances.add(id);
}
if (!ready) {
  console.error(`Nothing answers at ${BASE}. Start the demo with pnpm demo:up.`);
  process.exit(1);
}
report(
  ready.status === 200 && ready.json?.status === 'ready',
  `readiness: ${JSON.stringify(ready.json?.checks ?? ready.status)}`,
);
report(
  instances.has('api-1') && instances.has('api-2'),
  `both API replicas answer through the proxy (${[...instances].sort().join(', ') || 'no X-Instance-ID: is this the demo?'})`,
);

// --- 2. Both web replicas serve the same build --------------------------------------------
const builds = new Map();
for (let i = 0; i < 8; i += 1) {
  const res = await anonymous.call('GET', '/login');
  const upstream = res.headers.get('x-upstream') ?? 'unknown';
  const assets = [...res.text.matchAll(/\/_next\/static\/[^"'\s)]+/g)].map((m) => m[0]).sort();
  builds.set(upstream, JSON.stringify([...new Set(assets)]));
}
report(builds.size >= 2, `both web replicas served /login (${builds.size} distinct upstreams)`);
report(
  new Set(builds.values()).size === 1,
  'every web replica serves the same build (identical asset names)',
);

// --- 3. One session on both API replicas --------------------------------------------------
const manager = browser();
const login = await manager.signIn(MANAGER);
report(login.status === 200, `sign in as ${MANAGER} (${login.status})`);
const seenBy = new Map();
for (let i = 0; i < 6; i += 1) {
  const res = await manager.call('GET', '/api/v1/auth/me');
  seenBy.set(res.headers.get('x-instance-id'), res.status);
}
report(
  seenBy.get('api-1') === 200 && seenBy.get('api-2') === 200,
  `the same session works on api-1 and api-2 (${JSON.stringify(Object.fromEntries(seenBy))})`,
);

// --- 4. Unsafe requests: CSRF, Origin, and server-owned fields -----------------------------
const draft = {
  title: 'Never saved',
  description: 'demo:verify sends this only to be refused.',
  category: 'OTHER',
};
const noToken = await manager.call('POST', '/api/v1/requests', { body: draft, withCsrf: false });
report(
  noToken.status === 403 && noToken.json?.code === 'CSRF_INVALID',
  `POST without a CSRF token -> ${noToken.status} ${noToken.json?.code}`,
);
const badOrigin = await manager.call('POST', '/api/v1/requests', {
  body: draft,
  headers: { Origin: 'http://evil.example' },
});
report(
  badOrigin.status === 403 && badOrigin.json?.code === 'ORIGIN_INVALID',
  `POST from another origin -> ${badOrigin.status} ${badOrigin.json?.code}`,
);
const injected = await manager.call('POST', '/api/v1/requests', {
  body: { ...draft, tenantId: '00000000-0000-4000-8000-000000000000' },
});
report(injected.status === 400, `a body that names a tenant is rejected -> ${injected.status}`);

// --- 5. Dashboard cache ------------------------------------------------------------------
await manager.call('GET', '/api/v1/dashboard');
const second = await manager.call('GET', '/api/v1/dashboard');
report(
  second.status === 200 && second.headers.get('x-dashboard-cache') === 'hit',
  `second dashboard read is a cache hit (${second.headers.get('x-dashboard-cache')} via ${second.headers.get('x-instance-id')})`,
);

// --- 6. Employee scope -------------------------------------------------------------------
const employee = browser();
const employeeLogin = await employee.signIn(EMPLOYEE);
report(employeeLogin.status === 200, `sign in as ${EMPLOYEE} (${employeeLogin.status})`);
const me = (await employee.call('GET', '/api/v1/auth/me')).json;
const company = await employee.call('GET', '/api/v1/requests?scope=company');
report(company.status === 403, `employee asking for the company list -> ${company.status}`);
const mine = await employee.call('GET', '/api/v1/requests?scope=mine&limit=100');
report(
  mine.status === 200 && mine.json.items.every((r) => r.createdBy.id === me.user.id),
  `employee list holds only their own requests (${mine.json?.items?.length ?? 0} items)`,
);
const unknown = await employee.call('GET', `/api/v1/requests/${crypto.randomUUID()}`);
report(unknown.status === 404, `a request id outside your scope -> ${unknown.status}`);

// --- 7. Shared API limit across replicas (uses up the employee's minute) ------------------
const perInstance = {};
let limited = null;
for (let i = 0; i < 130 && !limited; i += 1) {
  const res = await employee.call('GET', '/api/v1/auth/me');
  const id = res.headers.get('x-instance-id');
  if (res.status === 429) limited = { id, retryAfter: res.headers.get('retry-after') };
  else perInstance[id] = (perInstance[id] ?? 0) + 1;
}
report(
  limited !== null && Object.keys(perInstance).length === 2,
  `one 120/min limit across replicas: ${JSON.stringify(perInstance)} served, then 429 on ${limited?.id} (Retry-After ${limited?.retryAfter})`,
);

// --- 8. Database evidence (read-only) -----------------------------------------------------
console.log('\nDatabase evidence (pnpm db:verify, read-only):');
// The built checker when present (quiet); otherwise pnpm db:verify builds the package first.
const built = resolve(root, 'packages/database/dist/scripts/verify.js');
const db = existsSync(built)
  ? spawnSync(process.execPath, [built], { cwd: resolve(root, 'packages/database'), stdio: 'inherit' })
  : spawnSync('pnpm', ['db:verify'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
report(db.status === 0, 'pnpm db:verify passed');

console.log(failures === 0 ? '\nAll demo checks passed.' : `\n${failures} demo check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
