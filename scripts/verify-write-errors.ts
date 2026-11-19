/**
 * Every failed save says why, in plain words. Feeds the error shapes Supabase returns
 * (the real one from Create Event on 2026-11-19 first) through writeErrorMessage.
 *
 * Run:  npm run verify:errors
 */
import { strict as assert } from 'node:assert';
import { NO_EDIT_ACCESS, writeErrorMessage, writeErrorReason } from '../src/utils/writeErrors.ts';

let passed = 0;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
};

// The production error behind "Failed to save event" (Other, 15 schools).
const fk = {
  code: '23503',
  details: 'Key is not present in table "schools".',
  hint: null,
  message: 'insert or update on table "events" violates foreign key constraint "events_schools_involved_fkey"',
};

check('the Create Event error names the school and what to do', () => {
  const m = writeErrorMessage(fk, 'Failed to save event');
  assert.match(m, /^Failed to save event: it refers to a school that isn’t in the database/);
  assert.match(m, /Refresh the page/);
  assert.doesNotMatch(m, /foreign key|23503|constraint/);
});

check('a viewer gets the role explanation only', () => {
  assert.equal(writeErrorMessage({ code: '42501', message: 'new row violates row-level security policy' }, 'Failed to save event'), NO_EDIT_ACCESS);
});

check('database functions’ own sentences pass through', () => {
  assert.equal(writeErrorReason({ code: 'P0001', message: 'An import batch needs at least one school' }), 'An import batch needs at least one school');
});

check('missing migration 031 is explained', () => {
  const m = writeErrorMessage(Object.assign(new Error('The database needs update 031 (event schools) before an event can list schools.'), { code: 'APP031' }), 'Failed to save event');
  assert.equal(m, 'Failed to save event: The database needs update 031 (event schools) before an event can list schools.');
});

const cases: Array<[string, object, RegExp]> = [
  ['duplicate', { code: '23505', message: 'duplicate key value violates unique constraint "x"' }, /already exists/],
  ['event type check', { code: '23514', message: 'new row for relation "events" violates check constraint "events_event_type_known"' }, /event type/],
  ['count check', { code: '23514', message: 'violates check constraint "activities_attendee_count_check"' }, /at least 1/],
  ['required column', { code: '23502', message: 'null value in column "fair_name" of relation "events" violates not-null constraint' }, /event name is empty/],
  ['too long', { code: '22001', message: 'value too long for type character varying(255)' }, /longer than allowed/],
  ['bad format', { code: '22P02', message: 'invalid input syntax for type integer: "abc"' }, /wrong format/],
  ['bad date', { code: '22008', message: 'date/time field value out of range' }, /date or time/],
  ['not found', { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, /wasn’t found/],
  ['missing table', { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" }, /migration/],
  ['offline', new TypeError('Failed to fetch'), /couldn’t be reached/],
  ['expired sign-in', { code: 'PGRST301', message: 'JWT expired' }, /sign-in has expired/],
  ['still referenced', { code: '23503', details: 'Key (event_id)=(5) is still referenced from table "event_schools".', message: 'update or delete violates foreign key' }, /still point to this event/],
  ['unknown with message', { code: 'XX000', message: 'Something odd.' }, /^the database said: Something odd$/],
  ['nothing at all', {}, /didn’t explain/],
];
for (const [name, err, re] of cases) check(name, () => assert.match(writeErrorReason(err), re));

check('every message ends in one full stop and starts with the fallback', () => {
  for (const [, err] of cases) {
    const m = writeErrorMessage(err, 'Couldn’t save.');
    assert.match(m, /^Couldn’t save: /);
    assert.match(m, /[^.]\.$/);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
