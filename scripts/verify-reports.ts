/**
 * Checks the Reports page's figures (src/utils/reports.ts) against values worked out
 * by hand from the fixture in scripts/fixtures/reports, plus the date rules on their
 * own. No database, no live data.
 *
 * Run:  npm run verify:reports
 *
 * The same fixture goes through the SQL check in verify-reports-sql.ts, so a figure
 * that passes both means the page and the database agree on its definition.
 */
import { strict as assert } from 'node:assert';

import type { ActivityRecord, School } from '../src/types';
import { priorityLists, countyGaps } from '../src/utils/priorities';
import { countySummaryFromData } from '../src/services/analyticsService';
import { meetingSummary } from '../src/utils/meetingSummary';
import { toCsv, csvFilename } from '../src/utils/csv';
import { contactFreshness, lastUpdatedText, schoolFreshness, verificationText } from '../src/utils/freshness';
import { attendanceByEvent, schoolsAtEvent, schoolsWithAttendance, unlinkedAttendance } from '../src/utils/events';
import type { Contact, Event as AppEvent } from '../src/types';
import { activityDateError, futureDateNote, hasHappened, latestActivityDay } from '../src/utils/activityDates';
import {
  activitiesUpTo,
  activitySummary,
  addMonths,
  comparisonFor,
  contactCoverage,
  dayOf,
  eventImpact,
  formatRange,
  gaps,
  loggingStatus,
  monthly,
  reach,
  reportSnapshot,
  resolveRange,
} from '../src/utils/reports';
import { scopeToRegion } from '../src/utils/region';
import { activityCount, listBuilders, listToCsv, pctText } from '../src/utils/reportLists';
import { loadFixtureRows, toAppData } from './reportsFixture';

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

const TODAY = '2026-10-27';
const FALL = { start: '2026-08-24', end: '2026-10-27' };
const data = toAppData(loadFixtureRows(), TODAY);

console.log('Date ranges');
check('this semester on Oct 27 is Fall 2026 so far', () => {
  const r = resolveRange('semester', TODAY);
  assert.deepEqual([r.label, r.start, r.end, r.periodEnd], ['Fall 2026', '2026-08-24', '2026-10-27', '2026-12-18']);
});
check('over winter break, this semester is the fall term that just ended, labelled with its end', () => {
  const r = resolveRange('semester', '2026-12-25');
  assert.deepEqual([r.label, r.start, r.end], ['Fall 2026 (ended Dec 18)', '2026-08-24', '2026-12-18']);
});
check('in the August gap, this semester is the summer term', () => {
  assert.equal(resolveRange('semester', '2026-08-15').label, 'Summer 2026 (ended Aug 8)');
  assert.equal(resolveRange('semester', '2026-12-18').label, 'Fall 2026', 'its last day is still in the term');
});
check('this year is the school year from Aug 1', () => {
  const r = resolveRange('year', TODAY);
  assert.deepEqual([r.label, r.start, r.end, r.periodEnd], ['School year 2026–27', '2026-08-01', '2026-10-27', '2027-07-31']);
  assert.equal(resolveRange('year', '2027-03-01').start, '2026-08-01');
  assert.equal(resolveRange('year', '2026-07-31').start, '2025-08-01');
  assert.equal(resolveRange('year', '2026-08-01').start, '2026-08-01');
});
check('this month runs from the 1st to today', () => {
  const r = resolveRange('month', TODAY);
  assert.deepEqual([r.label, r.start, r.end, r.periodEnd], ['October 2026', '2026-10-01', '2026-10-27', '2026-10-31']);
});
check('a custom range is used as given; a backwards one falls back to this month', () => {
  assert.equal(resolveRange('custom', TODAY, { start: '2026-10-01', end: '2026-10-27' }).label, 'Custom range');
  assert.deepEqual([resolveRange('custom', TODAY, { start: '2025-01-01', end: '2025-12-31' }).start, resolveRange('custom', TODAY, { start: '2025-01-01', end: '2025-12-31' }).end], ['2025-01-01', '2025-12-31']);
  assert.equal(resolveRange('custom', TODAY, { start: '2026-10-10', end: '2026-10-01' }).preset, 'month');
});
check('month arithmetic clamps to the month end, leap years included', () => {
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2028-02-29', -12), '2027-02-28');
  assert.equal(addMonths('2026-10-27', -6), '2026-04-27');
});
check('a timestamp keeps its own day (no time-zone shift)', () => {
  assert.equal(dayOf('2026-04-26T23:30:00+00:00'), '2026-04-26');
  assert.equal(dayOf('2026-09-28T12:00:00'), '2026-09-28');
});
check('ranges read naturally', () => {
  assert.equal(formatRange(FALL), 'Aug 24 – Oct 27, 2026');
  assert.equal(formatRange({ start: '2025-12-01', end: '2026-01-31' }), 'Dec 1, 2025 – Jan 31, 2026');
});

