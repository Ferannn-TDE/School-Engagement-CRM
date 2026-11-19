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
 * Every school on an event, each once: its host school (events.schools_involved, the
 * school whose calendar listed it) plus the live event_schools rows (db/031). An archived
 * event has none. The app only loads events that aren't archived and event_schools rows
 * that aren't archived (eventsService.fetchEvents), so this is the whole rule. Every
 * count or list of an event's schools goes through here; verify:event-schools checks
 * nothing else reads participatingSchools or hostSchoolId for that.
 */
export function eventSchoolIds(event: Pick<Event, 'participatingSchools' | 'hostSchoolId'> & { archived?: boolean }): string[] {
  if (event.archived) return [];
  return [...new Set([...(event.hostSchoolId ? [event.hostSchoolId] : []), ...event.participatingSchools])];
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
  if (event.source === 'import') return 'Added from an import';
  return 'Added in the app';
}

export const EVENT_SOURCE_OPTIONS = [
  { value: 'iacac', label: 'IACAC college fairs' },
  { value: 'school_calendar', label: 'School calendars' },
  { value: 'manual', label: 'Added in the app' },
  { value: 'import', label: 'Added from an import' },
];

// Words that don't tell two event names apart.
const FILLER = new Set(['the', 'and', 'of', 'at', 'for', 'a', 'an', 'in', 'on', 'to', 'with', 'event', 'night', 'day']);

/** An event name's telling words: lower case, no punctuation, years and filler left out. */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w) && !/^(19|20)\d\d$/.test(w));
}

/**
 * Events whose names are close to `name`, nearest to `nearDay` first: the same telling
 * words, one name's words all inside the other's, or more than half of them shared.
 * Used to warn before a new event is made from an import.
 */
export function similarEvents(name: string, events: Event[], nearDay: string, limit = 3): Event[] {
  const words = new Set(nameWords(name));
  if (!words.size) return [];
  const anchor = new Date(`${nearDay || new Date().toISOString().slice(0, 10)}T12:00:00`).getTime();
  return events
    .filter((e) => !isTestingDate(e))
    .map((e) => {
      const other = new Set(nameWords(e.name));
      if (!other.size) return null;
      const shared = [...words].filter((w) => other.has(w)).length;
      const inside = shared === Math.min(words.size, other.size);
      const overlap = shared / Math.max(words.size, other.size);
      return inside || overlap > 0.5 ? { e, overlap, inside } : null;
    })
    .filter((x): x is { e: Event; overlap: number; inside: boolean } => x !== null)
    .sort((a, b) =>
      Math.abs(new Date(`${a.e.date.slice(0, 10)}T12:00:00`).getTime() - anchor)
      - Math.abs(new Date(`${b.e.date.slice(0, 10)}T12:00:00`).getTime() - anchor)
      || b.overlap - a.overlap)
    .slice(0, limit)
    .map((x) => x.e);
}

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
export function schoolsAtEvent(event: Pick<Event, 'id' | 'participatingSchools' | 'hostSchoolId'>, attendance: Map<string, Set<string>>): string[] {
  const attended = attendance.get(event.id);
  const listed = eventSchoolIds(event);
  if (!attended?.size) return listed;
  return [...new Set([...listed, ...attended])];
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
