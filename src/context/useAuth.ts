import { createContext, useContext } from 'react';
import type { AuthContextValue } from './AuthContext';

// Kept apart from AuthContext.tsx so that file exports only components (fast refresh).
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
