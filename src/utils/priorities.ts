// The Priorities page: four worklists that never overlap, and the county gaps.
// Pure functions of the loaded data and "today", like utils/reports.ts, so
// scripts/verify-reports.ts can check them against a fixture.
//
// A school goes in the first list that fits, in this order:
//   1. Follow up after an event — attended an event (imported attendance) in the last
//      FOLLOW_UP_DAYS days, with no call, email or visit since.
//   2. Gone quiet — had activity, but none in QUIET_MONTHS months.
//   3. Has contacts but never reached out — an active contact, nothing ever logged.
//   4. No contact person on file — no active contact.
// Everything else (contacted recently) is on no list. Upcoming (future-dated)
// activities don't count; the caller passes only activities whose day has come.

import type { ActivityRecord, Contact, Event, School } from '../types';
import { FOLLOW_UP_DAYS, QUIET_MONTHS, EVENT_ATTENDANCE_TYPE } from '../constants/reportSettings';
import { addMonths, dayOf, daysBetween, type Day } from './reports';
import { isTestingDate } from './events';

export interface FollowUpItem {
  schoolId: string;
  /** The latest attended event's day and id (the window runs from it). */
  eventDay: Day;
  eventId?: string;
  /** The attendance row's description: names the event when the import linked none. */
  description?: string;
  /** Days left in the follow-up window (0 = last day). */
  daysLeft: number;
}

export interface QuietItem {
  schoolId: string;
  lastDay: Day;
}

export interface NeverReachedItem {
  schoolId: string;
  activeContacts: number;
  /** The soonest upcoming outreach event the school is listed on, if any. */
  upcoming?: { eventId: string; day: Day };
}

export interface NoContactItem {
  schoolId: string;
  /** The school's last activity, when something was logged without a named person. */
  lastDay?: Day;
}

export interface PriorityLists {
  followUp: FollowUpItem[];
  quiet: QuietItem[];
  neverReached: NeverReachedItem[];
  noContact: NoContactItem[];
  /** The day before which a last activity counts as quiet. */
  quietBefore: Day;
}

const TIER_ORDER: Record<string, number> = { high: 0, standard: 1, low: 2 };
const tier = (s: School) => TIER_ORDER[s.priorityTier ?? 'standard'] ?? 1;

