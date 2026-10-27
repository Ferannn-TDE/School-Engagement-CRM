import { useMemo, type ReactNode } from 'react';
import { AppStateOverride } from '../../context/AppContext';
import { useAppContext } from '../../context/useAppContext';
import { RegionScopeContext } from '../../context/RegionScopeContext';
import { useStateFilter } from '../../hooks/useStateFilter';
import { scopeToRegion } from '../../utils/region';

/**
 * Limits every page inside it to the state chosen in the shared All / IL / MO
 * filter. Pages read their data as usual and simply receive that state's schools
 * and everything attached to them, so no page can apply the filter differently.
 *
 * Contacts, logged contacts and programs follow their school. Events follow their
 * participating schools, or the state named in their location when they have none;
 * events with neither are Unknown and appear only under All.
 */
export function RegionScope({ children }: { children: ReactNode }) {
  const { state } = useAppContext();
  const [region] = useStateFilter();

  const scoped = useMemo(() => scopeToRegion(state, region), [state, region]);

  const scopeValue = useMemo(() => ({ fullState: state }), [state]);

  return (
    <RegionScopeContext.Provider value={scopeValue}>
      <AppStateOverride state={scoped}>{children}</AppStateOverride>
    </RegionScopeContext.Provider>
  );
}
