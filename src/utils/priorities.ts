// The Priorities page: three worklists that never overlap, and the county gaps.
// Pure functions of the loaded data and "today", like utils/reports.ts, so
// scripts/verify-reports.ts can check them against a fixture.
//
// A school goes in the first list that fits, in this order:
//   1. Recently in touch — any activity (visit, call, email, event attendance, other)
//      in the last RECENT_CONTACT_DAYS days. Oldest contact first: those are about to
//      fall out of the window.
//   2. Has contacts but never reached out — an active contact, nothing ever logged.
//   3. No contact person on file — no active contact.
// A school whose last activity is older than the window is on no list. Upcoming
// (future-dated) activities never count.

import type { ActivityRecord, Contact, Event, School } from '../types';
import { RECENT_CONTACT_DAYS } from '../constants/reportSettings';
import { addDays, dayOf, daysBetween, type Day } from './reports';
import { isTestingDate } from './events';

export interface RecentItem {
  schoolId: string;
  /** The last activity: its day, type (and the Other text, when there is one). */
  lastDay: Day;
  lastType: string;
  lastTypeOther?: string;
  /** Days until it falls out of the window (0 = last day). */
  daysLeft: number;
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
  recent: RecentItem[];
  neverReached: NeverReachedItem[];
  noContact: NoContactItem[];
  /** The first day of the window (today minus RECENT_CONTACT_DAYS). */
  windowFrom: Day;
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
  const active = new Map<string, number>();
  for (const c of contacts) if (c.isActive) active.set(c.schoolId, (active.get(c.schoolId) ?? 0) + 1);

  // Each school's latest activity whose day has come.
  const last = new Map<string, { day: Day; type: string; other?: string }>();
  for (const a of activities) {
    const d = dayOf(a.date);
    if (d > today) continue;
    const seen = last.get(a.schoolId);
    if (!seen || d > seen.day) last.set(a.schoolId, { day: d, type: a.activityType, other: a.activityTypeOther });
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
  const windowFrom = addDays(today, -RECENT_CONTACT_DAYS);

  const recent: RecentItem[] = [];
  for (const s of schools) {
    const l = last.get(s.id);
    if (!l || l.day < windowFrom) continue;
    recent.push({ schoolId: s.id, lastDay: l.day, lastType: l.type, lastTypeOther: l.other, daysLeft: RECENT_CONTACT_DAYS - daysBetween(l.day, today) });
    placed.add(s.id);
  }
  // Oldest contact first, then name.
  recent.sort((a, b) => (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : nameOrder(byId, a.schoolId, b.schoolId)));

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
    noContact.push({ schoolId: s.id, lastDay: last.get(s.id)?.day });
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

  return { recent, neverReached, noContact, windowFrom };
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
