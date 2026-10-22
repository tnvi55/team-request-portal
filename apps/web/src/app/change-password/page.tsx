'use client';

import { ChangePasswordRequestSchema, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@trp/contracts';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AppHeader } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';
import { api, describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

function ChangePasswordForm({ mustChange }: { mustChange: boolean }) {
  const { signedOut } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (newPassword !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    // Same schema the API uses, so the rules cannot drift apart.
    const parsed = ChangePasswordRequestSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'password'} ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: parsed.data });
      // The server ended every session of this account, including this one.
      signedOut();
      router.replace('/login?changed=1');
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Change password</h1>
      {mustChange && (
        <p className="muted" role="status">
          Your account uses a temporary password. Choose your own before continuing.
        </p>
      )}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <label htmlFor="current">Current password</label>
        <input
          id="current"
          type="password"
          autoComplete="current-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <label htmlFor="new">New password</label>
        <input
          id="new"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          aria-describedby="new-hint"
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <p id="new-hint" className="muted small">
          {PASSWORD_MIN_LENGTH}–{PASSWORD_MAX_LENGTH} characters. Spaces and passphrases are welcome.
        </p>
        <label htmlFor="confirm">Confirm new password</label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <div aria-live="assertive" className="form-error">
          {error && <p className="bad">{error}</p>}
        </div>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Saving…' : 'Change password'}
        </button>
        <p className="muted small">You will be signed out everywhere and asked to sign in again.</p>
      </form>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <ChangePasswordForm mustChange={me.mustChangePassword} />
        </>
      )}
    </RequireAuth>
  );
}
