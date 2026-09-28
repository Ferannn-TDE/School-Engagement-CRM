import { useEffect } from 'react';
import { useUrlState } from './useUrlState';
import { parseRegion, type Region } from '../utils/region';

const STORAGE_KEY = 'crm.region';

/** The last state chosen anywhere, so the sidebar can carry it to the next tab. */
export function rememberedRegion(): Region {
  try {
    return parseRegion(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return '';
  }
}

/**
 * The one shared All / IL / MO choice. It lives in the address (?state=MO) so it
 * survives a refresh and shared links, and is remembered for this browser tab so
 * the sidebar keeps it when moving between tabs.
 */
export function useStateFilter(): [Region, (region: Region) => void] {
  const [raw, setRaw] = useUrlState('state');
  const region = parseRegion(raw);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, region);
    } catch {
      /* storage unavailable: the choice still works on this page */
    }
  }, [region]);

  return [region, (next) => setRaw(next)];
}