console.log('Comparison');
check('logging started Sep 28, 2026: Fall 2026 has nothing to compare with, and says why', () => {
  const c = comparisonFor(FALL, '2026-09-28');
  assert.equal(c.kind, 'none');
  assert.equal(c.label, 'No comparison yet: outreach logging started Sep 28, 2026');
});
check('with a year of logging, the same dates last year are used', () => {
  const c = comparisonFor(FALL, '2025-01-01');
  assert.deepEqual([c.kind, c.range], ['last-year', { start: '2025-08-24', end: '2025-10-27' }]);
  assert.equal(c.label, 'the same dates last year (Aug 24 – Oct 27, 2025)');
});
check('with a few months of logging, the period just before is used', () => {
  const c = comparisonFor({ start: '2026-10-01', end: '2026-10-27' }, '2026-08-01');
  assert.deepEqual([c.kind, c.range], ['previous', { start: '2026-09-04', end: '2026-09-30' }]);
  assert.equal(c.label, 'the 27 days before (Sep 4 – Sep 30, 2026)');
});
check('a period logging only partly covers is never used', () => {
  assert.equal(comparisonFor({ start: '2026-10-01', end: '2026-10-27' }, '2026-09-10').kind, 'none');
});
check('nothing logged at all', () => {
  assert.equal(comparisonFor(FALL, null).label, 'No comparison yet: no outreach has been logged');
});
check('logging start is the first non-archived activity, from every state', () => {
  // 14 of the 17 rows: a10 is archived, a8 (Oct 28) and a17 (Nov 5) haven't happened yet.
  assert.deepEqual(loggingStatus(activitiesUpTo(data.activities, TODAY)), { start: '2025-09-10', total: 14 });
});
check('activity dates: past and up to one year ahead are allowed', () => {
  const now = new Date('2026-11-11T09:00:00');
  assert.equal(latestActivityDay(now), '2027-11-11');
  assert.equal(activityDateError('2020-01-01', now), '');
  assert.equal(activityDateError('2026-11-12', now), '');
  assert.equal(activityDateError('2027-11-11', now), '');
  assert.equal(activityDateError('2027-11-12', now), 'The date can’t be more than a year ahead');
  assert.equal(activityDateError('', now), 'Choose the date');
  assert.equal(hasHappened({ date: '2026-11-11T12:00:00' }, '2026-11-11'), true, 'today counts');
  assert.equal(hasHappened({ date: '2026-11-12T12:00:00' }, '2026-11-11'), false);
  assert.match(futureDateNote('2026-11-12'), /until Nov 12, 2026\. Update the number of visitors after the event if it changed\.$/);
});
check('a future-dated activity counts nowhere until its day, then counts', () => {
  const ahead = { start: '2026-10-01', end: '2026-11-30' };
  // Seen on Oct 27: the Nov 5 visit (a17, 9 visitors) is upcoming.
  const before = reportSnapshot(data, ahead, TODAY);
  const direct = activitySummary(activitiesUpTo(data.activities, TODAY), data.schools, ahead);
  assert.equal(direct.ids.includes('a17'), false);
  assert.equal(before['activity.total'], direct.ids.length);
  assert.equal(before['activity.visitors'], direct.visitors);
  // The day before and the day itself: only a17 changes.
  const eve = reportSnapshot(data, ahead, '2026-11-04');
  const after = reportSnapshot(data, ahead, '2026-11-05');
  assert.equal(eve['activity.total'], before['activity.total'] + 1, 'a8 (Oct 28) counts from its own day');
  assert.equal(after['activity.total'], eve['activity.total'] + 1);
  assert.equal(after['activity.visitors'], eve['activity.visitors'] + 9);
});

