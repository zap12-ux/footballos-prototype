import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Me, SignInResult } from '../api';
import { useApi } from '../api/hooks';

export type AuthState =
  | { status: 'loading'; me: null }
  | { status: 'anonymous'; me: null }
  | { status: 'authenticated'; me: Me };

interface AuthValue {
  state: AuthState;
  signIn(input: { email: string; password: string }): Promise<SignInResult>;
  verifyMfa(input: { code: string }): Promise<Me>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Session state for the whole app. `GET /auth/me` runs once on load. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const [state, setState] = useState<AuthState>({ status: 'loading', me: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.auth.me();
      setState(me ? { status: 'authenticated', me } : { status: 'anonymous', me: null });
    } catch {
      // A server that cannot be reached is reported by the screens; here it means "not signed in".
      setState({ status: 'anonymous', me: null });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      state,
      refresh,
      async signIn(input) {
        const result = await api.auth.signIn(input);
        if (result.kind === 'signed_in') setState({ status: 'authenticated', me: result.me });
        return result;
      },
      async verifyMfa(input) {
        const me = await api.auth.verifyMfa(input);
        setState({ status: 'authenticated', me });
        return me;
      },
      async signOut() {
        await api.auth.signOut();
        setState({ status: 'anonymous', me: null });
      },
    }),
    [api, state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** The signed-in user; only valid under <RequireAuth>. */
export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useMe called outside an authenticated route');
  return state.me;
}
