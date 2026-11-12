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

/**
 * Who attended each event, from imported attendance: activities of type
 * event_participation linked to the event (db/022). An event's own school list
 * (participatingSchools) is often a scraped calendar, not who came, and imports never
 * add to it, so "went to this event" is the two together. Only attendance whose day
 * has come counts. The event records themselves are never changed.
 */
export function attendanceByEvent(
  activities: { schoolId: string; eventId?: string; activityType: string; date: string }[],
  today: string
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!a.eventId || a.activityType !== 'event_participation' || a.date.slice(0, 10) > today) continue;
    const set = map.get(a.eventId) ?? new Set<string>();
    set.add(a.schoolId);
    map.set(a.eventId, set);
  }
  return map;
}

/** The schools at an event: listed on it, or with imported attendance for it. */
export function schoolsAtEvent(event: Pick<Event, 'id' | 'participatingSchools'>, attendance: Map<string, Set<string>>): string[] {
  const attended = attendance.get(event.id);
  if (!attended?.size) return event.participatingSchools;
  return [...new Set([...event.participatingSchools, ...attended])];
}

/**
 * Attendance rows with no event linked (an import saved without choosing an event),
 * per school. They still count as having been to an event; they just can't be shown
 * under a particular event.
 */
export function unlinkedAttendance(
  activities: { schoolId: string; eventId?: string; activityType: string; date: string }[],
  today: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of activities) {
    if (a.eventId || a.activityType !== 'event_participation' || a.date.slice(0, 10) > today) continue;
    map.set(a.schoolId, (map.get(a.schoolId) ?? 0) + 1);
  }
  return map;
}

/** Schools with any imported attendance whose day has come, linked to an event or not. */
export function schoolsWithAttendance(
  activities: { schoolId: string; activityType: string; date: string }[],
  today: string
): Set<string> {
  return new Set(activities
    .filter((a) => a.activityType === 'event_participation' && a.date.slice(0, 10) <= today)
    .map((a) => a.schoolId));
}
