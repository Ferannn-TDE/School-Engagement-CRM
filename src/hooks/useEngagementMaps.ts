import { useMemo } from 'react';
import { format, subMonths, isAfter } from 'date-fns';
import { useAppContext } from '../context/AppContext';

export interface SchoolContactCounts {
  total: number;
  active: number;
}

export interface SchoolActivitySummary {
  count: number;
  latestDate: Date | null;
}

/**
 * Per-school rollups of contacts, activities and event appearances.
 *
 * Both the Reports page and the Priorities page need these, and each is O(n)
 * over its source collection, so they are computed once here rather than
 * duplicated per page.
 */
export function useEngagementMaps() {
  const { state } = useAppContext();

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

  const schoolActivitiesMap = useMemo(() => {
    const map = new Map<string, SchoolActivitySummary>();
    for (const a of state.activities) {
      const entry = map.get(a.schoolId) ?? { count: 0, latestDate: null };
      entry.count++;
      const d = new Date(a.date);
      if (!entry.latestDate || d > entry.latestDate) entry.latestDate = d;
      map.set(a.schoolId, entry);
    }
    return map;
  }, [state.activities]);

  const schoolEventCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of state.events) {
      for (const schoolId of event.participatingSchools) {
        map.set(schoolId, (map.get(schoolId) ?? 0) + 1);
      }
    }
    return map;
  }, [state.events]);

  return { state, schoolContactsMap, schoolActivitiesMap, schoolEventCountMap };
}

export interface SchoolNeedingAttention {
  id: string;
  name: string;
  county: string;
  contactCount: number;
  lastActivity: string;
  issues: string[];
  /** Two or more issues means it has been neglected on more than one front. */
  severity: 'high' | 'medium';
}

/**
 * Schools with no contacts, no logged activity, or nothing in six months.
 *
 * Shared because the Priorities page renders this list and the Reports page
 * still includes it in the exported CSV — one definition keeps the two from
 * drifting apart.
 */
export function useSchoolsNeedingAttention(): SchoolNeedingAttention[] {
  const { state, schoolContactsMap, schoolActivitiesMap } = useEngagementMaps();

  return useMemo(() => {
    const sixMonthsAgo = subMonths(new Date(), 6);
    return state.schools
      .map((school) => {
        const contacts = schoolContactsMap.get(school.id) ?? { total: 0, active: 0 };
        const acts = schoolActivitiesMap.get(school.id);
        const issues: string[] = [];
        if (contacts.total === 0) issues.push('No contacts');
        else if (contacts.active === 0) issues.push('No active contacts');
        if (!acts) issues.push('No activity recorded');
        else if (acts.latestDate && !isAfter(acts.latestDate, sixMonthsAgo))
          issues.push('No activity in 6+ months');
        return {
          id: school.id,
          name: school.name,
          county: school.county,
          contactCount: contacts.total,
          lastActivity: acts?.latestDate ? format(acts.latestDate, 'MMM d, yyyy') : 'Never',
          issues,
          severity: (issues.length >= 2 ? 'high' : 'medium') as 'high' | 'medium',
        };
      })
      .filter((s) => s.issues.length > 0);
  }, [state.schools, schoolContactsMap, schoolActivitiesMap]);
}
