import { downloadFile } from './helpers';

// "Export CSV" on the main tables: the current filtered, sorted view, every page.
// Visitors' names (db/029) are never exported: scripts/verify-no-names.mjs fails the
// build if this file, or anything that exports, mentions them.

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | null | undefined;
}

function cell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a header row and a byte-order mark, so Excel reads accents correctly. */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','));
  return '﻿' + lines.join('\r\n');
}

/** "schools-2026-11-13.csv" */
export function csvFilename(name: string, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${day}.csv`;
}

export function downloadCsv<T>(name: string, columns: CsvColumn<T>[], rows: T[]): void {
  downloadFile(toCsv(columns, rows), csvFilename(name));
}
