'use client';

import {
  CreateUserSchema,
  MEMBERSHIP_ROLES,
  PASSWORD_MIN_LENGTH,
  type CompanyUser,
  type MeResponse,
  type MembershipRole,
  type Page,
} from '@trp/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppHeader } from '../../../components/app-header';
import { RequireAuth } from '../../../components/require-auth';
import { formatDate } from '../../../components/status-badge';
import { api, describeError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

const roleLabel = (role: MembershipRole) => role.charAt(0) + role.slice(1).toLowerCase();

function CreateUserForm({ onCreated }: { onCreated: (user: CompanyUser) => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<MembershipRole>('EMPLOYEE');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = CreateUserSchema.safeParse({ email, displayName, role, temporaryPassword });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api<CompanyUser>('/admin/users', { method: 'POST', body: parsed.data });
      onCreated(created);
      setNotice(
        `Account created for ${created.user.email}. Give them the temporary password in person or by phone; ` +
          'it is not shown again, and they must change it at first sign-in.',
      );
      setEmail('');
      setDisplayName('');
      setRole('EMPLOYEE');
    } catch (err) {
      setError(describeError(err));
    } finally {
      // Never keep the temporary password in the page longer than needed.
      setTemporaryPassword('');
      setPending(false);
    }
  }

  return (
    <form
      className="card form"
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      aria-labelledby="create-heading"
    >
      <h2 id="create-heading">Add a user</h2>
      <label htmlFor="new-email">Work email</label>
      <input
        id="new-email"
        type="email"
        autoComplete="off"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="new-name">Display name</label>
      <input
        id="new-name"
        required
        minLength={2}
        maxLength={120}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      <label htmlFor="new-role">Role</label>
      <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
        {MEMBERSHIP_ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </select>
      <label htmlFor="new-password">Temporary password</label>
      <input
        id="new-password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        aria-describedby="new-password-hint"
        value={temporaryPassword}
        onChange={(e) => setTemporaryPassword(e.target.value)}
      />
      <p id="new-password-hint" className="muted small">
        At least {PASSWORD_MIN_LENGTH} characters. Stored only as a hash.
      </p>
      <div aria-live="assertive" className="form-error">
        {error && <p className="bad">{error}</p>}
      </div>
      <div aria-live="polite">{notice && <p className="good">{notice}</p>}</div>
      <button type="submit" className="primary" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: CompanyUser;
  isSelf: boolean;
  onChanged: (user: CompanyUser) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(body: { role?: MembershipRole; isActive?: boolean }) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onChanged(await api<CompanyUser>(`/admin/users/${user.membershipId}`, { method: 'PATCH', body }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  const name = user.user.displayName;
  return (
    <tr>
      <th scope="row">
        {name}
        {isSelf && <span className="muted"> (you)</span>}
        {error && (
          <p className="bad small" role="alert">
            {error}
          </p>
        )}
      </th>
      <td>{user.user.email}</td>
      <td>
        <select
          aria-label={`Role for ${name}`}
          value={user.role}
          disabled={pending}
          onChange={(e) => void update({ role: e.target.value as MembershipRole })}
        >
          {MEMBERSHIP_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </td>
      <td>
        {user.isActive ? 'Active' : 'Disabled'}
        {user.mustChangePassword && <span className="muted small"> · must change password</span>}
      </td>
      <td>{formatDate(user.createdAt)}</td>
      <td>
        <button
          type="button"
          disabled={pending}
          aria-label={`${user.isActive ? 'Disable' : 'Enable'} ${name}`}
          onClick={() => void update({ isActive: !user.isActive })}
        >
          {user.isActive ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  );
}

function UsersAdmin({ me }: { me: MeResponse }) {
  const { refresh } = useAuth();
  const [items, setItems] = useState<CompanyUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api<Page<CompanyUser>>('/admin/users?limit=25').then(
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
      const page = await api<Page<CompanyUser>>(
        `/admin/users?limit=25&cursor=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setState('ready');
    } catch (err) {
      setError(describeError(err));
      setState('error');
    }
  }, [nextCursor]);

  const replace = (updated: CompanyUser) => {
    setItems((current) => current.map((u) => (u.membershipId === updated.membershipId ? updated : u)));
    // Changing your own role or status changes what you may do: reload who "me" is.
    if (updated.user.id === me.user.id) void refresh();
  };

  return (
    <>
      <h1>Users</h1>
      <CreateUserForm onCreated={(user) => setItems((current) => [user, ...current])} />
      {state === 'loading' ? (
        <p aria-live="polite">Loading users…</p>
      ) : (
        <>
          {items.length === 0 && state !== 'error' && <p className="card">No users yet.</p>}
          {items.length > 0 && (
            <div className="table-wrap">
              <table className="audit-table">
                <caption className="muted small">
                  Newest first. Changes apply on each person&apos;s next action; disabling signs them out.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Email</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Added</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((u) => (
                    <UserRow
                      key={u.membershipId}
                      user={u}
                      isSelf={u.user.id === me.user.id}
                      onChanged={replace}
                    />
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
      )}
    </>
  );
}

export default function UsersPage() {
  return (
    <RequireAuth>
      {(me) => (
        <>
          <AppHeader me={me} />
          <main className="page wide">
            {me.role === 'ADMIN' ? (
              <UsersAdmin me={me} />
            ) : (
              <section className="card" role="alert">
                <h1>Admins only</h1>
                <p>User administration is available to company administrators.</p>
              </section>
            )}
          </main>
        </>
      )}
    </RequireAuth>
  );
}
