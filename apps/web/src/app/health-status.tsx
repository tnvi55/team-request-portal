'use client';

import type { ReadinessResponse } from '@trp/contracts';
import { useCallback, useEffect, useState } from 'react';

type State =
  { kind: 'loading' } | { kind: 'loaded'; httpStatus: number; body: ReadinessResponse } | { kind: 'error' };

const LABELS: Record<keyof ReadinessResponse['checks'], string> = {
  control: 'Control database',
  shardA: 'Tenant shard A',
  shardB: 'Tenant shard B',
  redis: 'Redis',
  migrations: 'Database migrations',
};

async function fetchReadiness(): Promise<State> {
  try {
    // Relative URL: same origin as the page, so the reverse proxy routes it to NestJS.
    const res = await fetch('/api/v1/health/ready', { cache: 'no-store' });
    return { kind: 'loaded', httpStatus: res.status, body: (await res.json()) as ReadinessResponse };
  } catch {
    return { kind: 'error' };
  }
}

export function HealthStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(() => {
    setState({ kind: 'loading' });
    void fetchReadiness().then(setState);
  }, []);

  useEffect(() => {
    let active = true;
    void fetchReadiness().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card" aria-labelledby="health-heading" aria-live="polite">
      <h2 id="health-heading">API readiness</h2>
      {state.kind === 'loading' && <p>Checking…</p>}
      {state.kind === 'error' && (
        <p className="bad">The API could not be reached. Is it running behind the proxy?</p>
      )}
      {state.kind === 'loaded' && (
        <>
          <p className={state.body.status === 'ready' ? 'good' : 'bad'}>
            {state.body.status === 'ready' ? 'Ready' : 'Not ready'} (HTTP {state.httpStatus})
          </p>
          <ul className="checks">
            {Object.entries(state.body.checks).map(([name, status]) => (
              <li key={name}>
                <span>{LABELS[name as keyof typeof LABELS]}</span>
                <span className={status === 'up' ? 'good' : 'bad'}>{status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" onClick={load} disabled={state.kind === 'loading'}>
        Check again
      </button>
    </section>
  );
}
