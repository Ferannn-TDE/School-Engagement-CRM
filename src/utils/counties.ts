// 40 county names exist in both Illinois and Missouri, so a county is only
// identified by its name together with its state.

/**
 * Illinois' school list files state-run schools (youth centers, the School for
 * the Deaf, ...) under two labels that are not counties. They are shown together
 * as one group, "State-run schools, IL". Display only: stored names are unchanged.
 */
export const STATE_RUN_GROUP = 'State-run schools';
const STATE_RUN_LABELS = new Set(['dept of corrections', 'state of illinois']);

export function isStateRunGroup(name: string): boolean {
  return name === STATE_RUN_GROUP || STATE_RUN_LABELS.has(name.trim().toLowerCase());
}

/** The name a stored county label is grouped and shown under. */
export function countyGroupName(name: string): string {
  return isStateRunGroup(name) ? STATE_RUN_GROUP : name;
}

export function countyKey(name: string, state: string | null | undefined): string {
  return `${state ?? ''}|${countyGroupName(name)}`;
}

/**
 * An independent city: a city that belongs to no county and is listed in the
 * county's place. The data has one, St. Louis City in Missouri.
 */
export function isIndependentCity(name: string): boolean {
  return /\bcity$/i.test(name.trim());
}

/** How a county name is shown. Display only; stored names are unchanged. */
export function countyDisplayName(name: string): string {
  if (isStateRunGroup(name)) return STATE_RUN_GROUP;
  return isIndependentCity(name) ? name.replace(/^St /, 'St. ') : name;
}

/** "Madison County, IL"; "St. Louis City, MO" for an independent city; "State-run schools, IL". */
export function countyLabel(name: string, state: string | null | undefined): string {
  const place =
    isIndependentCity(name) || isStateRunGroup(name) ? countyDisplayName(name) : `${name} County`;
  return state ? `${place}, ${state}` : place;
}

/** Short form for chart axes and dropdowns: "Madison, IL". */
export function countyShortLabel(name: string, state: string | null | undefined): string {
  const display = countyDisplayName(name);
  return state ? `${display}, ${state}` : display;
}

export function countyPath(name: string, state: string | null | undefined): string {
  const group = countyGroupName(name);
  return state
    ? `/counties/${encodeURIComponent(state)}/${encodeURIComponent(group)}`
    : `/counties/${encodeURIComponent(group)}`;
}

/** Whether a stored county label belongs to the named county or group. */
export function sameCounty(storedName: string, groupName: string): boolean {
  return countyGroupName(storedName) === countyGroupName(groupName);
}

/**
 * Combines view rows that belong to the same county or group (the state-run
 * labels arrive as two rows). Counts are added; percentages are recalculated.
 */
export function mergeCountyRows<
  T extends { county_name: string | null; state_code: string | null; total_schools: number }
>(rows: T[]): T[] {
  const merged = new Map<string, T>();
  for (const row of rows) {
    if (!row.county_name) {
      merged.set(`\u0000${merged.size}`, row);
      continue;
    }
    const key = countyKey(row.county_name, row.state_code);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, county_name: countyGroupName(row.county_name) });
      continue;
    }
    const sum = { ...existing } as Record<string, unknown>;
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number' && k !== 'engagement_pct') sum[k] = ((sum[k] as number) ?? 0) + v;
    }
    if ('engagement_pct' in sum && 'engaged_schools' in sum) {
      const total = sum.total_schools as number;
      sum.engagement_pct = total > 0 ? Math.round(((sum.engaged_schools as number) / total) * 1000) / 10 : 0;
    }
    merged.set(key, sum as T);
  }
  return [...merged.values()];
}

/** Dropdown options for every county among these schools, each tied to its state:
 *  value "Madison|IL", label "Madison, IL". */
export function countyOptions(schools: { county: string; state: string }[]): { value: string; label: string }[] {
  const seen = new Map<string, { value: string; label: string }>();
  for (const s of schools) {
    if (!s.county) continue;
    const value = `${countyGroupName(s.county)}|${s.state}`;
    if (!seen.has(value)) seen.set(value, { value, label: countyShortLabel(s.county, s.state) });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a school is in the county chosen from countyOptions. A bare name (older
 *  addresses such as ?county=Cook) matches that name in either state. */
export function inCounty(school: { county: string; state: string }, choice: string): boolean {
  const [name, state] = choice.split('|');
  return sameCounty(school.county, name) && (!state || school.state === state);
}

/** "Madison, IL" for a countyOptions value, or the bare name for older addresses. */
export function countyChoiceLabel(choice: string): string {
  const [name, state] = choice.split('|');
  return countyShortLabel(name, state);
}
