'use client';

import {
  DecisionSchema,
  REVIEW_COMMENT_MAX,
  REVIEW_COMMENT_MIN,
  type Decision,
  type RequestDetail,
} from '@trp/contracts';
import { useState } from 'react';
import { api, ApiRequestError, describeError } from '../lib/api';

/**
 * Approve / reject for reviewers. Sends the version the reviewer is looking at; if someone
 * else decided first (409) the panel says so and reloads instead of retrying. The buttons are
 * disabled while a decision is in flight, so one click sends one request.
 */
export function DecisionPanel({
  request,
  onDecided,
  onConflict,
}: {
  request: RequestDetail;
  onDecided: (updated: RequestDetail) => void;
  onConflict: () => void;
}) {
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: Decision) {
    if (pending) return;
    const body = { decision, expectedVersion: request.version, ...(comment.trim() && { comment }) };
    const parsed = DecisionSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'decision'} ${i.message}`).join('; '));
      return;
    }
    setPending(decision);
    setError(null);
    try {
      onDecided(
        await api<RequestDetail>(`/requests/${request.id}/decision`, { method: 'POST', body: parsed.data }),
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError('Someone else decided this request first. Showing the current version.');
        onConflict();
      } else {
        setError(describeError(err));
      }
      setPending(null);
    }
  }

  return (
    <section className="card decision" aria-labelledby="decision-heading">
      <h2 id="decision-heading">Decision</h2>
      <label htmlFor="review-comment">Comment (required to reject)</label>
      <textarea
        id="review-comment"
        rows={3}
        maxLength={REVIEW_COMMENT_MAX}
        aria-describedby="review-comment-hint"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <p id="review-comment-hint" className="muted small">
        {REVIEW_COMMENT_MIN}–{REVIEW_COMMENT_MAX} characters.
      </p>
      <div aria-live="assertive" className="form-error">
        {error && <p className="bad">{error}</p>}
      </div>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={pending !== null}
          onClick={() => void submit('APPROVED')}
        >
          {pending === 'APPROVED' ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => void submit('REJECTED')}>
          {pending === 'REJECTED' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </section>
  );
}
