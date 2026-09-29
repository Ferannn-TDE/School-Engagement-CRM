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
