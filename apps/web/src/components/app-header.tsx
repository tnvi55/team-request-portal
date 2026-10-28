'use client';

import type { MeResponse } from '@trp/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { AppNav } from './app-nav';

/** "Rohan Gupta" -> "RG": a small avatar without loading any image. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

export const roleLabel = (role: MeResponse['role']) => role.charAt(0) + role.slice(1).toLowerCase();

export function AppHeader({ me }: { me: MeResponse }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    setPending(true);
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/dashboard" className="brand" aria-label={`${me.organization.name} dashboard`}>
          <span className="brand-logo" aria-hidden="true">
            {initials(me.organization.name)}
          </span>
          <span className="brand-text">
            <strong>{me.organization.name}</strong>
            <span className="muted small">Request portal</span>
          </span>
        </Link>
        <AppNav role={me.role} />
        <div className="user-menu">
          <span className="avatar" aria-hidden="true">
            {initials(me.user.displayName)}
          </span>
          <span className="user-text">
            <strong>{me.user.displayName}</strong>
            <span className="muted small">
              {me.profile.jobTitle ? `${me.profile.jobTitle} · ` : ''}
              {roleLabel(me.role)}
            </span>
          </span>
          <button type="button" className="ghost" onClick={() => void onLogout()} disabled={pending}>
            {pending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </header>
  );
}
