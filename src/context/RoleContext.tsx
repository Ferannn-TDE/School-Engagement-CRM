import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RoleContext } from './useRole';
import { fetchMyRole, isRolesMissing, type Role } from '../services/rolesService';

/**
 * The signed-in account's role (db/023), for showing or hiding controls. The database
 * is the real check: hiding a button here never grants or removes access.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('viewer');
  const [rolesEnabled, setRolesEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((result: { role: Role; enabled: boolean }) => {
    setRole(result.role);
    setRolesEnabled(result.enabled);
    setLoading(false);
  }, []);

  const load = useCallback(
    () =>
      fetchMyRole()
        .then((r) => ({ role: r, enabled: true }))
        .catch((err: unknown) => {
          // Before 023 every account can edit, so show the controls as before.
          if (isRolesMissing(err)) return { role: 'editor' as Role, enabled: false };
          console.error('fetchMyRole failed:', err);
          return { role: 'viewer' as Role, enabled: true };
        }),
    []
  );

  useEffect(() => {
    void load().then(apply);
  }, [load, apply]);

  const refresh = useCallback(async () => {
    apply(await load());
  }, [load, apply]);

  const value = useMemo(
    () => ({
      role,
      canEdit: role === 'admin' || role === 'editor',
      isAdmin: role === 'admin',
      loading,
      rolesEnabled,
      refresh,
    }),
    [role, loading, rolesEnabled, refresh]
  );
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
