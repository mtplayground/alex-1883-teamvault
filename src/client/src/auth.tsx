import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AuthSessionResponse } from '../../shared/auth';
import { apiFetch } from './api';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-in'; data: AuthSessionResponse }
  | { status: 'signed-out' }
  | { status: 'unavailable'; message: string };

export interface AuthContextValue {
  state: AuthState;
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  async function refreshSession() {
    try {
      const response = await apiFetch('/api/auth/session');

      if (response.status === 401 || response.status === 403) {
        setState({ status: 'signed-out' });
        return;
      }

      if (!response.ok) {
        throw new Error(`Session check failed with ${response.status}`);
      }

      setState({
        status: 'signed-in',
        data: (await response.json()) as AuthSessionResponse,
      });
    } catch (error) {
      setState({
        status: 'unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'Unable to confirm the current session.',
      });
    }
  }

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setState({ status: 'signed-out' });
    window.location.assign('/login');
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refreshSession,
      signOut,
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return value;
}
