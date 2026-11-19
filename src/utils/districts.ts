// Matching a district name from a file (or typed) to the district table. The name must
// match exactly, ignoring case and spacing, within the school's state. Nothing is ever
// created: an unknown or ambiguous name is reported, and the school is saved without one.

export interface DistrictOption {
  id: number;
  name: string;
  /** state_code, '' when unknown. */
  state: string;
}

export type DistrictMatch =
  | { kind: 'matched'; id: number; name: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'blank' };

export function normalizeDistrict(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchDistrict(name: string | undefined, state: string | undefined, districts: DistrictOption[]): DistrictMatch {
  const key = normalizeDistrict(name ?? '');
  if (!key) return { kind: 'blank' };
  const st = (state ?? '').trim().toUpperCase();
  const hits = districts.filter((d) => normalizeDistrict(d.name) === key && (!st || !d.state || d.state === st));
  if (hits.length === 1) return { kind: 'matched', id: hits[0].id, name: hits[0].name };
  if (hits.length === 0) return { kind: 'none' };
  return { kind: 'ambiguous', count: hits.length };
}

/** What the import preview says about a name it couldn't use. */
export function districtProblem(m: DistrictMatch): string | null {
  if (m.kind === 'none') return 'District not found: saved without a district';
  if (m.kind === 'ambiguous') return `Matches ${m.count} districts: saved without a district`;
  return null;
}
