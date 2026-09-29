import { format, subMonths } from 'date-fns';
import type { Contact, School } from '../types';

// Plain-language freshness labels (db/011). The scraper fills the columns; until it
// does, only "Not verified in 6+ months" can appear.

export interface FreshnessFlag {
  label: string;
  variant: 'warning' | 'error' | 'default';
  /** Shown on hover: the date behind the label. */
  detail: string;
}

const day = (iso: string) => format(new Date(iso), 'MMM d, yyyy');

/** Verified, but longer ago than six months. Never-verified records already say "Unverified". */
function staleVerification(isVerified: boolean | undefined, lastVerifiedAt: string | undefined, now: Date): FreshnessFlag | null {
  if (!isVerified || !lastVerifiedAt) return null;
  if (new Date(lastVerifiedAt) >= subMonths(now, 6)) return null;
  return { label: 'Not verified in 6+ months', variant: 'warning', detail: `Last verified ${day(lastVerifiedAt)}` };
}

export function schoolFreshness(school: School, now = new Date()): FreshnessFlag[] {
  const flags: FreshnessFlag[] = [];
  const stale = staleVerification(school.isVerified, school.lastVerifiedAt, now);
  if (stale) flags.push(stale);
  const checked = school.sourceCheckedAt ? `Checked ${day(school.sourceCheckedAt)}` : 'Checked by the scraper';
  if (school.sourceStatus === 'broken') flags.push({ label: 'Website link broken', variant: 'error', detail: checked });
  if (school.sourceStatus === 'not_found') flags.push({ label: 'Website not found', variant: 'warning', detail: checked });
  if (school.missingSince) {
    flags.push({
      label: "No longer on the state's school list",
      variant: 'default',
      detail: `Not found in ${school.missedRuns ?? 3} scraper runs in a row, since ${day(school.missingSince)}`,
    });
  }
  return flags;
}

export function contactFreshness(contact: Contact, now = new Date()): FreshnessFlag[] {
  const flags: FreshnessFlag[] = [];
  const stale = staleVerification(contact.isVerified, contact.lastVerifiedAt, now);
  if (stale) flags.push(stale);
  if (contact.missingSince) {
    flags.push({
      label: "No longer listed on the school's site",
      variant: 'default',
      detail: `Not found in ${contact.missedRuns ?? 3} scraper runs in a row, since ${day(contact.missingSince)}`,
    });
  }
  return flags;
}
