import { createContext, useContext } from 'react';
import type { AppContextValue } from './AppContext';

// Kept apart from AppContext.tsx so that file exports only components (fast refresh).
export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
