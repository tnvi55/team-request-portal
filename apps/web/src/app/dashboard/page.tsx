'use client';

import type { DashboardResponse, MeResponse } from '@trp/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppHeader, initials, roleLabel } from '../../components/app-header';
import { RequireAuth } from '../../components/require-auth';
import { api, describeError } from '../../lib/api';

/** Who you are at your company: designation, project, and manager (or the projects you manage). */
function ProfileCard({ me }: { me: MeResponse }) {
  const { profile } = me;
  // Employees always see both facts ("—" when unassigned); others only when they are on a project.
  const showTeam = profile.project !== null || me.role === 'EMPLOYEE';
  return (
    <section className="card profile-card" aria-labelledby="profile-heading">
      <span className="avatar avatar-lg" aria-hidden="true">
        {initials(me.user.displayName)}
      </span>
      <div className="profile-main">
        <h2 id="profile-heading">{me.user.displayName}</h2>
        <p className="muted profile-title">
          {profile.jobTitle ?? 'No designation yet'} · {me.organization.name}
        </p>
        <span className={`pill pill-role-${me.role.toLowerCase()}`}>{roleLabel(me.role)}</span>
      </div>
      <dl className="profile-facts">
        {showTeam && (
          <>
            <div>
              <dt>Current project</dt>
              <dd>{profile.project?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Current manager</dt>
              <dd>
                {profile.manager ? (
                  <>
                    {profile.manager.displayName}
                    {profile.manager.jobTitle && (
                      <span className="muted small block">{profile.manager.jobTitle}</span>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </>
        )}
        {profile.managedProjects.length > 0 && (
          <div>
            <dt>Manages</dt>
            <dd>{profile.managedProjects.map((p) => p.name).join(', ')}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

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
    { label: 'Pending', value: data.counts.PENDING, status: 'PENDING', tone: 'pending' },
    { label: 'Approved', value: data.counts.APPROVED, status: 'APPROVED', tone: 'approved' },
    { label: 'Rejected', value: data.counts.REJECTED, status: 'REJECTED', tone: 'rejected' },
    { label: 'Total', value: data.counts.total, status: '', tone: 'total' },
  ];
  return (
    <section aria-labelledby="counts-heading">
      <h2 id="counts-heading" className="section-title">
        {data.scope === 'company' ? `${me.organization.name} requests` : 'My requests'}
      </h2>
      <ul className="tiles">
        {tiles.map((t) => (
          <li key={t.label} className={`tile tile-${t.tone}`}>
            <Link href={t.status ? `/requests?status=${t.status}` : '/requests'}>
              <span className="tile-label">{t.label}</span>
              <span className="tile-value">{t.value}</span>
              <span className="tile-hint">View list →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Action {
  href: string;
  label: string;
  hint: string;
  primary?: boolean;
}

/** Shortcuts as large buttons; which ones appear depends on the role (the API still decides). */
function QuickActions({ me }: { me: MeResponse }) {
  const reviewer = me.role !== 'EMPLOYEE';
  const actions: Action[] = [
    { href: '/requests/new', label: 'Submit a request', hint: 'Equipment, software or other', primary: true },
    reviewer
      ? { href: '/requests?status=PENDING', label: 'Review pending', hint: 'Approve or reject requests' }
      : { href: '/requests', label: 'My requests', hint: 'Track what you submitted' },
    ...(reviewer ? [{ href: '/requests', label: 'All requests', hint: 'Everything in your company' }] : []),
    ...(me.role === 'ADMIN'
      ? [
          { href: '/admin/users', label: 'Manage users', hint: 'Accounts, roles and projects' },
          { href: '/admin/audit', label: 'Audit log', hint: 'Who did what, and when' },
          { href: '/status', label: 'System status', hint: 'Databases, Redis and migrations' },
        ]
      : []),
    { href: '/change-password', label: 'Change password', hint: 'Signs you out everywhere' },
  ];
  return (
    <section aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="section-title">
        Quick actions
      </h2>
      <ul className="action-grid">
        {actions.map((a) => (
          <li key={a.label}>
            <Link href={a.href} className={a.primary ? 'action-card action-primary' : 'action-card'}>
              <span className="action-label">{a.label}</span>
              <span className="action-hint">{a.hint}</span>
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
          <main className="page wide stack">
            <div className="page-heading">
              <h1>Dashboard</h1>
              <p className="muted">Welcome back, {me.user.displayName.split(' ')[0]}.</p>
            </div>
            <ProfileCard me={me} />
            <Counts me={me} />
            <QuickActions me={me} />
          </main>
        </>
      )}
    </RequireAuth>
  );
}
