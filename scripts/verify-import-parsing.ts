/**
 * Exercises the real upload-parsing code against real spreadsheet files.
 *
 * Run:  node --experimental-strip-types scripts/verify-import-parsing.ts
 *
 * These assertions are written to FAIL if the Phase 2 upload fixes are
 * reverted — in particular the single-sheet warning and the empty-file
 * rejection, both of which previously produced a silent zero.
 */
import * as XLSX from 'xlsx';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildCombinedTemplate, buildContactsTemplate, buildSchoolsTemplate, COMBINED_CONTACT_HEADERS, COMBINED_SCHOOL_HEADERS,
  CONTACTS_TEMPLATE_HEADERS, headerField, interpretCombinedWorkbook, looksLikeSpreadsheet, SCHOOLS_TEMPLATE_HEADERS,
} from '../src/utils/importParsing.ts';
import { describeFileRejection, formatBytes, MAX_UPLOAD_BYTES } from '../src/utils/helpers.ts';
import { collectPages } from '../src/utils/paging.ts';

const dir = mkdtempSync(join(tmpdir(), 'import-verify-'));
let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

function sheet(rows: Record<string, string>[]) {
  return XLSX.utils.json_to_sheet(rows);
}

function workbookFile(sheets: [string, Record<string, string>[]][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, rows.length ? sheet(rows) : XLSX.utils.aoa_to_sheet([[]]), name);
  }
  const path = join(dir, `${sheets.map((s) => s[0]).join('-')}.xlsx`);
  XLSX.writeFile(wb, path);
  // Read back from disk so we are parsing a genuine file, not an in-memory object.
  return XLSX.read(new Uint8Array(readFileSync(path)), { type: 'array' });
}

console.log('\ninterpretCombinedWorkbook');

check('two-sheet workbook reads both sheets with no warnings', () => {
  const wb = workbookFile([
    ['Schools', [{ name: 'Test HS', county: 'Madison' }]],
    ['Contacts', [{ firstName: 'Ada', email: 'a@t.org', schoolName: 'Test HS' }]],
  ]);
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.schoolRows.length, 1);
  assert.equal(r.data.contactRows.length, 1);
  assert.equal(r.data.contactSheetName, 'Contacts');
  assert.deepEqual(r.data.warnings, [], `expected no warnings, got ${JSON.stringify(r.data.warnings)}`);
});

check('SINGLE-SHEET workbook warns instead of silently importing zero contacts', () => {
  const wb = workbookFile([['Schools', [{ name: 'Solo School', county: 'Madison' }]]]);
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.data.contactSheetName, null, 'single sheet must not be reused as contacts');
  assert.equal(r.data.contactRows.length, 0);
  assert.equal(r.data.warnings.length, 1, 'the silent-zero case must produce a warning');
  assert.match(r.data.warnings[0], /only one sheet/i);
});

check('workbook with headers but no data rows is rejected', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'county']]), 'Schools');
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'no-rows');
});

check('workbook with no sheets at all is rejected', () => {
  const r = interpretCombinedWorkbook({ SheetNames: [], Sheets: {} } as XLSX.WorkBook, []);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'no-sheets');
});

check('empty contacts sheet is called out', () => {
  const wb = workbookFile([
    ['Schools', [{ name: 'Test HS', county: 'Madison' }]],
    ['Contacts', []],
  ]);
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(
    r.data.warnings.some((w) => /Contacts.*empty/i.test(w)),
    `expected an empty-contacts warning, got ${JSON.stringify(r.data.warnings)}`
  );
});

check('contacts sheet missing schoolName column is called out', () => {
  const wb = workbookFile([
    ['Schools', [{ name: 'Test HS', county: 'Madison' }]],
    ['Contacts', [{ firstName: 'Ada', email: 'a@t.org' }]],
  ]);
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(
    r.data.warnings.some((w) => /schoolName/.test(w)),
    'unlinked contacts must be flagged'
  );
});

check('existing school names are reported as duplicates', () => {
  const wb = workbookFile([
    ['Schools', [{ name: 'Test HS', county: 'Madison' }]],
    ['Contacts', [{ firstName: 'Ada', email: 'a@t.org', schoolName: 'Test HS' }]],
  ]);
  const r = interpretCombinedWorkbook(wb, ['test hs']);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.data.duplicateNames, ['Test HS']);
});

