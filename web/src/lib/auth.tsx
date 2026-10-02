import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser } from '@dawa/shared';
import { authApi, refreshSession, setAccessToken, setSessionLostHandler } from './api';
import { queryClient } from './query';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  /** Returns the user, or a challenge token when the account uses two-factor authentication. */
  login: (email: string, password: string) => Promise<AuthUser | { mfaToken: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  can: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  const signOutLocally = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('signed-out');
    queryClient.clear();
  }, []);

  useEffect(() => {
    setSessionLostHandler(signOutLocally);
    refreshSession()
      .then((r) => {
        if (r) {
          setUser(r.user as AuthUser);
          setStatus('signed-in');
        } else setStatus('signed-out');
      })
      .catch(() => setStatus('signed-out'));
  }, [signOutLocally]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await authApi.login(email, password);
    if ('mfaRequired' in r) return { mfaToken: r.mfaToken };
    setAccessToken(r.accessToken);
    setUser(r.user as AuthUser);
    setStatus('signed-in');
    return r.user as AuthUser;
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const r = await authApi.loginMfa(mfaToken, code);
    setAccessToken(r.accessToken);
    setUser(r.user as AuthUser);
    setStatus('signed-in');
    return r.user as AuthUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      signOutLocally();
    }
  }, [signOutLocally]);

  const can = useCallback(
    (...permissions: string[]) => Boolean(user && permissions.some((p) => user.permissions.includes(p))),
    [user],
  );

  const value = useMemo(() => ({ user, status, login, completeMfa, logout, setUser, can }), [user, status, login, completeMfa, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Signed-in user (only use beneath the authenticated layout). */
export function useUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error('No signed-in user');
  return user;
}
