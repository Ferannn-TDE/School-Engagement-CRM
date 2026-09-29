// What the scraper found for a field the client locked (db/006, db/012), and how the
// client answers: "The website now says X — keep yours or use this?"

export interface PendingValue {
  value: unknown;
  seen_at: string;
  dismissed?: boolean;
  dismissed_at?: string;
  dismissed_by?: string;
}

export type PendingMap = Record<string, PendingValue>;

/** A question to show: a locked field with a newer website value nobody has answered. */
export interface OpenPending {
  column: string;
  value: unknown;
  seenAt: string;
}

export function openPending(pending: PendingMap | undefined, locked: string[] | undefined): OpenPending[] {
  if (!pending) return [];
  return Object.entries(pending)
    .filter(([col, p]) => !p.dismissed && (locked ?? []).includes(col))
    .map(([column, p]) => ({ column, value: p.value, seenAt: p.seen_at }));
}

/**
 * "Use this": the website's value, with the entry removed and the column unlocked.
 * db/012 treats exactly this update as accepting the value, so it doesn't re-lock.
 */
export function acceptPatch(column: string, pending: PendingMap, locked: string[]): Record<string, unknown> {
  const rest = { ...pending };
  delete rest[column];
  return {
    [column]: pending[column].value,
    pending_scraped: rest,
    manual_fields: locked.filter((c) => c !== column),
  };
}

/** "Keep yours": the value and the lock stay; the answer is recorded so it isn't asked again. */
export function dismissPatch(column: string, pending: PendingMap, who: string): Record<string, unknown> {
  return {
    pending_scraped: {
      ...pending,
      [column]: { ...pending[column], dismissed: true, dismissed_at: new Date().toISOString(), dismissed_by: who },
    },
  };
}

const LABELS: Record<string, string> = {
  name: 'Name', phone: 'Phone', address: 'Address', type_of_school: 'School type', admin: 'Administrator',
  city: 'City', zipcode: 'ZIP code', grades_served: 'Grades served', website: 'Website', county_name: 'County',
  is_active: 'Active', notes: 'Notes', enrollment: 'Enrollment', grade_range: 'Grade range',
  priority_tier: 'Priority', state_code: 'State', email: 'Email', job_name: 'Title', school_worked_at: 'School',
};

export const fieldLabel = (column: string) => LABELS[column] ?? column;

export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
