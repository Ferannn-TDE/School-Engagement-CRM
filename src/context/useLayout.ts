import { createContext, useContext } from 'react';
import type { LayoutContextValue } from './LayoutContext';

// Kept apart from LayoutContext.tsx so that file exports only components (fast refresh).
export const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
