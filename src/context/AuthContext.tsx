import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthContext } from './useAuth';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { fetchAssignedRole } from '../services/rolesService';

type AalLevel = 'aal1' | 'aal2' | null;

interface MfaLevel {
  currentLevel: AalLevel;
  nextLevel: AalLevel;
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  mfaLevel: MfaLevel | null;
  mfaLoading: boolean;
  /**
   * Editors and admins must finish the authenticator step; viewers don't (db/025). True when
   * the role can't be read, so a failure never lets someone past the step.
   */
  mfaRequired: boolean;
  /** Re-reads the sign-in level. `quiet` skips mfaLoading, so the app isn't replaced by the
   *  full-page spinner (background checks after a token refresh or tab focus). */
  refreshMfaLevel: (quiet?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaLevel, setMfaLevel] = useState<MfaLevel | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(true);

  // The signed-in account's id, to tell a background event for the same person (token
  // refresh, tab focus, MFA verified) from a different person signing in.
  const userIdRef = useRef<string | null>(null);

  const refreshMfaLevel = useCallback(async (quiet = false) => {
    if (!quiet) setMfaLoading(true);
    const [{ data, error }, assigned] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      // Before db/025 is applied this function doesn't exist: keep requiring MFA for everyone.
      fetchAssignedRole().catch(() => null),
    ]);
    setMfaRequired(assigned !== 'viewer');
    if (!error && data) {
      setMfaLevel({ currentLevel: data.currentLevel, nextLevel: data.nextLevel });
    } else {
      setMfaLevel(null);
    }
    setMfaLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      userIdRef.current = session?.user?.id ?? null;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        refreshMfaLevel();
      } else {
        setMfaLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase sends TOKEN_REFRESHED about once an hour, and SIGNED_IN again when a tab
      // comes back and the session is restored. These used to set mfaLoading, which made
      // AuthGuard swap the whole app for the full-page spinner and load everything again
      // (proved 2026-11-12: refreshSession() → spinner → 25 table fetches → pages remounted).
      // Now only a different account (or signing out) resets anything; for the same
      // account the sign-in level is re-checked quietly.
      const next = session?.user ?? null;
      const sameAccount = !!next && next.id === userIdRef.current;
      userIdRef.current = next?.id ?? null;
      setUser((prev) => (sameAccount && prev && event !== 'USER_UPDATED' ? prev : next));
      if (!next) {
        setMfaLevel(null);
        setMfaLoading(false);
        return;
      }
      // getSession() above already handles the first session.
      if (event === 'INITIAL_SESSION') return;
      void refreshMfaLevel(sameAccount);
    });

    return () => subscription.unsubscribe();
  }, [refreshMfaLevel]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setMfaLevel(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, mfaLevel, mfaLoading, mfaRequired, refreshMfaLevel, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}