console.log('Fixture figures, every state, Fall 2026 to Oct 27');
const EXPECTED_ALL: Record<string, number> = {
  'schools.total': 7,
  'reach.engaged': 4, 'reach.first_time': 4,
  'reach.state.IL.total': 4, 'reach.state.IL.engaged': 3, 'reach.state.MO.total': 3, 'reach.state.MO.engaged': 1,
  'activity.total': 9, 'activity.visitors': 30, 'activity.visitor_rows': 5, 'activity.months_with_data': 3,
  'activity.type.call': 1, 'activity.type.visit': 2, 'activity.type.email': 1, 'activity.type.event_participation': 5,
  'month.2026-08.activities': 1, 'month.2026-08.schools': 1, 'month.2026-08.new_schools': 1, 'month.2026-08.visitors': 4,
  'month.2026-09.activities': 4, 'month.2026-09.schools': 3, 'month.2026-09.new_schools': 3, 'month.2026-09.visitors': 8,
  'month.2026-10.activities': 4, 'month.2026-10.schools': 3, 'month.2026-10.new_schools': 0, 'month.2026-10.visitors': 18,
  'contacts.total': 6, 'contacts.active': 5,
  'coverage.with': 4, 'coverage.without': 3,
  'coverage.state.IL.without': 2, 'coverage.state.MO.without': 1,
  'coverage.bucket.0': 3, 'coverage.bucket.1': 3, 'coverage.bucket.2-5': 1, 'coverage.bucket.6-15': 0, 'coverage.bucket.16+': 0,
  'coverage.county.IL|Madison.total': 2, 'coverage.county.IL|Madison.without': 0,
  'coverage.county.IL|Cook.total': 1, 'coverage.county.IL|Cook.without': 1,
  'coverage.county.IL|(no county).total': 1, 'coverage.county.IL|(no county).without': 1,
  'coverage.county.MO|St Louis.total': 2, 'coverage.county.MO|St Louis.without': 0,
  'coverage.county.MO|Greene.total': 1, 'coverage.county.MO|Greene.without': 1,
  'events.past': 3, 'events.upcoming': 3, 'events.upcoming_with_schools': 1,
  'events.upcoming.2026-10': 1, 'events.upcoming.2026-11': 1, 'events.upcoming.2027-03': 1,
  'impact.events': 3, 'impact.schools': 4, 'impact.visitors': 24, 'impact.followed': 3, 'impact.closed_schools': 1, 'impact.closed_followed': 0,
  'gaps.never': 1, 'gaps.quiet': 1, 'gaps.untouched_counties': 1,
  'gaps.county.IL|Madison.contacted': 2, 'gaps.county.IL|Cook.contacted': 1, 'gaps.county.IL|(no county).contacted': 0,
  'gaps.county.MO|St Louis.contacted': 2, 'gaps.county.MO|Greene.contacted': 1,
  'health.updated_recent': 2, 'health.updated_older': 2, 'health.not_dated': 2, 'health.scraped_contacts': 1, 'health.no_county': 1,
  'health.site.working': 1, 'health.site.broken': 1, 'health.site.not_found': 0, 'health.site.unchecked': 5,
};
check('every figure matches the hand count', () => {
  assert.deepEqual(reportSnapshot(data, FALL, TODAY), EXPECTED_ALL);
});
check('engaged and first-time schools are the right ones', () => {
  const r = reach(data.schools, data.activities, FALL);
  assert.deepEqual(r.engagedIds, ['s1', 's2', 's3', 's7']);
  assert.deepEqual(r.firstTimeIds, ['s1', 's2', 's3', 's7']);
});
check('first time means first ever: s5 is new in the range holding its first contact, not in a later one', () => {
  const r = reach(data.schools, data.activities, { start: '2025-09-01', end: '2026-10-27' });
  assert.ok(r.engagedIds.includes('s5'));
  assert.ok(r.firstTimeIds.includes('s5'));
  const later = reach(data.schools, data.activities, { start: '2026-03-01', end: '2026-03-31' });
  assert.deepEqual([later.engagedIds, later.firstTimeIds], [['s5'], []]);
});
check('one row per month the range touches, oldest first', () => {
  const m = monthly(data.activities, data.schools, FALL);
  assert.deepEqual(m.months.map((r) => [r.month, r.activityIds.length]), [['2026-08', 1], ['2026-09', 4], ['2026-10', 4]]);
});
check('event impact: only events with imported attendance, most schools then most visitors first', () => {
  const f = eventImpact(data.events, data.activities, data.schools, FALL, TODAY);
  assert.deepEqual(f.map((e) => [e.eventId, e.schoolIds, e.visitors, e.followedIds, e.windowOpen]), [
    ['e_1', ['s1', 's2'], 8, ['s1', 's2'], true],
    ['e_3', ['s3'], 12, ['s3'], true],
    ['e_2', ['s3'], 4, [], false],
  ]);
});
check('counties: lowest coverage first, and the blank county is named', () => {
  const c = contactCoverage(data.schools, data.contacts);
  assert.deepEqual(c.byCounty.map((x) => `${x.state}|${x.county}`), ['IL|(no county)', 'IL|Cook', 'MO|Greene', 'IL|Madison', 'MO|St Louis']);
});

