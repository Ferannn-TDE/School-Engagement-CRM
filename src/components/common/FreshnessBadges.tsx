import { Badge } from './Badge';
import type { FreshnessFlag } from '../../utils/freshness';

/** The freshness labels for a record (db/011), with the date behind each on hover. */
export function FreshnessBadges({ flags, className }: { flags: FreshnessFlag[]; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <span className={className ?? 'inline-flex flex-wrap gap-1'}>
      {flags.map((f) => (
        <span key={f.label} title={f.detail}>
          <Badge variant={f.variant} className="border border-current/20">{f.label}</Badge>
        </span>
      ))}
    </span>
  );
}
