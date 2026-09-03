import { useMemo } from 'react';
import { useEngagementMaps } from './useEngagementMaps';
import { ProgramCategory } from '../types';
import type { CountyEngagementRow } from '../services/analyticsService';

export interface ProgramCoverageEntry {
  county: string;
  fullCounty: string;
  total: number;
  [key: string]: string | number;
}

/**
 * County-level rollups for the Counties page.
 *
 * Each falls back to computing from local state when the Supabase view has
 * not loaded, so the page still renders something useful offline.
 */
export function useCountyAnalytics(countyEngagement: CountyEngagementRow[]) {
  const { state, schoolContactsMap, schoolEventCountMap } = useEngagementMaps();

  // ── Engagement rate by county — sorted worst first ───────────────────────────
  const engagementRateByCounty = useMemo(() => {
    if (countyEngagement.length > 0) {
      return countyEngagement
        .filter((r) => r.total_schools >= 2 && r.county_name && r.county_name.trim() !== '')
        .map((r) => ({
          county: r.county_name,
          total: r.total_schools,
          engaged: r.engaged_schools,
          rate: r.total_schools > 0 ? r.engaged_schools / r.total_schools : 0,
          label: 'at event',
        }))
        .sort((a, b) => a.rate - b.rate)
        .slice(0, 14);
    }
    const countyMap = new Map<string, { total: number; engaged: number }>();
    for (const s of state.schools) {
      if (!s.county || !s.county.trim()) continue;
      const entry = countyMap.get(s.county) ?? { total: 0, engaged: 0 };
      entry.total++;
      if ((schoolContactsMap.get(s.id)?.total ?? 0) > 0) entry.engaged++;
      countyMap.set(s.county, entry);
    }
    return Array.from(countyMap.entries())
      .map(([county, { total, engaged }]) => ({
        county, total, engaged,
        rate: total > 0 ? engaged / total : 0,
        label: 'with contacts',
      }))
      .filter((c) => c.total >= 2)
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 14);
  }, [countyEngagement, state.schools, schoolContactsMap]);


  // ── County comparison ────────────────────────────────────────────────────────
  const countyComparisonData = useMemo(() => {
    if (countyEngagement.length > 0) {
      return countyEngagement
        .filter((r): r is typeof r & { county_name: string } => Boolean(r.county_name) && r.county_name!.trim() !== '')
        .map((r) => ({
          county: r.county_name.length > 12 ? r.county_name.slice(0, 10) + '…' : r.county_name,
          fullCounty: r.county_name,
          total: r.total_schools,
          engaged: r.engaged_schools,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 12);
    }
    const countyMap = new Map<string, { total: number; engaged: number }>();
    for (const s of state.schools) {
      if (!s.county || !s.county.trim()) continue;
      const entry = countyMap.get(s.county) ?? { total: 0, engaged: 0 };
      entry.total++;
      if ((schoolEventCountMap.get(s.id) ?? 0) > 0) entry.engaged++;
      countyMap.set(s.county, entry);
    }
    return Array.from(countyMap.entries())
      .map(([county, { total, engaged }]) => ({
        county: county.length > 12 ? county.slice(0, 10) + '…' : county,
        fullCounty: county,
        total,
        engaged,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [countyEngagement, state.schools, schoolEventCountMap]);

  // ── Program Coverage by County ───────────────────────────────────────────────
  const programCoverageByCounty = useMemo((): ProgramCoverageEntry[] => {
    const schoolCountyMap = new Map(state.schools.map((s) => [s.id, s.county]));
    const countyProgramMap = new Map<string, Map<ProgramCategory, number>>();
    for (const p of state.programs) {
      const county = schoolCountyMap.get(p.schoolId);
      if (!county || !county.trim()) continue;
      if (!countyProgramMap.has(county)) countyProgramMap.set(county, new Map());
      const catMap = countyProgramMap.get(county)!;
      catMap.set(p.category, (catMap.get(p.category) ?? 0) + 1);
    }
    return Array.from(countyProgramMap.entries())
      .map(([county, catMap]) => {
        const entry: ProgramCoverageEntry = {
          county: county.length > 12 ? county.slice(0, 10) + '…' : county,
          fullCounty: county,
          total: 0,
        };
        for (const cat of Object.values(ProgramCategory)) {
          const count = catMap.get(cat) ?? 0;
          entry[cat] = count;
          entry.total += count;
        }
        return entry;
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [state.programs, state.schools]);


  return { engagementRateByCounty, countyComparisonData, programCoverageByCounty };
}