console.log('Boundaries');
const one: School[] = [data.schools[0]];
const act = (date: string, type = 'call'): ActivityRecord => ({ id: date, schoolId: one[0].id, activityType: type, date: `${date}T12:00:00`, description: '' });
check('quiet starts the day after the 6-month line', () => {
  assert.deepEqual(gaps(one, [act('2026-04-27')], TODAY).quietIds, []);
  assert.deepEqual(gaps(one, [act('2026-04-26')], TODAY).quietIds, ['s1']);
});
check('follow-up counts on day 60, not day 61; attendance and rows of the same event never count', () => {
  const ev = [data.events[0]];
  const range = { start: '2026-01-01', end: TODAY };
  const attended: ActivityRecord = { ...act('2026-09-01', 'event_participation'), id: 'att', importBatchId: 'b', eventId: ev[0].id, attendeeCount: 2 };
  const followed = (rows: ActivityRecord[]) => eventImpact(ev, [attended, ...rows], one, range, TODAY)[0].followedIds;
  assert.deepEqual(followed([act('2026-10-31')]), ['s1']);
  assert.deepEqual(followed([act('2026-11-01')]), []);
  assert.deepEqual(followed([act('2026-09-01')]), [], 'same day is not after');
  assert.deepEqual(followed([act('2026-09-10', 'event_participation')]), []);
  assert.deepEqual(followed([{ ...act('2026-09-10'), eventId: ev[0].id }]), [], 'a row of the same event');
  assert.deepEqual(eventImpact(ev, [act('2026-09-10')], one, range, TODAY), [], 'no imported attendance: not ranked');
});

console.log('IL / MO');
check('Missouri only: its schools, its contacts, and events placed by school or location', () => {
  const mo = reportSnapshot(scopeToRegion(data, 'MO'), FALL, TODAY);
  const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, mo[k]]));
  assert.deepEqual(pick(['schools.total', 'reach.engaged', 'activity.total', 'contacts.total', 'coverage.without', 'events.upcoming', 'events.past', 'gaps.never', 'gaps.quiet', 'health.not_dated']), {
    'schools.total': 3, 'reach.engaged': 1, 'activity.total': 1, 'contacts.total': 2, 'coverage.without': 1,
    'events.upcoming': 1, 'events.past': 0, 'gaps.never': 0, 'gaps.quiet': 1, 'health.not_dated': 1,
  });
});
check('Illinois plus Missouri add up to All for every per-school figure', () => {
  const all = reportSnapshot(data, FALL, TODAY);
  const il = reportSnapshot(scopeToRegion(data, 'IL'), FALL, TODAY);
  const mo = reportSnapshot(scopeToRegion(data, 'MO'), FALL, TODAY);
  for (const k of ['schools.total', 'reach.engaged', 'activity.total', 'contacts.total', 'coverage.without', 'gaps.never', 'health.not_dated']) {
    assert.equal(il[k] + mo[k], all[k], k);
  }
});

