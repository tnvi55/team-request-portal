'use client';

import type { AuditEvent, MeResponse, Page } from '@trp/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import { RequireAuth } from '../../../components/require-auth';
import { formatDate } from '../../../components/status-badge';
import { api, describeError } from '../../../lib/api';

const ACTION_LABEL: Record<AuditEvent['action'], string> = {
  REQUEST_CREATED: 'Submitted',
  REQUEST_APPROVED: 'Approved',
  REQUEST_REJECTED: 'Rejected',
};

function AuditTable() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<Page<AuditEvent>>('/admin/audit?limit=25').then(
      (page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setState('ready');
      },
      (err) => {
        if (!active) return;
        setError(describeError(err));
        setState('error');
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setState('more');
    try {
      const page = await api<Page<AuditEvent>>(
        `/admin/audit?limit=25&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setState('ready');
    } catch (err) {
      setError(describeError(err));
      setState('error');
    }
  }, [nextCursor]);

  if (state === 'loading') return <p aria-live="polite">Loading audit history…</p>;
  return (
    <>
      {items.length === 0 && state !== 'error' && <p className="card">No audit events yet.</p>}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="audit-table">
            <caption className="muted small">
              Newest first. Request events are stored on your company&apos;s shard.
            </caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Action</th>
                <th scope="col">Request</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.occurredAt)}</td>
                  <td>{ACTION_LABEL[e.action]}</td>
                  <td>
                    <Link href={`/requests/${e.request.id}`}>{e.request.title}</Link>
                  </td>
                  <td>{e.actor.displayName ?? 'Former member'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div aria-live="assertive">{error && <p className="bad">{error}</p>}</div>
      {nextCursor && (
        <button type="button" onClick={() => void loadMore()} disabled={state === 'more'}>
          {state === 'more' ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}

function AdminOnly({ me }: { me: MeResponse }) {
  if (me.role !== 'ADMIN') {
    return (
      <section className="card" role="alert">
        <h1>Admins only</h1>
        <p>The audit history is available to company administrators.</p>
      </section>
    );
  }
  return (
    <>
      <h1>Audit history</h1>
      <AuditTable />
    </>
  );
}

export default function AuditPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page wide">
            <AdminOnly me={me} />
          </main>
        </>
      )}
    </RequireAuth>
  );
}
