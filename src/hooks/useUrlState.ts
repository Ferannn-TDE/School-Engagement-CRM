import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A piece of page state kept in the address bar (?key=value), so it survives a
 * refresh, works with the back button, and is included when a link is shared.
 * The default value is left out of the URL to keep addresses short.
 */
export function useUrlState(key: string, defaultValue = ''): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === defaultValue || next === '') updated.delete(key);
          else updated.set(key, next);
          return updated;
        },
        // Replace rather than push: typing in a search box shouldn't add a
        // back-button step per keystroke.
        { replace: true }
      );
    },
    [key, defaultValue, setParams]
  );

  return [value, setValue];
}

/** Sets several URL values at once, e.g. clearing the page number when a filter changes. */
export function useUrlStateBatch(): (changes: Record<string, string>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (changes) => {
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === '') updated.delete(k);
            else updated.set(k, v);
          }
          return updated;
        },
        { replace: true }
      );
    },
    [setParams]
  );
}
