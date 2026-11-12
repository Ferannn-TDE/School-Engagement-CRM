
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

// The two county views (county_engagement_rate, county_school_summary) are no longer
// read by the app: they count differently from it (contacts only through the link
// table, events only by their school list, and the engagement view took 3–7 s), so
// the Counties pages work everything out from the data already loaded, below. The
// views stay in the database; see db/README.md before using them for counts.

/**
 * The county_engagement_rate view's rows, from loaded data: per county, its schools
 * and those at an outreach event (testing dates left out): listed on it, or with any
 * imported attendance (pass `attended`, from utils/events schoolsWithAttendance). Schools are matched
 * by exact id, where the view's LIKE could also match a key inside a longer one.
 */
export function engagementRateFromData(
  schools: { id: string; county: string; state: string }[],
  events: { participatingSchools: string[]; category?: string }[],
  attended: Set<string> = new Set(),
): CountyEngagementRow[] {
  const listed = new Set<string>(attended);
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

export interface CountySummaryRow extends CountySchoolSummaryRow {
  /** Everyone on file at the county's schools, active or not (total_contacts is active only). */
  contacts_on_file: number;
}

/**
 * The county_school_summary view's figures, from loaded data, so the Counties pages
 * agree with every other page. The view counts staff only through the contacts link
 * table (so it misses people placed by staff.school_worked_at: 3,217 against 4,625 on
 * 2026-11-12) and counts events only by their school list. Here:
 *   * total_contacts: active people at the county's schools, placed as contactsService
 *     places them (link row, else school_worked_at); contacts_on_file: all of them;
 *   * total_events: outreach events with a county school listed or attending (imported
 *     attendance), plus attendance imports with no event linked, one per import;
 *   * total_programs: the programs on file at the county's schools.
 * Rows are keyed by county and state like the view, for mergeCountyRows.
 */
export function countySummaryFromData(
  schools: { id: string; county: string; state: string; isVerified?: boolean }[],
  contacts: { schoolId: string; isActive: boolean }[],
  events: { id: string; participatingSchools: string[]; category?: string }[],
  activities: { id: string; schoolId: string; eventId?: string; activityType: string; date: string; importBatchId?: string }[],
  programs: { schoolId: string }[],
  today: string,
): CountySummaryRow[] {
  const keyOf = new Map<string, string>();
  const rows = new Map<string, CountySummaryRow & { eventKeys: Set<string> }>();
  for (const s of schools) {
    const key = `${s.state}|${s.county}`;
    keyOf.set(s.id, key);
    const row = rows.get(key) ?? {
      county_name: s.county || null, state_code: s.state || null, total_schools: 0, verified_schools: 0,
      total_contacts: 0, contacts_on_file: 0, total_events: 0, total_programs: 0, eventKeys: new Set<string>(),
    };
    row.total_schools++;
    if (s.isVerified) row.verified_schools++;
    rows.set(key, row);
  }
  const rowOf = (schoolId: string) => { const k = keyOf.get(schoolId); return k ? rows.get(k) : undefined; };
  for (const c of contacts) {
    const row = rowOf(c.schoolId);
    if (!row) continue;
    row.contacts_on_file++;
    if (c.isActive) row.total_contacts++;
  }
  for (const p of programs) { const row = rowOf(p.schoolId); if (row) row.total_programs++; }
  for (const e of events) {
    if (e.category === 'school_testing_date') continue;
    for (const id of e.participatingSchools) rowOf(id)?.eventKeys.add(`e:${e.id}`);
  }
  for (const a of activities) {
    if (a.activityType !== 'event_participation' || a.date.slice(0, 10) > today) continue;
    rowOf(a.schoolId)?.eventKeys.add(a.eventId ? `e:${a.eventId}` : `import:${a.importBatchId ?? a.id}`);
  }
  return [...rows.values()].map(({ eventKeys, ...row }) => ({ ...row, total_events: eventKeys.size }));
}
