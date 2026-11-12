import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { useAppContext } from '../../context/useAppContext';
import { useRole } from '../../context/useRole';
import { isTestingDate } from '../../utils/events';
import { classNames } from '../../utils/helpers';
import { Modal } from '../common/Modal';
import { EventForm } from './EventForm';
import type { Event } from '../../types';

interface EventPickerProps {
  id: string;
  label: string;
  /** The chosen event's id, or '' for none. */
  value: string;
  onChange: (eventId: string, event?: Event) => void;
  /** "yyyy-MM-dd": events nearest this day come first, past or future. Today when blank. */
  near?: string;
  /** Offer "Create new event" (opens the event form and selects the new event). */
  allowCreate?: boolean;
  /** What "nothing chosen" is called: "No event" when linking, "All events" when filtering. */
  noneLabel?: string;
  /** Only events that can be linked to an activity: added in the app or scraped into the
   *  events table (ids "e_…"), testing dates left out. */
  linkableOnly?: boolean;
}

const MAX_SHOWN = 60;

/**
 * A searchable event picker: the events nearest a date first (past ones included),
 * filtered as you type by name or place, with "No event" at the top and, for editors,
 * "Create new event" at the bottom.
 */
export function EventPicker({ id, label, value, onChange, near, allowCreate, noneLabel = 'No event', linkableOnly = true }: EventPickerProps) {
  const { state } = useAppContext();
  const { canEdit } = useRole();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const chosen = value ? state.events.find((e) => e.id === value) : undefined;
  const anchor = new Date(`${near || format(new Date(), 'yyyy-MM-dd')}T12:00:00`).getTime();

  const options = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return state.events
      .filter((e) => !linkableOnly || (e.id.startsWith('e_') && !isTestingDate(e)))
      .filter((e) => {
        if (!words.length) return true;
        const text = `${e.name} ${e.location}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .map((e) => ({ e, distance: Math.abs(new Date(`${e.date.slice(0, 10)}T12:00:00`).getTime() - anchor) }))
      .sort((a, b) => a.distance - b.distance || a.e.name.localeCompare(b.e.name))
      .map((x) => x.e);
  }, [state.events, query, anchor, linkableOnly]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const onDown = (ev: MouseEvent) => { if (!box.current?.contains(ev.target as Node)) setOpen(false); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (eventId: string, event?: Event) => {
    onChange(eventId, event);
    setOpen(false);
    setQuery('');
  };
  const when = (e: Event) => format(new Date(e.date), 'MMM d, yyyy');
  const itemCls = 'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 focus-visible:outline-none focus-visible:bg-neutral-100';

  return (
    <div className="w-full" ref={box}>
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      <div className="relative">
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:border-siue-red focus:ring-siue-red/30"
        >
          <span className={classNames('truncate', !chosen && 'text-neutral-500')}>
            {chosen ? `${chosen.name} (${when(chosen)})` : value ? 'An event that is no longer listed' : noneLabel}
          </span>
          <ChevronDown size={16} className="shrink-0 text-neutral-400" />
        </button>
        {open && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-lg">
            <div className="relative border-b border-neutral-100 p-2">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                placeholder="Search events by name or place"
                aria-label="Search events"
                className="w-full rounded-md border border-neutral-200 pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-siue-red/30"
              />
            </div>
            <ul role="listbox" aria-label={label} className="max-h-72 overflow-y-auto py-1">
              <li>
                <button type="button" role="option" aria-selected={!value} className={itemCls} onClick={() => pick('')}>
                  <span className="w-4 shrink-0">{!value && <Check size={14} className="text-siue-red" />}</span>
                  <span className="text-neutral-600">{noneLabel}</span>
                </button>
              </li>
              {options.slice(0, MAX_SHOWN).map((e) => (
                <li key={e.id}>
                  <button type="button" role="option" aria-selected={e.id === value} className={itemCls} onClick={() => pick(e.id, e)}>
                    <span className="w-4 shrink-0">{e.id === value && <Check size={14} className="text-siue-red" />}</span>
                    <span className="min-w-0 flex-1 truncate text-neutral-800">{e.name}</span>
                    <span className="shrink-0 text-xs text-neutral-500">{when(e)}</span>
                  </button>
                </li>
              ))}
              {options.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">No events match “{query.trim()}”.</li>}
              {options.length > MAX_SHOWN && (
                <li className="px-3 py-2 text-xs text-neutral-500">Showing the {MAX_SHOWN} nearest of {options.length}. Type to narrow it down.</li>
              )}
              {allowCreate && canEdit && (
                <li className="border-t border-neutral-100 mt-1 pt-1">
                  <button type="button" className={classNames(itemCls, 'text-siue-red font-medium')} onClick={() => { setOpen(false); setCreating(true); }}>
                    <Plus size={14} className="shrink-0" /> Create new event
                  </button>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
      {/* Drawn at the end of the page, so the event form is never inside another form
          (the picker sits in the activity edit form). */}
      {creating && createPortal(
        <Modal open onClose={() => setCreating(false)} title="Create Event" size="lg">
          <EventForm
            initialDate={near || undefined}
            onClose={() => setCreating(false)}
            onCreated={(e) => pick(e.id, e)}
          />
        </Modal>,
        document.body
      )}
    </div>
  );
}