console.log('Lists behind the figures');
check('every list has exactly as many rows as its figure', () => {
  const lists = listBuilders(data, FALL.end);
  const r = reach(data.schools, data.activities, FALL);
  const c = contactCoverage(data.schools, data.contacts);
  const g = gaps(data.schools, data.activities, FALL.end);
  assert.equal(lists.schools(r.engagedIds, 't', 's', 'f').rows.length, r.engagedIds.length);
  assert.equal(lists.schools(c.withoutIds, 't', 's', 'f').rows.length, c.withoutIds.length);
  assert.equal(lists.schools(g.neverIds, 't', 's', 'f').rows.length, g.neverIds.length);
  assert.equal(lists.contacts(c.activeContactIds, 't', 's', 'f').rows.length, c.activeContactIds.length);
  const imp = eventImpact(data.events, data.activities, data.schools, FALL, TODAY);
  assert.equal(lists.events(imp.map((x) => x.eventId), 't', 's', 'f').rows.length, imp.length);
});
check('a school row shows its active contacts and last activity, and links to the school', () => {
  const row = listBuilders(data, FALL.end).schools(['s1'], 't', 's', 'f').rows[0];
  assert.deepEqual(row.cells, { school: 'Alpha High School', county: 'Madison', state: 'IL', contacts: 2, last: 'Oct 20, 2026' });
  assert.equal(row.link, '/schools/s1');
});
check('an activity row names its event and its visitor count', () => {
  const row = listBuilders(data, FALL.end).activities(['a4'], 't', 's', 'f').rows[0];
  assert.deepEqual(row.cells, { date: 'Oct 3, 2026', school: 'Charlie High School', type: 'Event attendance', event: 'Robotics Day', visitors: 12 });
});
check('CSV: header row, quotes around commas, quotes and line breaks, and a BOM for Excel', () => {
  const csv = listToCsv({ title: '', subtitle: '', filename: 'x', columns: [{ key: 'a', label: 'Name' }, { key: 'b', label: 'N' }],
    rows: [{ cells: { a: 'Smith, "Jo"', b: 3 } }, { cells: { a: 'Two\nlines', b: '' } }] });
  assert.equal(csv, '﻿Name,N\r\n"Smith, ""Jo""",3\r\n"Two\nlines",');
});
check('shares and counts read naturally', () => {
  assert.deepEqual([pctText(2, 1688), pctText(0, 1688), pctText(1559, 1688)], ['under 1%', '0%', '92%']);
  assert.deepEqual([activityCount('call', 1), activityCount('visit', 3), activityCount('event_participation', 2)], ['1 phone call', '3 visits', '2 attendance rows']);
});


