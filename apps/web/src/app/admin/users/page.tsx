'use client';

import {
  CreateUserSchema,
  MEMBERSHIP_ROLES,
  PASSWORD_MIN_LENGTH,
  type CompanyUser,
  type MeResponse,
  type MembershipRole,
  type Page,
  type ProjectSummary,
  type UpdateMembershipBody,
} from '@trp/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppHeader } from '../../../components/app-header';
import { PasswordInput } from '../../../components/password-input';
import { RequireAuth } from '../../../components/require-auth';
import { formatDate } from '../../../components/status-badge';
import { api, describeError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';

const roleLabel = (role: MembershipRole) => role.charAt(0) + role.slice(1).toLowerCase();

/** "Vision Platform (Sofia Fernandes)": the manager helps the admin pick the right team. */
const projectLabel = (p: ProjectSummary) => (p.manager ? `${p.name} (${p.manager.displayName})` : p.name);

function CreateUserForm({
  projects,
  onCreated,
}: {
  projects: ProjectSummary[];
  onCreated: (user: CompanyUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<MembershipRole>('EMPLOYEE');
  const [projectId, setProjectId] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = CreateUserSchema.safeParse({
      email,
      displayName,
      role,
      temporaryPassword,
      ...(jobTitle.trim() && { jobTitle }),
      ...(projectId && { projectId }),
    });
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
      setJobTitle('');
      setRole('EMPLOYEE');
      setProjectId('');
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
      <div className="form-grid">
        <div className="field">
          <label htmlFor="new-email">Work email</label>
          <input
            id="new-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-name">Display name</label>
          <input
            id="new-name"
            required
            minLength={2}
            maxLength={120}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-title">Designation</label>
          <input
            id="new-title"
            maxLength={80}
            placeholder="e.g. QA Engineer"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="new-role">Role</label>
          <select id="new-role" value={role} onChange={(e) => setRole(e.target.value as MembershipRole)}>
            {MEMBERSHIP_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-project">Project</label>
          <select id="new-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {projectLabel(p)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="new-password">Temporary password</label>
          <PasswordInput
            id="new-password"
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
        </div>
      </div>
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
  projects,
  onChanged,
}: {
  user: CompanyUser;
  isSelf: boolean;
  projects: ProjectSummary[];
  onChanged: (user: CompanyUser) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');

  async function update(body: UpdateMembershipBody) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api<CompanyUser>(`/admin/users/${user.membershipId}`, { method: 'PATCH', body });
      setJobTitle(updated.jobTitle ?? '');
      onChanged(updated);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending(false);
    }
  }

  const name = user.user.displayName;
  const titleChanged = jobTitle.trim() !== (user.jobTitle ?? '');
  return (
    <tr>
      <th scope="row">
        <span className="person-name">{name}</span>
        {isSelf && <span className="muted"> (you)</span>}
        <span className="muted small person-email">{user.user.email}</span>
        {error && (
          <p className="bad small" role="alert">
            {error}
          </p>
        )}
      </th>
      <td>
        <form
          className="inline-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (titleChanged) void update({ jobTitle: jobTitle.trim() || null });
          }}
        >
          <input
            aria-label={`Designation for ${name}`}
            maxLength={80}
            placeholder="No designation"
            value={jobTitle}
            disabled={pending}
            onChange={(e) => setJobTitle(e.target.value)}
          />
          {titleChanged && (
            <button type="submit" disabled={pending} aria-label={`Save designation for ${name}`}>
              Save
            </button>
          )}
        </form>
      </td>
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
        <select
          aria-label={`Project for ${name}`}
          value={user.project?.id ?? ''}
          disabled={pending}
          onChange={(e) => void update({ projectId: e.target.value || null })}
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        {user.manager ? (
          <>
            {user.manager.displayName}
            {user.manager.jobTitle && (
              <span className="muted small person-email">{user.manager.jobTitle}</span>
            )}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <span className={user.isActive ? 'pill pill-good' : 'pill pill-bad'}>
          {user.isActive ? 'Active' : 'Disabled'}
        </span>
        {user.mustChangePassword && <span className="muted small person-email">must change password</span>}
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'more' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<Page<CompanyUser>>('/admin/users?limit=25'),
      api<{ items: ProjectSummary[] }>('/admin/projects'),
    ]).then(
      ([page, projectList]) => {
        if (!active) return;
        setItems(page.items);
        setProjects(projectList.items);
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
      <div className="page-heading">
        <h1>Users</h1>
        <p className="muted">
          Accounts, roles, designations and projects at {me.organization.name}. A person&apos;s manager is the
          manager of their project.
        </p>
      </div>
      {projects.length > 0 && (
        <ul className="project-chips" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id} className="card project-chip">
              <strong>{p.name}</strong>
              <span className="muted small">
                {p.manager ? `Manager: ${p.manager.displayName}` : 'No manager'} · {p.memberCount}{' '}
                {p.memberCount === 1 ? 'member' : 'members'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <CreateUserForm projects={projects} onCreated={(user) => setItems((current) => [user, ...current])} />
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
                    <th scope="col">Designation</th>
                    <th scope="col">Role</th>
                    <th scope="col">Project</th>
                    <th scope="col">Manager</th>
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
                      projects={projects}
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
          <main className="page xwide">
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
