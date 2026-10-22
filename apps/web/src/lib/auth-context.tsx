'use client';

import type { LoginRequest, MeResponse } from '@trp/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiRequestError, forgetCsrfToken } from './api';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; me: MeResponse }
  | { status: 'error' };

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
  login: (body: LoginRequest) => Promise<MeResponse>;
  logout: () => Promise<void>;
  /** Clears local state after the server ended the session (password change, 401). */
  signedOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadMe(): Promise<AuthState> {
  try {
    return { status: 'authenticated', me: await api<MeResponse>('/auth/me') };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return { status: 'anonymous' };
    return { status: 'error' };
  }
}

/** Who is signed in, as the API reports it. Holds no tokens: the session cookie is HttpOnly. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void loadMe().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setState(await loadMe());
  }, []);

  const login = useCallback(async (body: LoginRequest) => {
    const me = await api<MeResponse>('/auth/login', { method: 'POST', body });
    forgetCsrfToken(); // rotated by the server at login
    setState({ status: 'authenticated', me });
    return me;
  }, []);

  const signedOut = useCallback(() => {
    forgetCsrfToken();
    setState({ status: 'anonymous' });
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      signedOut(); // private UI state is dropped even if the network call failed
    }
  }, [signedOut]);

  const value = useMemo(
    () => ({ state, refresh, login, logout, signedOut }),
    [state, refresh, login, logout, signedOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
