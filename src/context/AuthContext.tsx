import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  refreshMfaLevel: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaLevel, setMfaLevel] = useState<MfaLevel | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(true);

  const refreshMfaLevel = useCallback(async () => {
    setMfaLoading(true);
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        refreshMfaLevel();
      } else {
        setMfaLevel(null);
        setMfaLoading(false);
      }
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