// XLSX.read does NOT throw on junk — it returns a workbook with one empty
// "Sheet1". That is why looksLikeSpreadsheet exists: parse result alone cannot
// tell a corrupt file from a genuinely empty one.
check('corrupt file parses to an empty workbook rather than throwing', () => {
  const path = join(dir, 'corrupt.xlsx');
  writeFileSync(path, 'this is not a spreadsheet');
  const bytes = new Uint8Array(readFileSync(path));
  const wb = XLSX.read(bytes, { type: 'array' });
  const r = interpretCombinedWorkbook(wb, []);
  assert.equal(r.ok, false, 'corrupt input must not produce a usable preview');
  if (r.ok) return;
  assert.equal(r.reason, 'no-rows');
});

console.log('\nlooksLikeSpreadsheet');

check('rejects text, fake PDFs, empty files and random bytes', () => {
  for (const junk of [
    'this is not a spreadsheet',
    '%PDF-1.4 fake pdf content here',
    '',
    '\x00\xff\x13\x37\x00\x01\x02\x03',
  ]) {
    assert.equal(
      looksLikeSpreadsheet(new Uint8Array(Buffer.from(junk, 'binary'))),
      false,
      `should have rejected: ${JSON.stringify(junk.slice(0, 20))}`
    );
  }
});

check('accepts a real .xlsx (ZIP signature)', () => {
  const path = join(dir, 'real.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet([{ name: 'Test HS' }]), 'Schools');
  XLSX.writeFile(wb, path);
  const bytes = new Uint8Array(readFileSync(path));
  assert.equal(bytes[0], 0x50, 'expected PK zip signature');
  assert.equal(looksLikeSpreadsheet(bytes), true);
});

check('accepts a legacy .xls (OLE2 signature)', () => {
  const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
  assert.equal(looksLikeSpreadsheet(ole2), true, 'legacy .xls must not be misreported as corrupt');
});

console.log('\ndescribeFileRejection');

check('oversized file names the size and the limit', () => {
  const msg = describeFileRejection(
    { file: { name: 'huge.xlsx', size: 11 * 1024 * 1024 }, errors: [{ code: 'file-too-large' }] },
    'an Excel file (.xlsx or .xls)'
  );
  assert.match(msg, /11\.0 MB/);
  assert.match(msg, /10\.0 MB limit/);
  assert.doesNotMatch(msg, /undefined/);
});

check('wrong file type names the offending extension', () => {
  const msg = describeFileRejection(
    { file: { name: 'notes.pdf', size: 500 }, errors: [{ code: 'file-invalid-type' }] },
    'an Excel file (.xlsx or .xls)'
  );
  assert.match(msg, /\.pdf/);
  assert.match(msg, /Excel/);
});

check('too many files is explained', () => {
  const msg = describeFileRejection(
    { file: { name: 'a.xlsx', size: 1 }, errors: [{ code: 'too-many-files' }] },
    'an Excel file'
  );
  assert.match(msg, /one file at a time/i);
});

check('an unrecognised rejection code still produces usable text', () => {
  const msg = describeFileRejection(
    { file: { name: 'x.xlsx', size: 1 }, errors: [{ code: 'something-new' }] },
    'an Excel file'
  );
  assert.ok(msg.length > 0 && !/undefined/.test(msg));
});

check('formatBytes boundaries', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(MAX_UPLOAD_BYTES), '10.0 MB');
});

// ── Row paging ────────────────────────────────────────────────────────────────
// PostgREST caps a response at 1000 rows with no error, so an unpaged read
// silently truncates. These exercise the accumulation loop directly.
console.log('\ncollectPages');

function fakeSource(total: number, pageSize: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  let calls = 0;
  return {
    fetch: async (from: number, to: number) => {
      calls++;
      return all.slice(from, to + 1);
    },
    get calls() {
      return calls;
    },
    pageSize,
  };
}

