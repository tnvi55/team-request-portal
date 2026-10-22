'use client';

import type { MeResponse } from '@trp/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { AppNav } from './app-nav';

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
      <div>
        <strong>{me.organization.name}</strong>
        <span className="muted">
          {' '}
          · {me.user.displayName} ({me.role.toLowerCase()})
        </span>
      </div>
      <AppNav />
      <button type="button" onClick={() => void onLogout()} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
    </header>
  );
}
