/**
 * Exercises the activity-import matcher and file reader against the synthetic fixture
 * in scripts/fixtures/activity-import (a hand-made file and a small schools list), so
 * the tests never depend on live data or on the client's own file.
 *
 * Run:  npm run verify:activity-import
 *
 * Each fixture row covers one case from the design on the plan page (exact, fuzzy,
 * wrong state, same name in both states, junior high, repeats, colleges, online
 * schools, placeholders, a header in the middle, a blank row, an archived school).
 */
import * as XLSX from 'xlsx';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  coreTokens,
  hasSchoolRows,
  matchRows,
  nameTokens,
  ratio,
  searchSchools,
  tokenSet,
  tokenSort,
  type MatchSchool,
  type RowMatch,
} from '../src/utils/activityImportMatch.ts';
import {
  buildActivityTemplate,
  fileHash,
  planActivities,
  readActivityWorkbook,
} from '../src/utils/activityImportFile.ts';

const FIXTURES = join(process.cwd(), 'scripts', 'fixtures', 'activity-import');
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

const csvBytes = new Uint8Array(readFileSync(join(FIXTURES, 'rows.csv')));
const schools: MatchSchool[] = JSON.parse(readFileSync(join(FIXTURES, 'schools.json'), 'utf8'));

function readFixture() {
  const result = readActivityWorkbook(XLSX.read(csvBytes, { type: 'array', raw: true }));
  assert.ok(result.ok, 'the fixture should read');
  return result.rows;
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

async function main() {
  console.log('Similarity (same values as Python difflib)');
  check('ratio matches difflib on reference pairs', () => {
    close(ratio('bloomington', 'bloomington junior'), 0.7586206896551724);
    close(ratio('8 pana', 'pana'), 0.8);
    close(ratio('college illinois southwestern', 'southwestern'), 0.5853658536585366);
    close(ratio('abcde', 'ace'), 0.75);
    close(ratio('king luther martin', 'king college preparatory'), 0.5238095238095238);
    close(ratio('', ''), 1);
  });
  check('token-set ignores extra words; token-sort penalises them', () => {
    assert.equal(tokenSet(['pana', '8'], ['pana']), 1);
    close(tokenSort(['pana', '8'], ['pana']), 0.8);
  });

  console.log('Name cleaning');
  check('punctuation, case and abbreviations', () => {
    assert.deepEqual(nameTokens("Ft. Zumwalt North High"), ['fort', 'zumwalt', 'north', 'high']);
    assert.deepEqual(nameTokens('Eureka Sr. High'), ['eureka', 'senior', 'high']);
    assert.deepEqual(nameTokens('Carbondale Comm H S'), ['carbondale', 'community', 'h', 's']);
    assert.deepEqual(nameTokens('Martin L King'), ['martin', 'luther', 'king']);
  });
  check('"O Fallon" and "Ofallon" clean to the same word', () => {
    assert.deepEqual(coreTokens('O Fallon High School'), ['ofallon']);
    assert.deepEqual(coreTokens('Ofallon township high school'), ['ofallon']);
    assert.deepEqual(coreTokens("O'Fallon Township High"), ['ofallon']);
  });
  check('generic words dropped, "junior" kept', () => {
    assert.deepEqual(coreTokens('Bloomington Jr High School'), ['bloomington', 'junior']);
    assert.deepEqual(coreTokens('Pana Unit 8  High school'), ['pana', '8']);
  });

  console.log('Reading the file');
  const rows = readFixture();
  check('columns read by position, trailing blanks dropped, row numbers kept', () => {
    assert.equal(rows.length, 21);
    assert.deepEqual(rows[0], { row: 1, name: 'Alton High School', city: 'Alton', state: 'IL' });
    assert.equal(rows[3].name, 'Pana Unit 8 High school', 'repeated spaces collapse');
  });
  check('the same rows come out of an .xlsx copy of the file', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r) => [r.name, r.city, r.state])), 'Sheet1');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const again = readActivityWorkbook(XLSX.read(new Uint8Array(bytes), { type: 'array' }));
    assert.ok(again.ok);
    assert.deepEqual(again.rows, rows);
  });
  check('an empty file is refused, not read as zero rows', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1');
    assert.deepEqual(readActivityWorkbook(wb), { ok: false, reason: 'no-rows' });
  });

  console.log('Outcomes for each fixture row');
  const results = matchRows(rows, schools);
  const at = (row: number): RowMatch => results.find((r) => r.row === row)!;
  const top = (row: number) => at(row).candidates[0]?.school.id;
  const expect = (row: number, outcome: RowMatch['outcome'], schoolId?: string) => {
    const r = at(row);
    assert.equal(r.outcome, outcome, `row ${row} "${r.name}": ${r.outcome} (${r.reasons.join('; ')})`);
    if (schoolId) assert.equal(top(row), schoolId, `row ${row} best match`);
  };
  check('exact match', () => expect(1, 'matched', 'IL-alton'));
  check('generic words dropped: Matched, flagged as worded differently', () => {
    expect(2, 'matched', 'IL-barrington');
    assert.equal(at(2).identical, false);
    assert.equal(at(1).identical, true);
  });
  check('"Ofallon township" matches O Fallon High School', () => expect(3, 'matched', 'IL-ofallon'));
  check('double space and extra words: Suggested, never picked', () => {
    expect(4, 'suggested', 'IL-pana-sr');
    assert.ok(at(4).reasons.includes('names differ'));
  });
  check('wrong state: Suggested with the state warning', () => {
    expect(5, 'suggested', 'MO-poplar-bluff');
    assert.ok(at(5).reasons.includes('file says IL, school is in MO'));
  });
  check('same name in both states: the file\'s state wins', () => expect(6, 'matched', 'MO-eureka'));
  check('a junior high can\'t tie with the high school', () => expect(7, 'matched', 'IL-bloomington'));
  check('repeats match the same school', () => {
    expect(8, 'matched', 'IL-taylorville');
    expect(9, 'matched', 'IL-taylorville');
  });
  check('a college with only a weak school match is Not a K-12 school', () => {
    for (const row of [10, 11, 13]) expect(row, 'not_k12');
    assert.equal(top(10), 'IL-southwestern', 'the weak match is kept to show, not used');
  });
  check('header in the middle and blank row skipped', () => {
    expect(12, 'header');
    expect(20, 'blank');
  });
  check('"College" inside a high school\'s name is never Not a K-12 school', () => expect(14, 'not_found'));
  check('Martin L King: Not found, and the search finds King College Prep', () => {
    expect(15, 'not_found');
    assert.deepEqual(searchSchools('King', schools, 'IL').map((s) => s.id), ['IL-king']);
    assert.deepEqual(searchSchools('king coll', schools).map((s) => s.id), ['IL-king']);
  });
  check('online schools are Not a K-12 school', () => {
    expect(16, 'not_k12');
    expect(17, 'not_k12');
  });
  check('placeholders are Not a school', () => {
    expect(18, 'not_a_school');
    expect(19, 'not_a_school');
  });
  check('an archived school is still found, and marked archived', () => {
    expect(21, 'matched', 'IL-triad');
    assert.equal(at(21).candidates[0].school.archived, true);
  });

  console.log('Saving plan');
  check('one activity per school, repeats become an attendee count', () => {
    const choices = results
      .filter((r) => r.outcome === 'matched')
      .map((r) => ({ row: r.row, schoolId: r.candidates[0].school.id }));
    const plan = planActivities(choices);
    const taylorville = plan.find((p) => p.schoolId === 'IL-taylorville')!;
    assert.equal(taylorville.attendeeCount, 2);
    assert.deepEqual(taylorville.rows, [8, 9]);
    assert.equal(plan.length, new Set(choices.map((c) => c.schoolId)).size);
  });
  check('skipped rows (no school chosen) are left out', () => {
    assert.deepEqual(planActivities([{ row: 1, schoolId: null }, { row: 2, schoolId: 'a' }]), [
      { schoolId: 'a', attendeeCount: 1, rows: [2] },
    ]);
  });

  console.log('File hash and template');
  await checkAsync('the hash is SHA-256 of the bytes, and identical files hash the same', async () => {
    assert.equal(
      await fileHash(new TextEncoder().encode('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    assert.equal(await fileHash(csvBytes), await fileHash(new Uint8Array(csvBytes)));
  });
  check('the template has headers only, and reads as empty', () => {
    const bytes = XLSX.write(buildActivityTemplate(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const wb = XLSX.read(new Uint8Array(bytes), { type: 'array' });
    assert.deepEqual(wb.SheetNames, ['Schools', 'Instructions']);
    const result = readActivityWorkbook(wb);
    assert.ok(result.ok);
    assert.equal(result.sheetName, 'Schools');
    // Only the header: the page reports "no schools in this file" (hasSchoolRows).
    assert.deepEqual(matchRows(result.rows, schools).map((r) => r.outcome), ['header']);
    assert.equal(hasSchoolRows(matchRows(result.rows, schools)), false);
  });
  check('a filled-in template: its header row is skipped', () => {
    const wb = buildActivityTemplate();
    XLSX.utils.sheet_add_aoa(wb.Sheets.Schools, [['Alton High School', 'Alton', 'IL']], { origin: -1 });
    const result = readActivityWorkbook(wb);
    assert.ok(result.ok);
    assert.deepEqual(matchRows(result.rows, schools).map((r) => r.outcome), ['header', 'matched']);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

void main();
