'use client';

import type { RequestDetail } from '@trp/contracts';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppHeader } from '../../../components/app-header';
import { RequireAuth } from '../../../components/require-auth';
import { formatDate, StatusBadge } from '../../../components/status-badge';
import { api, ApiRequestError, describeError } from '../../../lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'loaded'; request: RequestDetail }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

function Detail({ id }: { id: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    void api<RequestDetail>(`/requests/${encodeURIComponent(id)}`).then(
      (request) => active && setState({ kind: 'loaded', request }),
      (err) => {
        if (!active) return;
        // 404 covers "does not exist" and "not yours": the API does not reveal which.
        const missing = err instanceof ApiRequestError && (err.status === 404 || err.status === 400);
        setState(missing ? { kind: 'missing' } : { kind: 'error', message: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (state.kind === 'loading') return <p aria-live="polite">Loading request…</p>;
  if (state.kind === 'missing') {
    return (
      <section className="card" role="alert">
        <h1>Request not found</h1>
        <p>It does not exist, or you do not have access to it.</p>
        <Link href="/requests">Back to requests</Link>
      </section>
    );
  }
  if (state.kind === 'error')
    return (
      <p className="bad" role="alert">
        {state.message}
      </p>
    );

  const r = state.request;
  return (
    <article className="card" aria-labelledby="request-title">
      <div className="title-row">
        <h1 id="request-title">{r.title}</h1>
        <StatusBadge status={r.status} />
      </div>
      <dl className="facts">
        <dt>Category</dt>
        <dd>{r.category.toLowerCase()}</dd>
        <dt>Submitted by</dt>
        <dd>{r.createdBy.displayName ?? 'Former member'}</dd>
        <dt>Submitted</dt>
        <dd>{formatDate(r.createdAt)}</dd>
        {r.reviewedAt && (
          <>
            <dt>Reviewed by</dt>
            <dd>{r.reviewedBy?.displayName ?? 'Former member'}</dd>
            <dt>Reviewed</dt>
            <dd>{formatDate(r.reviewedAt)}</dd>
          </>
        )}
        {r.reviewComment && (
          <>
            <dt>Comment</dt>
            <dd>{r.reviewComment}</dd>
          </>
        )}
      </dl>
      <h2>Description</h2>
      <p className="pre-wrap">{r.description}</p>
      <Link href="/requests">Back to requests</Link>
    </article>
  );
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page">
            <Detail id={id} />
          </main>
        </>
      )}
    </RequireAuth>
  );
}
