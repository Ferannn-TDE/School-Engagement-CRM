import { useCallback, useState, type ReactNode } from 'react';
import { LayoutContext } from './useLayout';

export interface LayoutContextValue {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <LayoutContext.Provider value={{ sidebarOpen, toggleSidebar, closeSidebar }}>
      {children}
    </LayoutContext.Provider>
  );
}
