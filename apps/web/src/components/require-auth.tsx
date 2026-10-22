'use client';

import type { MeResponse } from '@trp/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../lib/auth-context';

/**
 * Client-side routing only: it decides which page to SHOW. The API enforces every rule itself,
 * so hiding a page here is a convenience, never the protection.
 */
export function RequireAuth({ children }: { children: (me: MeResponse) => ReactNode }) {
  const { state, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const mustChange = state.status === 'authenticated' && state.me.mustChangePassword;
  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/login');
    else if (mustChange && pathname !== '/change-password') router.replace('/change-password');
  }, [state.status, mustChange, pathname, router]);

  if (state.status === 'loading') return <p aria-live="polite">Loading…</p>;
  if (state.status === 'error') {
    return (
      <div role="alert" className="card">
        <p className="bad">Could not reach the server.</p>
        <button type="button" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    );
  }
  if (state.status !== 'authenticated') return null;
  if (mustChange && pathname !== '/change-password') return null;
  return <>{children(state.me)}</>;
}
