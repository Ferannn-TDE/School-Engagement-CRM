import { useMemo } from 'react';
import { useAppContext } from '../context/useAppContext';
import { attendanceByEvent, outreachEvents, schoolsAtEvent, unlinkedAttendance } from '../utils/events';
import { todayDay } from '../utils/activityDates';

export interface SchoolContactCounts {
  total: number;
  active: number;
}

/**
 * Per-school rollups of contacts and event appearances, for the county analytics.
 * (Priorities uses utils/priorities.ts; Reports has its own tested calculations,
 * utils/reports.ts.)
 */
export function useEngagementMaps() {
  const { state } = useAppContext();
  // Testing dates are busy dates, not outreach: never counted (db/007).
  const countedEvents = useMemo(() => outreachEvents(state.events), [state.events]);

  const schoolContactsMap = useMemo(() => {
    const map = new Map<string, SchoolContactCounts>();
    for (const c of state.contacts) {
      const entry = map.get(c.schoolId) ?? { total: 0, active: 0 };
      entry.total++;
      if (c.isActive) entry.active++;
      map.set(c.schoolId, entry);
    }
    return map;
  }, [state.contacts]);

  // Events per school: listed on the event, or imported attendance (linked to an event
  // or not: an unlinked attendance row counts as one event).
  const schoolEventCountMap = useMemo(() => {
    const attendance = attendanceByEvent(state.activities, todayDay());
    const map = new Map<string, number>(unlinkedAttendance(state.activities, todayDay()));
    for (const event of countedEvents) {
      for (const schoolId of schoolsAtEvent(event, attendance)) {
        map.set(schoolId, (map.get(schoolId) ?? 0) + 1);
      }
    }
    return map;
  }, [countedEvents, state.activities]);

  return { state, schoolContactsMap, schoolEventCountMap };
}
