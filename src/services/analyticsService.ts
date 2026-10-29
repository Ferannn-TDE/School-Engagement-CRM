import { supabase } from './supabase';

export interface CountyEngagementRow {
  county_name: string | null;
  total_schools: number;
  engaged_schools: number;
  engagement_pct: number;
  state_code: string | null;
}

export interface CountySchoolSummaryRow {
  county_name: string | null;
  total_schools: number;
  verified_schools: number;
  total_contacts: number;
  total_events: number;
  total_programs: number;
  state_code: string | null;
}

export async function fetchCountyEngagementRate(): Promise<CountyEngagementRow[]> {
  const { data, error } = await supabase
    .from('county_engagement_rate')
    .select('*')
    .order('total_schools', { ascending: false });
  if (error) throw error;
  return data as CountyEngagementRow[];
}

export async function fetchCountySchoolSummary(): Promise<CountySchoolSummaryRow[]> {
  const { data, error } = await supabase
    .from('county_school_summary')
    .select('*')
    .order('county_name', { ascending: true });
  if (error) throw error;
  return data as CountySchoolSummaryRow[];
}

// ── Counties page speed ────────────────────────────────────────────────────────
// county_engagement_rate took 3–7 s per request (it matches every school against
// every event with LIKE '%key%'), so the Counties pages compute it from the schools
// and events already loaded instead. county_school_summary is quick but was fetched
// on every visit; it's kept for a short while, prefetched once the app has loaded,
// and refreshed in the background when it's older than that.

const SUMMARY_FRESH_MS = 2 * 60_000;
let summaryCache: { at: number; promise: Promise<CountySchoolSummaryRow[]> } | null = null;
let summaryLatest: CountySchoolSummaryRow[] | null = null;

/** The county summary, from the cache when it's fresh. */
export function getCountySchoolSummary(): Promise<CountySchoolSummaryRow[]> {
  if (!summaryCache || Date.now() - summaryCache.at > SUMMARY_FRESH_MS) {
    const promise = fetchCountySchoolSummary().then((rows) => {
      summaryLatest = rows;
      return rows;
    });
    // A failed fetch isn't kept, so the next visit tries again.
    promise.catch(() => { summaryCache = null; });
    summaryCache = { at: Date.now(), promise };
  }
  return summaryCache.promise;
}

/** The last summary fetched, if any: shown at once while a refresh runs. */
export function peekCountySchoolSummary(): CountySchoolSummaryRow[] | null {
  return summaryLatest;
}

/**
 * The county_engagement_rate view's rows, from loaded data: per county, its schools
 * and those listed on an outreach event (testing dates left out). Schools are matched
 * by exact id, where the view's LIKE could also match a key inside a longer one.
 */
export function engagementRateFromData(
  schools: { id: string; county: string; state: string }[],
  events: { participatingSchools: string[]; category?: string }[],
): CountyEngagementRow[] {
  const listed = new Set<string>();
  for (const e of events) {
    if (e.category === 'school_testing_date') continue;
    for (const id of e.participatingSchools) listed.add(id);
  }
  const rows = new Map<string, CountyEngagementRow>();
  for (const s of schools) {
    const key = `${s.state}|${s.county}`;
    const row = rows.get(key) ?? { county_name: s.county || null, state_code: s.state || null, total_schools: 0, engaged_schools: 0, engagement_pct: 0 };
    row.total_schools++;
    if (listed.has(s.id)) row.engaged_schools++;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, engagement_pct: r.total_schools ? Math.round((r.engaged_schools / r.total_schools) * 1000) / 10 : 0 }))
    .sort((a, b) => a.engagement_pct - b.engagement_pct);
}
