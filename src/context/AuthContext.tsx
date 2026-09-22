import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

type AalLevel = 'aal1' | 'aal2' | null;

interface MfaLevel {
  currentLevel: AalLevel;
  nextLevel: AalLevel;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  mfaLevel: MfaLevel | null;
  mfaLoading: boolean;
  refreshMfaLevel: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaLevel, setMfaLevel] = useState<MfaLevel | null>(null);
  const [mfaLoading, setMfaLoading] = useState(true);

  const refreshMfaLevel = useCallback(async () => {
    setMfaLoading(true);
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
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
    <AuthContext.Provider value={{ user, loading, mfaLevel, mfaLoading, refreshMfaLevel, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
