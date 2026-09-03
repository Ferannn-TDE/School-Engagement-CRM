import type { WorkBook } from 'xlsx';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  [key: string]: string;
}

export interface CombinedParseData {
  schoolRows: ParsedRow[];
  contactRows: ParsedRow[];
  duplicateNames: string[];
  schoolSheetName: string;
  contactSheetName: string | null;
  /** Things the user would otherwise only discover as an unexplained zero count. */
  warnings: string[];
}

export type CombinedParseResult =
  | { ok: true; data: CombinedParseData }
  | { ok: false; reason: 'no-sheets' | 'no-rows' };

/**
 * Whether the bytes carry a real spreadsheet signature.
 *
 * XLSX.read never throws on junk — it quietly returns a workbook with one
 * empty "Sheet1" — so a corrupt or mislabelled file is indistinguishable from
 * an empty one by parse result alone. This is used only to pick an accurate
 * error message, never to block a file, so an unrecognised-but-valid variant
 * still gets parsed normally.
 *
 *   .xlsx / .xlsm  are ZIP containers  -> "PK\x03\x04"
 *   .xls (BIFF8)   is an OLE2 compound -> D0 CF 11 E0 A1 B1 1A E1
 */
export function looksLikeSpreadsheet(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole2 =
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1;
  return zip || ole2;
}

/**
 * Decides which sheets in a workbook are the schools sheet and the contacts
 * sheet, and reports anything about that choice the user needs to know.
 *
 * Kept free of React state so it can be exercised directly against real
 * spreadsheet files — see scripts/verify-import-parsing.ts.
 */
export function interpretCombinedWorkbook(
  workbook: WorkBook,
  existingSchoolNames: string[]
): CombinedParseResult {
  if (workbook.SheetNames.length === 0) {
    return { ok: false, reason: 'no-sheets' };
  }

  const schoolSheetName =
    workbook.SheetNames.find((n) => n.toLowerCase().includes('school')) ?? workbook.SheetNames[0];

  // A contacts sheet must be a genuinely different sheet. Falling back to the
  // schools sheet here is what previously made a single-sheet workbook import
  // zero contacts with no explanation.
  const contactSheetName =
    workbook.SheetNames.find(
      (n) => n.toLowerCase().includes('contact') && n !== schoolSheetName
    ) ??
    workbook.SheetNames.find((n) => n !== schoolSheetName) ??
    null;

  const schoolSheet = workbook.Sheets[schoolSheetName];
  const contactSheet = contactSheetName ? workbook.Sheets[contactSheetName] : null;

  const schoolRows = schoolSheet
    ? XLSX.utils.sheet_to_json<ParsedRow>(schoolSheet, { defval: '' })
    : [];
  const contactRows = contactSheet
    ? XLSX.utils.sheet_to_json<ParsedRow>(contactSheet, { defval: '' })
    : [];

  if (schoolRows.length === 0 && contactRows.length === 0) {
    return { ok: false, reason: 'no-rows' };
  }

  const warnings: string[] = [];
  if (!contactSheetName) {
    warnings.push(
      `This file has only one sheet ("${schoolSheetName}"), so no contacts will be imported. Add a second sheet named "Contacts" if you meant to include them.`
    );
  } else if (contactRows.length === 0) {
    warnings.push(`The "${contactSheetName}" sheet is empty, so no contacts will be imported.`);
  }
  if (schoolRows.length === 0) {
    warnings.push(`The "${schoolSheetName}" sheet is empty, so no schools will be imported.`);
  }
  if (contactRows.length > 0 && !('schoolName' in contactRows[0])) {
    warnings.push(
      'The contacts sheet has no "schoolName" column, so contacts cannot be linked to their schools.'
    );
  }

  const existing = new Set(existingSchoolNames.map((n) => n.toLowerCase()));
  const duplicateNames = schoolRows
    .map((r) => (r['name'] as string) || '')
    .filter((n) => n && existing.has(n.toLowerCase()));

  return {
    ok: true,
    data: {
      schoolRows,
      contactRows,
      duplicateNames,
      schoolSheetName,
      contactSheetName,
      warnings,
    },
  };
}
