'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { PasswordInput } from '../../components/password-input';
import { describeError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

function LoginForm() {
  const { state, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in (e.g. back button): go to the app.
  useEffect(() => {
    if (state.status === 'authenticated') {
      router.replace(state.me.mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [state, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return; // no duplicate submissions
    setPending(true);
    setError(null);
    try {
      const me = await login({ email, password });
      setPassword('');
      router.replace(me.mustChangePassword ? '/change-password' : '/dashboard');
    } catch (err) {
      setError(describeError(err));
      setPending(false);
    }
  }

  return (
    <main className="page narrow auth-page">
      <p className="brand-mark" aria-hidden="true">
        TR
      </p>
      <h1>Sign in</h1>
      <p className="muted">Team Request &amp; Approval Portal</p>
      {params.get('changed') === '1' && (
        <p className="good" role="status">
          Password changed. Sign in with your new password.
        </p>
      )}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          autoComplete="current-password"
          required
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div aria-live="assertive" className="form-error">
          {error && <p className="bad">{error}</p>}
        </div>
        <button type="submit" className="primary" disabled={pending || !email || !password}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in a statically rendered page.
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
