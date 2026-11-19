// The Meeting summary page: one term on one or two printed pages. Every number comes
// from the same tested calculations as the Reports page (reportSnapshot and friends) and
// Priorities (priorityLists), so the two pages always agree; scripts/verify-reports.ts
// checks that. No visitor names (db/029) are ever part of it.

import type { ActivityRecord, Contact, Event, School } from '../types';
import {
  activitiesUpTo, activitySummary, eventImpact, gaps, reportSnapshot, type Day, type DayRange,
} from './reports';
import { priorityLists } from './priorities';

export interface MeetingSummary {
  headline: { schools: number; reached: number; firstTime: number; activities: number; visitors: number };
  /** Activities by type, most first. */
  mix: { type: string; count: number }[];
  events: { past: number; upcoming: number; withAttendance: number; visitorsAtEvents: number };
  followUps: {
    schools: number;
    followed: number;
    /** Per event, most schools first (as Reports ranks them). */
    byEvent: { eventId: string; day: Day; schools: number; followed: number; visitors: number; windowOpen: boolean }[];
  };
  gaps: {
    neverContacted: number;
    quiet: number;
    untouchedCounties: number;
    /** The counties with the lowest share of schools ever contacted. */
    lowestCounties: { county: string; state: string; schools: number; contacted: number }[];
  };
  priorities: { recentlyInTouch: number; neverReached: number; noContactPerson: number };
}

export function meetingSummary(
  data: { schools: School[]; contacts: Contact[]; events: Event[]; activities: ActivityRecord[] },
  range: DayRange,
  today: Day
): MeetingSummary {
  const snap = reportSnapshot(data, range, today);
  const done = activitiesUpTo(data.activities, today);
  const act = activitySummary(done, data.schools, range);
  const impact = eventImpact(data.events, done, data.schools, range, today);
  const g = gaps(data.schools, done, range.end);
  const p = priorityLists(data.schools, data.contacts, data.activities, data.events, today);
  return {
    headline: {
      schools: snap['schools.total'], reached: snap['reach.engaged'], firstTime: snap['reach.first_time'],
      activities: snap['activity.total'], visitors: snap['activity.visitors'],
    },
    mix: Object.entries(act.byType).map(([type, ids]) => ({ type, count: ids.length })).sort((a, b) => b.count - a.count),
    events: {
      past: snap['events.past'], upcoming: snap['events.upcoming'],
      withAttendance: snap['impact.events'], visitorsAtEvents: snap['impact.visitors'],
    },
    followUps: {
      schools: snap['impact.schools'], followed: snap['impact.followed'],
      byEvent: impact.map((x) => ({ eventId: x.eventId, day: x.day, schools: x.schoolIds.length, followed: x.followedIds.length, visitors: x.visitors, windowOpen: x.windowOpen })),
    },
    gaps: {
      neverContacted: snap['gaps.never'], quiet: snap['gaps.quiet'], untouchedCounties: snap['gaps.untouched_counties'],
      lowestCounties: g.byCounty.slice(0, 6).map((c) => ({ county: c.county, state: c.state, schools: c.schoolIds.length, contacted: c.contactedIds.length })),
    },
    priorities: { recentlyInTouch: p.recent.length, neverReached: p.neverReached.length, noContactPerson: p.noContact.length },
  };
}
