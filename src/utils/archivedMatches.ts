// Import rows that match archived records (db/009). An import must never quietly
// update an archived record and leave it hidden, nor quietly restore it: the
// preview lists every match and the person chooses, per record, to restore it or
// skip the rows that match it.

export interface ArchivedLookup {
  schools: { id: string; name: string }[];
  contacts: { id: string; name: string; email: string }[];
}

export type ArchivedDecision = 'restore' | 'skip';

export interface ArchivedMatch {
  /** "school:<facility_key>" or "contact:<staff_id>" */
  key: string;
  kind: 'school' | 'contact';
  id: string;
  label: string;
  /** Labels of the file rows that match, e.g. "Schools row 3". */
  rows: string[];
}

export interface ImportRowRef {
  /** How the row is named in the preview, e.g. "Row 4" or "Contacts row 2". */
  label: string;
  /** The school the row is (schools sheet) or belongs to (contacts). */
  schoolName?: string;
  email?: string;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Every archived record the rows match, with the rows that match each. */
export function findArchivedMatches(lookup: ArchivedLookup, rows: ImportRowRef[]): ArchivedMatch[] {
  const schools = new Map(lookup.schools.map((s) => [norm(s.name), s]));
  const contacts = new Map(lookup.contacts.filter((c) => c.email).map((c) => [norm(c.email), c]));
  const matches = new Map<string, ArchivedMatch>();
  const add = (kind: 'school' | 'contact', id: string, label: string, row: string) => {
    const key = `${kind}:${id}`;
    const m = matches.get(key) ?? { key, kind, id, label, rows: [] };
    if (!m.rows.includes(row)) m.rows.push(row);
    matches.set(key, m);
  };
  for (const row of rows) {
    const school = row.schoolName ? schools.get(norm(row.schoolName)) : undefined;
    if (school) add('school', school.id, school.name, row.label);
    const contact = row.email ? contacts.get(norm(row.email)) : undefined;
    if (contact) add('contact', contact.id, `${contact.name} (${contact.email})`, row.label);
  }
  return [...matches.values()];
}

/** Number of file rows that match at least one archived record. */
export function matchedRowCount(matches: ArchivedMatch[]): number {
  return new Set(matches.flatMap((m) => m.rows)).size;
}

/** True when the row matches an archived record the person chose to skip (the default). */
export function isRowSkipped(
  lookup: ArchivedLookup,
  row: ImportRowRef,
  decisions: Record<string, ArchivedDecision>
): boolean {
  return findArchivedMatches(lookup, [row]).some((m) => (decisions[m.key] ?? 'skip') === 'skip');
}

/** The facility_key of an archived school being restored in this import, by name. */
export function restoredSchoolId(
  lookup: ArchivedLookup,
  schoolName: string,
  decisions: Record<string, ArchivedDecision>
): string | undefined {
  const school = lookup.schools.find((s) => norm(s.name) === norm(schoolName));
  return school && decisions[`school:${school.id}`] === 'restore' ? school.id : undefined;
}
