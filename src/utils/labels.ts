import { EventTypeLabels, ProgramCategoryLabels, type Event, type Program } from '../types';

// "Other" with a "Please specify" box (db/028): wherever a choice has Other, the text
// typed is shown instead of the word "Other".

/** The specify text when there is one, otherwise the label. */
export function otherOr(value: string | undefined, label: string, other: string | undefined): string {
  return value === 'other' && other?.trim() ? other.trim() : label;
}

export function programCategoryLabel(p: Pick<Program, 'category' | 'categoryOther'>): string {
  return otherOr(p.category, ProgramCategoryLabels[p.category] ?? p.category, p.categoryOther);
}

/** Event Type, saved since db/028: "Not set" for events saved before (and scraped ones). */
export function eventTypeLabel(e: Pick<Event, 'type' | 'typeOther'>): string {
  if (!e.type) return 'Not set';
  return otherOr(e.type, EventTypeLabels[e.type] ?? e.type, e.typeOther);
}

/** The required "Please specify" rule: '' when fine. */
export function specifyError(value: string, text: string): string {
  return value === 'other' && !text.trim() ? 'Please specify' : '';
}