export function priorityLists(
  schools: School[],
  contacts: Contact[],
  activities: ActivityRecord[],
  events: Event[],
  today: Day
): PriorityLists {
  const done = activities.filter((a) => dayOf(a.date) <= today);
  const active = new Map<string, number>();
  for (const c of contacts) if (c.isActive) active.set(c.schoolId, (active.get(c.schoolId) ?? 0) + 1);

  const last = new Map<string, Day>();
  const lastAttended = new Map<string, { day: Day; eventId?: string; description?: string }>();
  for (const a of done) {
    const d = dayOf(a.date);
    if (!last.has(a.schoolId) || d > last.get(a.schoolId)!) last.set(a.schoolId, d);
    if (a.activityType === EVENT_ATTENDANCE_TYPE) {
      const seen = lastAttended.get(a.schoolId);
      if (!seen || d > seen.day) lastAttended.set(a.schoolId, { day: d, eventId: a.eventId, description: a.description || undefined });
    }
  }
  // The latest call, email or visit (anything but attendance), per school.
  const lastOutreach = new Map<string, Day>();
  for (const a of done) {
    if (a.activityType === EVENT_ATTENDANCE_TYPE) continue;
    const d = dayOf(a.date);
    if (!lastOutreach.has(a.schoolId) || d > lastOutreach.get(a.schoolId)!) lastOutreach.set(a.schoolId, d);
  }

  const upcoming = new Map<string, { eventId: string; day: Day }>();
  for (const e of events) {
    if (isTestingDate(e)) continue;
    const d = dayOf(e.date);
    if (d < today) continue;
    for (const id of e.participatingSchools) {
      const seen = upcoming.get(id);
      if (!seen || d < seen.day) upcoming.set(id, { eventId: e.id, day: d });
    }
  }

  const byId = new Map(schools.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const quietBefore = addMonths(today, -QUIET_MONTHS);

  const followUp: FollowUpItem[] = [];
  for (const s of schools) {
    const att = lastAttended.get(s.id);
    if (!att) continue;
    const since = daysBetween(att.day, today);
    if (since > FOLLOW_UP_DAYS) continue;
    const out = lastOutreach.get(s.id);
    if (out && out > att.day) continue;
    followUp.push({ schoolId: s.id, eventDay: att.day, eventId: att.eventId, description: att.description, daysLeft: FOLLOW_UP_DAYS - since });
    placed.add(s.id);
  }
  followUp.sort((a, b) => a.daysLeft - b.daysLeft || nameOrder(byId, a.schoolId, b.schoolId));

  const quiet: QuietItem[] = [];
  for (const s of schools) {
    if (placed.has(s.id)) continue;
    const d = last.get(s.id);
    if (d && d < quietBefore) {
      quiet.push({ schoolId: s.id, lastDay: d });
      placed.add(s.id);
    }
  }
  quiet.sort((a, b) => (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : nameOrder(byId, a.schoolId, b.schoolId)));

  const neverReached: NeverReachedItem[] = [];
  for (const s of schools) {
    if (placed.has(s.id) || last.has(s.id)) continue;
    const n = active.get(s.id) ?? 0;
    if (n === 0) continue;
    neverReached.push({ schoolId: s.id, activeContacts: n, upcoming: upcoming.get(s.id) });
    placed.add(s.id);
  }
  // On an upcoming event first (soonest first), then priority tier, then name.
  neverReached.sort((a, b) => {
    if (!!a.upcoming !== !!b.upcoming) return a.upcoming ? -1 : 1;
    if (a.upcoming && b.upcoming && a.upcoming.day !== b.upcoming.day) return a.upcoming.day < b.upcoming.day ? -1 : 1;
    return tier(byId.get(a.schoolId)!) - tier(byId.get(b.schoolId)!) || nameOrder(byId, a.schoolId, b.schoolId);
  });

  const noContact: NoContactItem[] = [];
  for (const s of schools) {
    if (placed.has(s.id)) continue;
    if ((active.get(s.id) ?? 0) > 0) continue;
    noContact.push({ schoolId: s.id, lastDay: last.get(s.id) });
    placed.add(s.id);
  }
  // Someone is already talking to them first (latest first), then priority tier, then a
  // working website (its staff page can name someone), then name.
  noContact.sort((a, b) => {
    if (!!a.lastDay !== !!b.lastDay) return a.lastDay ? -1 : 1;
    if (a.lastDay && b.lastDay && a.lastDay !== b.lastDay) return a.lastDay > b.lastDay ? -1 : 1;
    const sa = byId.get(a.schoolId)!, sb = byId.get(b.schoolId)!;
    const wa = sa.sourceStatus === 'working' ? 0 : 1, wb = sb.sourceStatus === 'working' ? 0 : 1;
    return tier(sa) - tier(sb) || wa - wb || sa.name.localeCompare(sb.name);
  });

  return { followUp, quiet, neverReached, noContact, quietBefore };
}

function nameOrder(byId: Map<string, School>, a: string, b: string): number {
  return (byId.get(a)?.name ?? a).localeCompare(byId.get(b)?.name ?? b);
}

export interface CountyGap {
  county: string;
  state: string;
  total: number;
  /** Schools with at least one active contact on file. */
  withContact: number;
  /** Schools with no activity ever logged (upcoming activities don't count). */
  neverContacted: number;
}

/**
 * Counties with 2+ schools and at least one school with no contact person, the most
 * such schools first. `countyKeyOf` and `countyNameOf` group as the Counties pages do.
 */
export function countyGaps(
  schools: School[],
  contacts: Contact[],
  activities: ActivityRecord[],
  today: Day,
  countyKeyOf: (s: School) => string,
  countyNameOf: (s: School) => string
): CountyGap[] {
  const active = new Set(contacts.filter((c) => c.isActive).map((c) => c.schoolId));
  const logged = new Set(activities.filter((a) => dayOf(a.date) <= today).map((a) => a.schoolId));
  const map = new Map<string, CountyGap>();
  for (const s of schools) {
    if (!s.county?.trim()) continue;
    const key = countyKeyOf(s);
    const g = map.get(key) ?? { county: countyNameOf(s), state: s.state, total: 0, withContact: 0, neverContacted: 0 };
    g.total++;
    if (active.has(s.id)) g.withContact++;
    if (!logged.has(s.id)) g.neverContacted++;
    map.set(key, g);
  }
  return [...map.values()]
    .filter((g) => g.total >= 2 && g.total > g.withContact)
    .sort((a, b) => (b.total - b.withContact) - (a.total - a.withContact) || b.neverContacted - a.neverContacted
      || (a.state + a.county).localeCompare(b.state + b.county));
}
