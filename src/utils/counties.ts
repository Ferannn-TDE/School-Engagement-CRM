// 40 county names exist in both Illinois and Missouri, so a county is only
// identified by its name together with its state.

export function countyKey(name: string, state: string | null | undefined): string {
  return `${state ?? ''}|${name}`;
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
  return isIndependentCity(name) ? name.replace(/^St /, 'St. ') : name;
}

/** "Madison County, IL", or "St. Louis City, MO" for an independent city. */
export function countyLabel(name: string, state: string | null | undefined): string {
  const place = isIndependentCity(name) ? countyDisplayName(name) : `${name} County`;
  return state ? `${place}, ${state}` : place;
}

/** Short form for chart axes and dropdowns: "Madison, IL". */
export function countyShortLabel(name: string, state: string | null | undefined): string {
  const display = countyDisplayName(name);
  return state ? `${display}, ${state}` : display;
}

export function countyPath(name: string, state: string | null | undefined): string {
  return state
    ? `/counties/${encodeURIComponent(state)}/${encodeURIComponent(name)}`
    : `/counties/${encodeURIComponent(name)}`;
}

/** Dropdown options for every county among these schools, each tied to its state:
 *  value "Madison|IL", label "Madison, IL". */
export function countyOptions(schools: { county: string; state: string }[]): { value: string; label: string }[] {
  const seen = new Map<string, { value: string; label: string }>();
  for (const s of schools) {
    if (!s.county) continue;
    const value = `${s.county}|${s.state}`;
    if (!seen.has(value)) seen.set(value, { value, label: countyShortLabel(s.county, s.state) });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Whether a school is in the county chosen from countyOptions. A bare name (older
 *  addresses such as ?county=Cook) matches that name in either state. */
export function inCounty(school: { county: string; state: string }, choice: string): boolean {
  const [name, state] = choice.split('|');
  return school.county === name && (!state || school.state === state);
}

/** "Madison, IL" for a countyOptions value, or the bare name for older addresses. */
export function countyChoiceLabel(choice: string): string {
  const [name, state] = choice.split('|');
  return countyShortLabel(name, state);
}
