import { Archive } from 'lucide-react';
import type { ArchivedDecision, ArchivedMatch } from '../../utils/archivedMatches';
import { matchedRowCount } from '../../utils/archivedMatches';
import { classNames } from '../../utils/helpers';

interface Props {
  matches: ArchivedMatch[];
  decisions: Record<string, ArchivedDecision>;
  onChange: (decisions: Record<string, ArchivedDecision>) => void;
  disabled?: boolean;
}

/**
 * Lists import rows that match archived records and lets the person restore each
 * record or skip its rows. Skip is the default, so nothing archived changes unless
 * someone chooses to restore it.
 */
export function ArchivedMatchesPanel({ matches, decisions, onChange, disabled }: Props) {
  if (matches.length === 0) return null;
  const rows = matchedRowCount(matches);
  const setAll = (d: ArchivedDecision) =>
    onChange(Object.fromEntries(matches.map((m) => [m.key, d])));
  return (
    <section aria-label="Rows matching archived records" className="mb-6 p-4 rounded-lg border border-dashed border-neutral-300 bg-neutral-50">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-neutral-800 flex items-center gap-2">
          <Archive size={16} className="text-neutral-500" />
          {rows} row{rows !== 1 ? 's' : ''} match{rows === 1 ? 'es' : ''} archived records
        </h3>
        <div className="flex gap-2 text-xs">
          <button type="button" className="text-info hover:underline disabled:opacity-50" onClick={() => setAll('restore')} disabled={disabled}>Restore all</button>
          <span className="text-neutral-300">|</span>
          <button type="button" className="text-info hover:underline disabled:opacity-50" onClick={() => setAll('skip')} disabled={disabled}>Skip all</button>
        </div>
      </div>
      <p className="text-xs text-neutral-500 mb-3">
        Restore brings the record back and imports these rows into it. Skip leaves the record archived and leaves these rows out.
      </p>
      <ul className="divide-y divide-neutral-200">
        {matches.map((m) => {
          const d = decisions[m.key] ?? 'skip';
          return (
            <li key={m.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-neutral-800">
                  <span className="text-xs uppercase tracking-wide text-neutral-500 mr-2">{m.kind === 'school' ? 'School' : 'Contact'}</span>
                  {m.label}
                </p>
                <p className="text-xs text-neutral-500">{m.rows.join(', ')}</p>
              </div>
              <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs" role="radiogroup" aria-label={`${m.label}: restore or skip`}>
                {(['restore', 'skip'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={d === opt}
                    disabled={disabled}
                    onClick={() => onChange({ ...decisions, [m.key]: opt })}
                    className={classNames(
                      'px-3 py-1',
                      d === opt ? 'bg-siue-red text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'
                    )}
                  >
                    {opt === 'restore' ? 'Restore' : 'Skip'}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
