'use client';

import {
  CreateRequestSchema,
  REQUEST_CATEGORIES,
  type RequestCategory,
  type RequestDetail,
} from '@trp/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AppHeader } from '../../../components/app-header';
import { RequireAuth } from '../../../components/require-auth';
import { api, describeError } from '../../../lib/api';

function NewRequestForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<RequestCategory>('EQUIPMENT');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return; // one submission at a time
    // Same schema as the API: the user sees the rule before a round trip.
    const parsed = CreateRequestSchema.safeParse({ title, description, category });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await api<RequestDetail>('/requests', { method: 'POST', body: parsed.data });
      router.replace(`/requests/${created.id}`);
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>New request</h1>
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          required
          minLength={3}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="category">Category</label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as RequestCategory)}
        >
          {REQUEST_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0) + c.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          required
          minLength={10}
          maxLength={2000}
          rows={6}
          aria-describedby="description-hint"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p id="description-hint" className="muted small">
          10–2,000 characters: what you need and why.
        </p>
        <div aria-live="assertive" className="form-error">
          {error && <p className="bad">{error}</p>}
        </div>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit request'}
        </button>
      </form>
    </main>
  );
}

export default function NewRequestPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <NewRequestForm />
        </>
      )}
    </RequireAuth>
  );
}
