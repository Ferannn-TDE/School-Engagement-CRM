import * as XLSX from 'xlsx';
import type { FileRow } from './activityImportMatch';

// Reading an activity-import file: columns 1–3 by position (school name, city, state),
// with or without a header, wherever a header row ends up (Book10.xlsx has it sorted
// into row 37). The "Schools" sheet is read if there is one, else the first sheet,
// so the template's "Instructions" sheet and its example are never imported.

export type ActivityFileResult =
  | { ok: true; rows: FileRow[]; sheetName: string }
  | { ok: false; reason: 'no-sheets' | 'no-rows' };

export function readActivityWorkbook(workbook: XLSX.WorkBook): ActivityFileResult {
  if (!workbook.SheetNames.length) return { ok: false, reason: 'no-sheets' };
  const sheetName =
    workbook.SheetNames.find((n) => n.trim().toLowerCase() === 'schools') ?? workbook.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: true,
    raw: false,
  });
  const rows: FileRow[] = grid.map((cells, i) => {
    const [name, city, state] = [0, 1, 2].map((c) => String(cells[c] ?? '').replace(/\s+/g, ' ').trim());
    return { row: i + 1, name, city, state };
  });
  // Trailing empty rows are formatting, not data.
  while (rows.length && !rows[rows.length - 1].name && !rows[rows.length - 1].city && !rows[rows.length - 1].state) {
    rows.pop();
  }
  if (!rows.some((r) => r.name)) return { ok: false, reason: 'no-rows' };
  return { ok: true, rows, sheetName };
}

/** SHA-256 of the file's bytes, as 64 hex characters: how a second upload is recognised. */
export async function fileHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PlannedActivity {
  schoolId: string;
  /** How many file rows chose this school: one activity, with this attendee count. */
  attendeeCount: number;
  rows: number[];
}

/**
 * One activity per school (the default until the client says repeats are separate
 * visits): rows that chose the same school are counted, not saved twice.
 */
export function planActivities(choices: { row: number; schoolId: string | null }[]): PlannedActivity[] {
  const bySchool = new Map<string, PlannedActivity>();
  for (const { row, schoolId } of choices) {
    if (!schoolId) continue;
    const plan = bySchool.get(schoolId) ?? { schoolId, attendeeCount: 0, rows: [] };
    plan.attendeeCount += 1;
    plan.rows.push(row);
    bySchool.set(schoolId, plan);
  }
  return [...bySchool.values()];
}

export const TEMPLATE_HEADER = ['School name', 'City', 'State'];

/** The downloadable template: an empty "Schools" sheet and an "Instructions" sheet. */
export function buildActivityTemplate(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const schools = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADER]);
  schools['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, schools, 'Schools');
  const instructions = XLSX.utils.aoa_to_sheet([
    ['How to fill in the Schools sheet'],
    [''],
    ['One row per student or attendee, on the Schools sheet. Three columns:'],
    ['School name', 'The school as you know it. It does not need to match exactly.'],
    ['City', 'Optional. Used only to tell apart schools with the same name.'],
    ['State', 'IL or MO.'],
    [''],
    ['The same school on several rows becomes one activity with an attendee count.'],
    ['The activity type, date, description and event are chosen once in the app.'],
    [''],
    ['Example (this sheet is never imported):'],
    TEMPLATE_HEADER,
    ['Edwardsville High School', 'Edwardsville', 'IL'],
    ['Kirkwood High School', 'Kirkwood', 'MO'],
  ]);
  instructions['!cols'] = [{ wch: 40 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');
  return wb;
}
