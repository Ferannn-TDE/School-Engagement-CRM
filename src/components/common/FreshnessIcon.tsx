import { AlertTriangle } from 'lucide-react';
import type { FreshnessFlag } from '../../utils/freshness';

/**
 * A record's freshness issues (db/011) as one amber icon, listed on hover and for
 * screen readers. Used in tables, where badges would make rows grow; the detail pages
 * still show the full badges.
 */
export function FreshnessIcon({ flags }: { flags: FreshnessFlag[] }) {
  if (flags.length === 0) return null;
  const text = flags.map((f) => (f.detail ? `${f.label} (${f.detail})` : f.label)).join('\n');
  return (
    <span className="inline-flex shrink-0 text-warning" title={text}>
      <AlertTriangle size={14} aria-hidden="true" />
      <span className="sr-only">Needs attention: {flags.map((f) => f.label).join('; ')}</span>
    </span>
  );
}
