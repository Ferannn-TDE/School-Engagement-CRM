import type { Event } from '../types';

/**
 * SAT/ACT/PSAT/AP exam days (events.category, db/007). The client doesn't do outreach
 * on these days but wants them visible as busy dates, so they are left out of event
 * lists by default and out of every event count and engagement number.
 */
export const TESTING_DATE_CATEGORY = 'school_testing_date';

export function isTestingDate(event: Event): boolean {
  return event.category === TESTING_DATE_CATEGORY;
}

/** Events that count as outreach: everything except testing dates. */
export function outreachEvents(events: Event[]): Event[] {
  return events.filter((e) => !isTestingDate(e));
}

/**
 * Where an event came from, as people say it. Events have no stored type: the old
 * "Outreach Fair" label only meant "found by the scraper", so it was on every
 * scraped event, information nights included. The source is what we really know.
 */
export function eventSourceLabel(event: Event): string {
  if (isTestingDate(event)) return 'Testing date';
  if (event.source === 'iacac') return 'IACAC college fair';
  if (event.source === 'school_calendar') return 'School calendar';
  return 'Added in the app';
}

export const EVENT_SOURCE_OPTIONS = [
  { value: 'iacac', label: 'IACAC college fairs' },
  { value: 'school_calendar', label: 'School calendars' },
  { value: 'manual', label: 'Added in the app' },
];
