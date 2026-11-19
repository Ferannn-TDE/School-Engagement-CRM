/**
 * An event's schools have one rule (utils/events eventSchoolIds): the host school
 * (events.schools_involved) plus the live event_schools rows (db/031), each once, and
 * none for an archived event. This checks the rule, and that nothing in src/ counts or
 * lists an event's schools another way: only the files below may read
 * .participatingSchools or .hostSchoolId.
 *
 * Run:  npm run verify:event-schools
 */
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { eventSchoolIds, schoolsAtEvent } from '../src/utils/events.ts';
import { priorityLists } from '../src/utils/priorities.ts';
import { eventStates } from '../src/utils/region.ts';
import type { Event } from '../src/types/index.ts';

let passed = 0;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
};

const ev = (over: Partial<Event> & { archived?: boolean }): Event & { archived?: boolean } => ({
  id: 'e_1', name: 'Test', date: '2027-01-10T09:00:00', location: '', participatingSchools: [], createdAt: '', updatedAt: '', ...over,
});

check('host plus participants, each once', () => {
  assert.deepEqual(eventSchoolIds(ev({ hostSchoolId: 'H', participatingSchools: ['A', 'B'] })), ['H', 'A', 'B']);
  assert.deepEqual(eventSchoolIds(ev({ hostSchoolId: 'A', participatingSchools: ['A', 'B', 'B'] })), ['A', 'B'], 'host also listed: counted once');
  assert.deepEqual(eventSchoolIds(ev({ participatingSchools: ['A'] })), ['A'], 'no host');
  assert.deepEqual(eventSchoolIds(ev({ hostSchoolId: 'H' })), ['H'], 'host only (a scraped event)');
  assert.deepEqual(eventSchoolIds(ev({})), []);
});

check('an archived event has no schools', () => {
  assert.deepEqual(eventSchoolIds(ev({ archived: true, hostSchoolId: 'H', participatingSchools: ['A'] })), []);
});

check('schoolsAtEvent adds imported attendance without counting anyone twice', () => {
  const e = ev({ hostSchoolId: 'H', participatingSchools: ['A'] });
  assert.deepEqual(schoolsAtEvent(e, new Map([['e_1', new Set(['A', 'C'])]])), ['H', 'A', 'C']);
  assert.deepEqual(schoolsAtEvent(e, new Map()), ['H', 'A']);
});

check('Priorities "on an upcoming event" and the region filter see the host school too', () => {
  const e = ev({ hostSchoolId: 'H', participatingSchools: ['A'], date: '2099-01-10T09:00:00' });
  const school = (id: string, state: string) => ({ id, name: id, state, county: 'X', isActive: true } as never);
  const lists = priorityLists([school('H', 'IL'), school('A', 'MO')], [], [], [e], '2026-11-19');
  const onEvent = JSON.stringify(lists);
  assert.match(onEvent, /"H"/);
  assert.match(onEvent, /"A"/);
  assert.deepEqual([...eventStates(e, new Map([['H', 'IL'], ['A', 'MO']]))].sort(), ['IL', 'MO']);
});

// --- Nothing else reads an event's schools directly -------------------------
const ALLOWED = new Set([
  'src/types/index.ts',                  // the Event type
  'src/utils/events.ts',                 // the rule itself
  'src/services/eventsService.ts',       // reads and saves the two sources
  'src/components/events/EventForm.tsx', // edits the participants; shows the host read-only
  'src/components/events/EventDetails.tsx', // labels the host apart from the participants
  'src/context/AppContext.tsx',          // passes the host to updateEvent so it's never saved as a participant
]);
// npm runs scripts from the project folder.
const root = process.cwd();
const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f)) files.push(p);
  }
};
walk(join(root, 'src'));

check('only the allowed files read .participatingSchools or .hostSchoolId', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const rel = relative(root, f).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/\.(participatingSchools|hostSchoolId)\b/.test(line)) offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `use eventSchoolIds (utils/events) instead:\n  ${offenders.join('\n  ')}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
