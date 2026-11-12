import { format, subMonths } from 'date-fns';
import type { Contact, School } from '../types';
import { UPDATED_RECENT_MONTHS } from '../constants/reportSettings';

// Plain-language freshness labels (db/011, db/027). Verified has no time limit: it's an
// on/off switch. What ages is the record itself: "Last updated <date> by <who>",
// flagged when that is more than UPDATED_RECENT_MONTHS months ago.

export interface FreshnessFlag {
  label: string;
  variant: 'warning' | 'error' | 'default';
  /** Shown on hover: the date behind the label. */
  detail: string;
}

const day = (iso: string) => format(new Date(iso), 'MMM d, yyyy');

/** Who made a change, as people say it: an email, or "the scraper or database" for the owner connection. */
export function whoLabel(by: string | undefined): string | undefined {
  if (!by) return undefined;
  return by === 'database' ? 'the scraper or database' : by;
}

/** "Last updated Nov 1, 2026 by someone@siue.edu", or without "by" when nobody is recorded. */
export function lastUpdatedText(at: string | undefined, by: string | undefined): string {
  if (!at) return 'Last updated: not recorded';
  const who = whoLabel(by);
  return `Last updated ${day(at)}${who ? ` by ${who}` : ''}`;
}

/** "Verified Nov 12, 2026 by someone@siue.edu" / "Unverified …", or undefined when never switched. */
export function verificationText(isVerified: boolean | undefined, at: string | undefined, by: string | undefined): string | undefined {
  if (!at) return undefined;
  const who = whoLabel(by);
  return `${isVerified ? 'Verified' : 'Marked unverified'} ${day(at)}${who ? ` by ${who}` : ''}`;
}

/** Not updated in more than UPDATED_RECENT_MONTHS months: the record may be out of date. */
function staleUpdate(at: string | undefined, by: string | undefined, now: Date): FreshnessFlag | null {
  if (!at || new Date(at) >= subMonths(now, UPDATED_RECENT_MONTHS)) return null;
  return { label: `Not updated in over ${UPDATED_RECENT_MONTHS} months`, variant: 'warning', detail: lastUpdatedText(at, by) };
}

export function schoolFreshness(school: School, now = new Date()): FreshnessFlag[] {
  const flags: FreshnessFlag[] = [];
  const stale = staleUpdate(school.lastUpdatedAt, school.updatedBy, now);
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
  const stale = staleUpdate(contact.lastUpdatedAt, contact.updatedBy, now);
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
