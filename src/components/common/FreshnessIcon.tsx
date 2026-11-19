import { AlertTriangle } from 'lucide-react';
import type { FreshnessFlag } from '../../utils/freshness';
import { InfoTip } from './InfoTip';

/** What the amber triangle means, for the tooltip's footer and the legend under tables. */
export const FRESHNESS_LEGEND =
  'The amber triangle means something about the record may be out of date: not changed in over a year, a website problem, or no longer listed. Hover or tap it to see what.';

/**
 * A record's freshness issues (db/011) as one amber icon. Hover, focus or tap it for
 * each issue in plain words (what it means, what to do, and the date behind it), with
 * a one-line legend. Used in tables, where badges would make rows grow; the detail
 * pages still show the full badges.
 */
export function FreshnessIcon({ flags, name }: { flags: FreshnessFlag[]; name?: string }) {
  if (flags.length === 0) return null;
  const count = flags.length === 1 ? '1 thing to check' : `${flags.length} things to check`;
  return (
    <InfoTip
      label={name ?? 'this record'}
      buttonLabel={`Needs attention, ${count}${name ? ` for ${name}` : ''}`}
      className="text-warning hover:text-amber-700 focus-visible:text-amber-700"
      icon={<AlertTriangle size={14} aria-hidden="true" />}
      content={
        <div className="space-y-2 whitespace-normal">
          <p className="font-semibold">Needs attention: {count}</p>
          <ul className="space-y-1.5 list-disc pl-4">
            {flags.map((f) => (
              <li key={f.label}>
                <span className="font-medium">{f.label}.</span> {f.explain}
                <span className="block text-neutral-300">{f.detail}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-white/20 pt-1.5 text-neutral-300">{FRESHNESS_LEGEND}</p>
        </div>
      }
    />
  );
}

/** A one-line legend for a table that shows the amber icon. */
export function FreshnessLegend() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-neutral-500">
      <AlertTriangle size={13} className="mt-px shrink-0 text-warning" aria-hidden="true" />
      <span>{FRESHNESS_LEGEND}</span>
    </p>
  );
}
