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
