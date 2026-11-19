/**
 * The shared form rules (src/utils/formRules.ts) and the table width sharing
 * (tableColumns.ts sharedWidths).
 *
 * Run:  npm run verify:forms
 */
import { strict as assert } from 'node:assert';
import {
  emailProblem, endAfterStartProblem, MAX, phoneProblem, requiredText, textProblem, trimStrings, urlProblem,
  wholeNumber, wholeNumberProblem, zipProblem,
} from '../src/utils/formRules.ts';
import { PRIMARY_SHARE, sharedWidths, type ColumnSpec } from '../src/components/common/tableColumns.ts';

let passed = 0;
let failed = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
};

check('required text: blank and spaces-only are refused, trimmed length counts', () => {
  assert.equal(textProblem('', 'Name', { required: true, max: 5 }), 'Name is required.');
  assert.equal(textProblem('   ', 'Name', { required: true, max: 5 }), 'Name is required.');
  assert.equal(textProblem('  abc  ', 'Name', { required: true, max: 5 }), '');
  assert.match(textProblem('abcdef', 'Name', { max: 5 }), /5 characters or fewer \(it's 6\)/);
});

check('email: blank is fine, a real address passes, others say what is wrong', () => {
  assert.equal(emailProblem(''), '');
  assert.equal(emailProblem(' jdoe@siue.edu '), '');
  assert.match(emailProblem('jdoe@siue'), /doesn't look like an email/);
  assert.match(emailProblem('j doe@siue.edu'), /doesn't look like an email/);
});

check('phone: every stored shape passes (4,625 contacts and 1,803 schools on Nov 19)', () => {
  for (const p of ['618-650-3000', '(618) 650-3000', '6186503000', '+1 618 650 3000', '708-371-1111 ext. 3759', '618.650.3000 x12']) {
    assert.equal(phoneProblem(p), '', p);
  }
  assert.match(phoneProblem('650-3000'), /10-digit/);
  assert.match(phoneProblem('call the office'), /10-digit/);
});

check('website and zip', () => {
  assert.equal(urlProblem('www.siue.edu'), '');
  assert.equal(urlProblem('https://www.siue.edu/engineering'), '');
  assert.match(urlProblem('not a site'), /web address/);
  assert.equal(zipProblem('62026'), '');
  assert.equal(zipProblem('62026-1234'), '');
  assert.equal(zipProblem('62360 1033'), '', 'stored with a space');
  assert.match(zipProblem('6202'), /5 digits/);
  assert.equal(zipProblem(''), 'Zip code is required.');
});

check('whole numbers: at least 1, no decimals or text, blank only when optional', () => {
  assert.equal(wholeNumberProblem('', 'Attendee count'), '');
  assert.equal(wholeNumberProblem('15', 'Attendee count'), '');
  assert.match(wholeNumberProblem('0', 'Attendee count'), /at least 1/);
  assert.match(wholeNumberProblem('-2', 'Attendee count'), /whole number/);
  assert.match(wholeNumberProblem('2.5', 'Attendee count'), /whole number/);
  assert.match(wholeNumberProblem('', 'Visitors', { required: true }), /required/);
  assert.match(wholeNumberProblem('200001', 'Enrollment', { max: 100000 }), /100,000 or less/);
});

check('end after start', () => {
  assert.equal(endAfterStartProblem('2026-11-19T10:00', ''), '');
  assert.equal(endAfterStartProblem('2026-11-19T10:00', '2026-11-19T12:00'), '');
  assert.match(endAfterStartProblem('2026-11-19T10:00', '2026-11-19T09:00'), /after the start/);
  assert.match(endAfterStartProblem('2026-11-19T10:00', '2026-11-19T10:00'), /after the start/);
});

check('schema rules give the same messages, and untouched required fields say "required"', () => {
  assert.equal(requiredText('Event name', MAX.name).safeParse(undefined).error?.issues[0].message, 'Event name is required.');
  assert.equal(requiredText('Event name', MAX.name).safeParse('  ').error?.issues[0].message, 'Event name is required.');
  assert.ok(requiredText('Event name', MAX.name).safeParse('Alumni panel').success);
  assert.match(wholeNumber('Attendee count').safeParse('0').error?.issues[0].message ?? '', /at least 1/);
});

check('trimStrings trims strings only', () => {
  assert.deepEqual(trimStrings({ a: '  x ', b: 3, c: ['  y '] }), { a: 'x', b: 3, c: ['  y '] });
});

// --- Table widths ---------------------------------------------------------
const schools: ColumnSpec[] = ['primary', 'text', 'number', 'text', 'badge'];
const events: ColumnSpec[] = ['primary', 'text', 'date', 'number', 'number', 'actions'];

check('wide table: the name gets a third and the rest shares the space', () => {
  for (const width of [1110, 1596]) {
    const w = sharedWidths(events, width)!;
    assert.ok(Math.abs(w[0] / width - PRIMARY_SHARE) < 0.001, `name ${w[0]} of ${width}`);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - width) < 0.5, 'columns fill the table');
    assert.equal(w[5], 128, 'actions stay 8rem');
    assert.ok(w[1] > 176 && w[3] > 112, 'others grow past their usual width');
  }
});

check('narrow table: the old layout (others at their usual width, name takes the rest)', () => {
  // 850px: a third (283) plus the others' 600 doesn't fit, so the name takes what's left.
  const w = sharedWidths(schools, 850)!;
  assert.deepEqual(w.slice(1), [176, 112, 176, 136]);
  assert.equal(w[0], 850 - 600);
  const tight = sharedWidths(schools, 500)!;
  assert.equal(tight[0], 224, 'never under 14rem: the table scrolls instead');
});

check('nothing to share with: no override', () => {
  assert.equal(sharedWidths(['primary', 'number'], 1200), undefined);
  assert.equal(sharedWidths(['text', 'number', 'date'], 1200), undefined);
  assert.equal(sharedWidths(schools, 0), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
