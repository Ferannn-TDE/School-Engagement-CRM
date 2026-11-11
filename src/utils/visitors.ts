/** The most visitors one activity can record: a typo guard, not a real-world limit. */
export const MAX_VISITORS = 10000;

/**
 * Reads a "Number of visitors" entry. Blank means not recorded (null); otherwise a
 * whole number from 1 to MAX_VISITORS (activities.attendee_count is >= 1, db/022).
 */
export function parseVisitors(text: string): { value: number | null; error: string } {
  const t = text.trim().replace(/,/g, '');
  if (!t) return { value: null, error: '' };
  if (!/^\d+$/.test(t)) return { value: null, error: 'Enter a whole number, or leave it blank' };
  const n = Number(t);
  if (n < 1) return { value: null, error: 'Enter at least 1, or leave it blank' };
  if (n > MAX_VISITORS) return { value: null, error: `Enter ${MAX_VISITORS.toLocaleString()} or fewer` };
  return { value: n, error: '' };
}

export function visitorsLabel(n: number): string {
  return `${n.toLocaleString()} visitor${n === 1 ? '' : 's'}`;
}