console.log('Priorities: four lists that never overlap');
{
  const T = '2026-10-27';
  const sch = (id: string, county = 'Madison', extra: Partial<School> = {}): School => ({
    id, name: `School ${id}`, county, address: '', city: '', state: 'IL', zipCode: '', schoolType: 'high_school',
    isActive: true, priorityTier: 'standard', createdAt: '', updatedAt: '', ...extra,
  } as School);
  const con = (schoolId: string, isActive = true): Contact => ({ id: `c-${schoolId}`, schoolId, isActive } as Contact);
  const a = (id: string, schoolId: string, day: string, activityType: string, eventId?: string): ActivityRecord =>
    ({ id, schoolId, date: `${day}T12:00:00`, activityType, description: '', eventId });
  const ev = (id: string, day: string, schools: string[]): AppEvent =>
    ({ id, name: id, type: 'other', date: `${day}T18:00:00`, location: '', participatingSchools: schools, createdAt: '', updatedAt: '' } as unknown as AppEvent);
  const schools = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'].map((id) => sch(id, id === 's6' ? 'Cook' : 'Madison', id === 's6' ? { sourceStatus: 'working' } : {}));
  const contacts = [con('s1'), con('s2'), con('s3'), con('s5'), con('s7'), con('s8'), con('s4', false)];
  const acts = [
    a('a1', 's1', '2026-10-20', 'event_participation', 'e_1'),   // attended a week ago, nothing since
    a('a2', 's2', '2026-09-01', 'event_participation', 'e_1'),
    a('a3', 's2', '2026-09-10', 'call'),                          // followed up: on no list
    a('a4', 's3', '2026-03-01', 'call'),                          // nothing since March: quiet
    a('a5', 's4', '2026-10-01', 'visit'),                         // contacted, but no active contact
    a('a6', 's7', '2026-11-01', 'visit'),                         // future-dated: doesn't count
    a('a7', 's8', '2026-08-01', 'event_participation', 'e_1'),   // window closed (87 days), recent enough: no list
  ];
  const events = [ev('e_1', '2026-10-20', []), ev('e_2', '2026-11-05', ['s5'])];
  const L = priorityLists(schools, contacts, acts, events, T);
  // T = Oct 27: the window is Aug 28 – Oct 27.
  check('recently in touch: any activity in the last 60 days, oldest first, with date and type', () => {
    assert.equal(L.windowFrom, '2026-08-28');
    assert.deepEqual(L.recent.map((x) => [x.schoolId, x.lastDay, x.lastType, x.daysLeft]), [
      ['s2', '2026-09-10', 'call', 13],
      ['s4', '2026-10-01', 'visit', 34],
      ['s1', '2026-10-20', 'event_participation', 53],
    ]);
  });
  check('outside the window (s8 Aug 1, s3 March) and future-dated (s7 Nov 1) are not recent', () => {
    const ids = L.recent.map((x) => x.schoolId);
    for (const id of ['s3', 's7', 's8']) assert.equal(ids.includes(id), false, id);
  });
  check('never reached out: contacts, nothing logged (future-dated ignored), upcoming event first', () => {
    assert.deepEqual(L.neverReached.map((x) => [x.schoolId, x.upcoming?.eventId ?? null]), [['s5', 'e_2'], ['s7', null]]);
  });
  check('no contact person: an inactive contact counts as none; a working website first', () => {
    // s4 has no active contact but was contacted on Oct 1, so it's in Recently in touch.
    assert.deepEqual(L.noContact.map((x) => x.schoolId), ['s6']);
  });
  check('the lists never overlap; a school whose last contact is older than 60 days is on none', () => {
    const all = [...L.recent, ...L.neverReached, ...L.noContact].map((x) => x.schoolId);
    assert.equal(new Set(all).size, all.length);
    assert.deepEqual(schools.map((s) => s.id).filter((id) => !all.includes(id)), ['s3', 's8']);
  });
  check('county gaps: no contact person and never contacted, counted separately', () => {
    const g = countyGaps(schools, contacts, acts, T, (s) => s.county, (s) => s.county);
    assert.deepEqual(g.map((x) => [x.county, x.total, x.withContact, x.neverContacted]), [['Madison', 7, 6, 2]]);
  });
  check('attendance: imported attendance counts as being at the event, listed or not', () => {
    const att = attendanceByEvent(acts, T);
    assert.deepEqual([...att.get('e_1')!].sort(), ['s1', 's2', 's8']);
    assert.deepEqual(schoolsAtEvent(events[1], att), ['s5']);
    assert.deepEqual(schoolsAtEvent(events[0], att).sort(), ['s1', 's2', 's8']);
  });
  check('county figures: every contact the app places, active vs on file, events listed or attended', () => {
    // Like Adair, MO: people placed only by school_worked_at count too (the view missed them).
    const people = [con('s1'), con('s1'), con('s1'), con('s2'), { ...con('s3'), isActive: false }];
    const rows = countySummaryFromData(schools, people, events, [...acts, a('u3', 's3', '2026-10-02', 'event_participation')], [{ schoolId: 's1' }], T);
    const mad = rows.find((r) => r.county_name === 'Madison')!;
    assert.deepEqual([mad.total_schools, mad.total_contacts, mad.contacts_on_file, mad.total_programs], [7, 4, 5, 1]);
    // e_1 (attended by s1, s2, s8) and one unlinked attendance import (s3); e_2 lists s5 but is upcoming and still counts as listed.
    assert.equal(mad.total_events, 3);
  });
  check('attendance with no event linked still counts as attending; future-dated does not', () => {
    const more = [...acts, a('u1', 's6', '2026-10-01', 'event_participation'), a('u2', 's5', '2026-12-01', 'event_participation')];
    assert.deepEqual([...unlinkedAttendance(more, T)], [['s6', 1]]);
    assert.deepEqual([...schoolsWithAttendance(more, T)].sort(), ['s1', 's2', 's6', 's8']);
  });
}

