'use client';

import {
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
  type MeResponse,
  type Page,
  type RequestScope,
  type RequestSummary,
} from '@trp/contracts';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AppHeader } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';
import { formatDate, StatusBadge } from '../../components/status-badge';
import { api, describeError } from '../../lib/api';

interface Filters {
  scope: RequestScope;
  status: string;
  category: string;
}

function query(filters: Filters, cursor?: string | null) {
  const params = new URLSearchParams({ scope: filters.scope, limit: '20' });
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (cursor) params.set('cursor', cursor);
  return `/requests?${params}`;
}

function RequestList({ me }: { me: MeResponse }) {
  const reviewer = me.role !== 'EMPLOYEE';
  const params = useSearchParams();
  // Dashboard tiles link here with ?status=…; only known values are accepted.
  const initialStatus = (REQUEST_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? params.get('status')!
    : '';
  const [filters, setFilters] = useState<Filters>({
    scope: reviewer ? 'company' : 'mine',
    status: initialStatus,
    category: '',
  });
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  // First page whenever the filters change.
  useEffect(() => {
    let active = true;
    void api<Page<RequestSummary>>(query(filters)).then(
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
  }, [filters]);

  const update = (patch: Partial<Filters>) => {
    setState('loading');
    setError(null);
    setFilters((f) => ({ ...f, ...patch }));
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setState('more');
    try {
      const page = await api<Page<RequestSummary>>(query(filters, nextCursor));
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setState('ready');
    } catch (err) {
      setError(describeError(err));
      setState('error');
    }
  }, [filters, nextCursor]);

  return (
    <main className="page wide">
      <div className="title-row">
        <h1>{filters.scope === 'company' ? 'Company requests' : 'My requests'}</h1>
        <Link href="/requests/new" className="button-link">
          New request
        </Link>
      </div>

      <form className="filters" aria-label="Filter requests" onSubmit={(e) => e.preventDefault()}>
        {reviewer && (
          <label>
            Show
            <select value={filters.scope} onChange={(e) => update({ scope: e.target.value as RequestScope })}>
              <option value="company">Company</option>
              <option value="mine">Mine</option>
            </select>
          </label>
        )}
        <label>
          Status
          <select value={filters.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">All</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={filters.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All</option>
            {REQUEST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </form>

      {state === 'loading' && <p aria-live="polite">Loading requests…</p>}
      {state !== 'loading' && items.length === 0 && state !== 'error' && (
        <p className="card">No requests match these filters.</p>
      )}
      {items.length > 0 && (
        <ul className="request-list" aria-label="Requests">
          {items.map((r) => (
            <li key={r.id} className="card request-row">
              <div>
                <Link href={`/requests/${r.id}`}>{r.title}</Link>
                <p className="muted small">
                  {r.category.toLowerCase()} · {formatDate(r.createdAt)}
                  {filters.scope === 'company' && <> · {r.createdBy.displayName ?? 'Former member'}</>}
                </p>
              </div>
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
      )}
      <div aria-live="assertive">{error && <p className="bad">{error}</p>}</div>
      {nextCursor && state !== 'loading' && (
        <button type="button" onClick={() => void loadMore()} disabled={state === 'more'}>
          {state === 'more' ? 'Loading…' : 'Load more'}
        </button>
      )}
    </main>
  );
}

export default function RequestsPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <Suspense fallback={<p>Loading…</p>}>
            <RequestList me={me} />
          </Suspense>
        </>
      )}
    </RequireAuth>
  );
}
