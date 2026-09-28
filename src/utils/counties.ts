// 40 county names exist in both Illinois and Missouri, so a county is only
// identified by its name together with its state.

export function countyKey(name: string, state: string | null | undefined): string {
  return `${state ?? ''}|${name}`;
}

/** "Madison County, IL". */
export function countyLabel(name: string, state: string | null | undefined): string {
  return state ? `${name} County, ${state}` : `${name} County`;
}

/** Short form for chart axes: "Madison, IL". */
export function countyShortLabel(name: string, state: string | null | undefined): string {
  return state ? `${name}, ${state}` : name;
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
