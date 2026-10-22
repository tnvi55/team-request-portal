'use client';

import Link from 'next/link';
import { AppHeader } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';

// M3: proves the authenticated round trip. Requests and counts arrive in M4.
export default function DashboardPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page">
            <h1>Dashboard</h1>
            <section className="card" aria-labelledby="who">
              <h2 id="who">Signed in</h2>
              <dl className="facts">
                <dt>Name</dt>
                <dd>{me.user.displayName}</dd>
                <dt>Email</dt>
                <dd>{me.user.email}</dd>
                <dt>Company</dt>
                <dd>{me.organization.name}</dd>
                <dt>Role</dt>
                <dd>{me.role}</dd>
              </dl>
              <p className="muted small">Requests and approvals arrive in the next milestone.</p>
            </section>
            <p>
              <Link href="/change-password">Change password</Link> · <Link href="/status">System status</Link>
            </p>
          </main>
        </>
      )}
    </RequireAuth>
  );
}