void (async () => {
  await checkAsync('reads past the cap instead of stopping at one page', async () => {
    const src = fakeSource(2500, 1000);
    const rows = await collectPages(src.fetch, 1000);
    assert.equal(rows.length, 2500, 'must return every row, not just the first page');
    assert.equal(src.calls, 3, 'expected 3 requests for 2500 rows at 1000/page');
    assert.equal(new Set(rows.map((r) => r.id)).size, 2500, 'no duplicates or gaps');
  });

  await checkAsync('a total that is an exact multiple still terminates', async () => {
    const src = fakeSource(2000, 1000);
    const rows = await collectPages(src.fetch, 1000);
    assert.equal(rows.length, 2000);
    assert.equal(src.calls, 3, 'needs a final short page to know it is done');
  });

  await checkAsync('a single short page makes exactly one request', async () => {
    const src = fakeSource(62, 1000);
    const rows = await collectPages(src.fetch, 1000);
    assert.equal(rows.length, 62);
    assert.equal(src.calls, 1);
  });

  await checkAsync('an empty table returns nothing without looping', async () => {
    const src = fakeSource(0, 1000);
    const rows = await collectPages(src.fetch, 1000);
    assert.equal(rows.length, 0);
    assert.equal(src.calls, 1);
  });

  console.log('\nDownloadable templates');
  // What the browser downloads: written to .xlsx bytes and read back, as an upload is.
  const roundTrip = (wb: XLSX.WorkBook) => XLSX.read(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer), { type: 'array' });
  const headersOf = (wb: XLSX.WorkBook, sheet: string) => (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1 })[0] ?? []);
  check('every template is headers only: no example rows anywhere', () => {
    for (const wb of [buildCombinedTemplate(), buildContactsTemplate(), buildSchoolsTemplate()].map(roundTrip)) {
      for (const name of wb.SheetNames) assert.equal(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }).length, 1, name);
    }
  });
  check('Schools + Contacts template: both sheets, with the exact keys the importer reads', () => {
    const wb = roundTrip(buildCombinedTemplate());
    assert.deepEqual(wb.SheetNames, ['Schools', 'Contacts']);
    assert.deepEqual(headersOf(wb, 'Schools'), COMBINED_SCHOOL_HEADERS);
    assert.deepEqual(headersOf(wb, 'Contacts'), COMBINED_CONTACT_HEADERS);
  });
  check('the blank combined template re-uploads to the "no data rows" message, not an error', () => {
    assert.deepEqual(interpretCombinedWorkbook(roundTrip(buildCombinedTemplate()), []), { ok: false, reason: 'no-rows' });
  });
  check('a filled-in combined template reaches the preview with no warnings', () => {
    const wb = buildCombinedTemplate();
    XLSX.utils.sheet_add_aoa(wb.Sheets.Schools, [['Test High', '', 'Madison', '', 'Alton', 'IL', '62002', 'High School']], { origin: -1 });
    XLSX.utils.sheet_add_aoa(wb.Sheets.Contacts, [['Ann', 'Lee', 'ann@test.example', '', 'Counselor', 'Test High']], { origin: -1 });
    const r = interpretCombinedWorkbook(roundTrip(wb), []);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.data.schoolRows.length, 1);
      assert.equal(r.data.contactRows.length, 1);
      assert.deepEqual(r.data.warnings, []);
    }
  });
  check('Contacts and Schools templates: every header maps to a field, with no manual matching', () => {
    const contacts = headersOf(roundTrip(buildContactsTemplate()), 'Contacts');
    const schools = headersOf(roundTrip(buildSchoolsTemplate()), 'Schools');
    assert.deepEqual(contacts, CONTACTS_TEMPLATE_HEADERS);
    assert.deepEqual(schools, SCHOOLS_TEMPLATE_HEADERS);
    assert.deepEqual(contacts.map((h) => headerField(h, 'contacts')), ['firstName', 'lastName', 'email', 'phone', 'role', 'schoolId', 'notes']);
    assert.deepEqual(schools.map((h) => headerField(h, 'schools')), ['name', 'district', 'county', 'address', 'city', 'state', 'zipCode', 'schoolType', 'notes']);
  });

  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) process.exit(1);
})();
