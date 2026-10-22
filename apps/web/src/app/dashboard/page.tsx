'use client';

import type { DashboardResponse, MeResponse } from '@trp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppHeader } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';
import { api, describeError } from '../../lib/api';

function Counts({ me }: { me: MeResponse }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<DashboardResponse>('/dashboard').then(
      (d) => active && setData(d),
      (err) => active && setError(describeError(err)),
    );
    return () => {
      active = false;
    };
  }, []);

  if (error)
    return (
      <p className="bad" role="alert">
        {error}
      </p>
    );
  if (!data) return <p aria-live="polite">Loading counts…</p>;

  const tiles = [
    { label: 'Pending', value: data.counts.PENDING, status: 'PENDING' },
    { label: 'Approved', value: data.counts.APPROVED, status: 'APPROVED' },
    { label: 'Rejected', value: data.counts.REJECTED, status: 'REJECTED' },
    { label: 'Total', value: data.counts.total, status: '' },
  ];
  return (
    <section aria-labelledby="counts-heading">
      <h2 id="counts-heading">
        {data.scope === 'company' ? `${me.organization.name} requests` : 'My requests'}
      </h2>
      <ul className="tiles">
        {tiles.map((t) => (
          <li key={t.label} className="card tile">
            <Link href={t.status ? `/requests?status=${t.status}` : '/requests'}>
              <span className="tile-value">{t.value}</span>
              <span className="tile-label">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page wide">
            <h1>Dashboard</h1>
            <p className="muted">
              Signed in as {me.user.displayName} ({me.role.toLowerCase()}) at {me.organization.name}.
            </p>
            <Counts me={me} />
            <p>
              <Link href="/requests/new">Submit a request</Link> ·{' '}
              <Link href="/change-password">Change password</Link> · <Link href="/status">System status</Link>
            </p>
          </main>
        </>
      )}
    </RequireAuth>
  );
}
