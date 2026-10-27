import { createContext, useContext } from 'react';
import type { Role } from '../services/rolesService';

export interface RoleContextValue {
  role: Role;
  /** Editors and admins: the database lets them add and change data. */
  canEdit: boolean;
  isAdmin: boolean;
  loading: boolean;
  /** False until db/023 is applied; everyone can edit then, as before. */
  rolesEnabled: boolean;
  refresh: () => Promise<void>;
}

// Kept apart from RoleContext.tsx so that file exports only components (fast refresh).
export const RoleContext = createContext<RoleContextValue | null>(null);

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
