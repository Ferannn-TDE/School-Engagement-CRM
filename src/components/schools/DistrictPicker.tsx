import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { getDistricts } from '../../services/schoolsService';
import { classNames } from '../../utils/helpers';

/**
 * A searchable pick from the existing districts in the school's state (the district
 * table). No free text and no new districts: choose one, or "No district".
 */
export function DistrictPicker({ value, state, onChange }: {
  value: number | undefined;
  state: string;
  onChange: (id: number | undefined, name: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const all = getDistricts();
  const chosen = value != null ? all.find((d) => d.id === value) : undefined;

  const options = useMemo(() => {
    const st = state.trim().toUpperCase();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all
      .filter((d) => !st || !d.state || d.state === st)
      .filter((d) => words.every((w) => d.name.toLowerCase().includes(w)));
  }, [all, state, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (id: number | undefined, name: string | undefined) => { onChange(id, name); setOpen(false); setQuery(''); };
  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 focus-visible:outline-none focus-visible:bg-neutral-100';

  return (
    <div className="w-full" ref={box}>
      <label htmlFor="school-district" className="block text-sm font-medium text-neutral-700 mb-1">District</label>
      <div className="relative">
        <button id="school-district" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:border-siue-red focus:ring-siue-red/30">
          <span className={classNames('truncate', !chosen && 'text-neutral-500')}>
            {chosen ? chosen.name : value != null ? 'A district that is no longer listed' : 'No district'}
          </span>
          <ChevronDown size={16} className="shrink-0 text-neutral-400" />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="relative border-b border-neutral-100 p-2">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                placeholder={state ? `Search districts in ${state.toUpperCase()}` : 'Search districts'} aria-label="Search districts"
                className="w-full rounded-md border border-neutral-200 pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-siue-red/30" />
            </div>
            <ul role="listbox" aria-label="District" className="max-h-64 overflow-y-auto py-1">
              <li>
                <button type="button" role="option" aria-selected={value == null} className={item} onClick={() => pick(undefined, undefined)}>
                  <span className="w-4 shrink-0">{value == null && <Check size={14} className="text-siue-red" />}</span>
                  <span className="text-neutral-600">No district</span>
                </button>
              </li>
              {options.slice(0, 80).map((d) => (
                <li key={d.id}>
                  <button type="button" role="option" aria-selected={d.id === value} className={item} onClick={() => pick(d.id, d.name)}>
                    <span className="w-4 shrink-0">{d.id === value && <Check size={14} className="text-siue-red" />}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {d.state && <span className="shrink-0 text-xs text-neutral-500">{d.state}</span>}
                  </button>
                </li>
              ))}
              {options.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">No districts match.</li>}
              {options.length > 80 && <li className="px-3 py-2 text-xs text-neutral-500">Showing 80 of {options.length}. Type to narrow it down.</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