console.log('Last updated and Verified (db/027)');
{
  const now = new Date('2026-11-12T12:00:00');
  const base = { id: 'x', name: 'X', county: '', address: '', city: '', state: 'IL', zipCode: '', schoolType: 'high_school', isActive: true, createdAt: '', updatedAt: '' } as School;
  check('"Last updated <date> by <who>", the date only when nobody is recorded', () => {
    assert.equal(lastUpdatedText('2026-11-01T05:00:00Z', 'a@siue.edu'), 'Last updated Nov 1, 2026 by a@siue.edu');
    assert.equal(lastUpdatedText('2026-11-01T05:00:00Z', undefined), 'Last updated Nov 1, 2026');
    assert.equal(lastUpdatedText('2026-11-01T05:00:00Z', 'database'), 'Last updated Nov 1, 2026 by the scraper or database');
    assert.equal(lastUpdatedText(undefined, undefined), 'Last updated: not recorded');
  });
  check('the amber flag: not updated in over 12 months; verification age is never flagged', () => {
    assert.deepEqual(schoolFreshness({ ...base, lastUpdatedAt: '2025-11-13T12:00:00Z' }, now), []);
    assert.deepEqual(schoolFreshness({ ...base, lastUpdatedAt: '2025-11-11T12:00:00Z', updatedBy: 'b@siue.edu' }, now).map((f) => [f.label, f.detail]),
      [['Not updated in over 12 months', 'Last updated Nov 11, 2025 by b@siue.edu']]);
    // Verified two years ago, updated recently: nothing to flag.
    assert.deepEqual(contactFreshness({ id: 'c', schoolId: 'x', isActive: true, isVerified: true, lastVerifiedAt: '2024-11-01T00:00:00Z', lastUpdatedAt: '2026-10-01T00:00:00Z' } as Contact, now), []);
  });
  check('Verify / Unverify wording shows who and when', () => {
    assert.equal(verificationText(true, '2026-11-12T15:00:00Z', 'a@siue.edu'), 'Verified Nov 12, 2026 by a@siue.edu');
    assert.equal(verificationText(false, '2026-11-12T15:00:00Z', 'a@siue.edu'), 'Marked unverified Nov 12, 2026 by a@siue.edu');
    assert.equal(verificationText(false, undefined, undefined), undefined);
  });
}

console.log('Meeting summary and Export CSV');
check('the meeting summary shows the same figures as the Reports page for the same term', () => {
  const snap = reportSnapshot(data, FALL, TODAY);
  const m = meetingSummary(data, FALL, TODAY);
  assert.deepEqual(
    [m.headline.schools, m.headline.reached, m.headline.firstTime, m.headline.activities, m.headline.visitors],
    [snap['schools.total'], snap['reach.engaged'], snap['reach.first_time'], snap['activity.total'], snap['activity.visitors']]);
  assert.deepEqual([m.events.past, m.events.upcoming, m.events.withAttendance, m.events.visitorsAtEvents],
    [snap['events.past'], snap['events.upcoming'], snap['impact.events'], snap['impact.visitors']]);
  assert.deepEqual([m.followUps.schools, m.followUps.followed], [snap['impact.schools'], snap['impact.followed']]);
  assert.deepEqual([m.gaps.neverContacted, m.gaps.quiet, m.gaps.untouchedCounties], [snap['gaps.never'], snap['gaps.quiet'], snap['gaps.untouched_counties']]);
  assert.equal(m.mix.reduce((n, x) => n + x.count, 0), snap['activity.total']);
  assert.equal(m.followUps.byEvent.length, snap['impact.events']);
});
check("the meeting summary's Priorities counts are the Priorities page's", () => {
  const m = meetingSummary(data, FALL, TODAY);
  const p = priorityLists(data.schools, data.contacts, data.activities, data.events, TODAY);
  assert.deepEqual([m.priorities.recentlyInTouch, m.priorities.neverReached, m.priorities.noContactPerson],
    [p.recent.length, p.neverReached.length, p.noContact.length]);
});
check('Export CSV: header row, quotes around commas, quotes and line breaks, a BOM, blanks for missing values', () => {
  type R = { n: string; c?: number };
  const csv = toCsv([{ label: 'Name', value: (r: R) => r.n }, { label: 'Count', value: (r: R) => r.c }],
    [{ n: 'A, "B"', c: 2 }, { n: 'Line\nbreak' }]);
  assert.equal(csv, '﻿Name,Count\r\n"A, ""B""",2\r\n"Line\nbreak",');
  assert.equal(csvFilename('Priorities: Recently in touch', new Date('2026-11-13T10:00:00')), 'priorities-recently-in-touch-2026-11-13.csv');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
