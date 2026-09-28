import { createContext, useContext } from 'react';
import type { AppState } from './AppContext';

/**
 * Present only on pages limited by the All / IL / MO filter. Carries the full,
 * unfiltered data for the few things that must stay global, like header search.
 */
export const RegionScopeContext = createContext<{ fullState: AppState } | null>(null);

export function useRegionScope() {
  return useContext(RegionScopeContext);
}
