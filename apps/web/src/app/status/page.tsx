'use client';

import Link from 'next/link';
import { AppHeader } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';
import { HealthStatus } from '../health-status';

/**
 * Operator view of API readiness, for admins. This page is a convenience: the readiness endpoint
 * itself stays public (no user data, no hostnames) because the proxy, the containers'
 * health checks, and `pnpm demo:verify` call it without a session.
 */
export default function StatusPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page stack">
            <Link href="/dashboard" className="back-link">
              ← Back to dashboard
            </Link>
            {me.role === 'ADMIN' ? (
              <>
                <div className="page-heading">
                  <h1>System status</h1>
                  <p className="muted">
                    Whether the API can reach everything it needs: the control database, both tenant shards,
                    Redis, and the expected database migrations. Use it when something looks broken.
                  </p>
                </div>
                <HealthStatus />
              </>
            ) : (
              <section className="card" role="alert">
                <h1>Admins only</h1>
                <p>System status is for company administrators.</p>
              </section>
            )}
          </main>
        </>
      )}
    </RequireAuth>
  );
}
