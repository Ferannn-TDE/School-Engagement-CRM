/**
 * The Reports page's figures, as plain functions of the loaded data, so each can be
 * tested and checked against the database (db/checks/reports_checks.sql gives the
 * same figures from SQL; scripts/verify-reports-sql.ts compares the two).
 *
 * Every figure comes with the ids behind it, so the number on the page and the list
 * it opens are the same thing and can't disagree.
 *
 * Dates are compared as "YYYY-MM-DD" day strings, never as Date objects, so a
 * date-only value can't shift a day across time zones. The functions take data
 * already limited to the IL/MO choice (scopeToRegion) and read no clock: "today" is
 * always passed in.
 */
import type { ActivityRecord, Contact, Event, School } from '../types';
import { isTestingDate } from './events';
import {
  EVENT_ATTENDANCE_TYPE,
  FOLLOW_UP_DAYS,
  QUIET_MONTHS,
  SCHOOL_YEAR_START,
  SIUE_TERMS,
  VERIFIED_RECENT_MONTHS,
  type Term,
} from '../constants/reportSettings';

/** A calendar day, "YYYY-MM-DD". */
export type Day = string;

export interface DayRange {
  start: Day;
  end: Day;
}

// ── Days ────────────────────────────────────────────────────────────────────────

/** The day part of a stored date or timestamp ("2026-09-28T12:00:00" → "2026-09-28"). */
export function dayOf(value: string): Day {
  return value.slice(0, 10);
}

function parts(day: Day): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

function fromUTC(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = parts(day);
  return fromUTC(Date.UTC(y, m - 1, d + n));
}

/** Months later or earlier, clamped to the month's last day (Mar 31 − 1 month = Feb 28). */
export function addMonths(day: Day, n: number): Day {
  const [y, m, d] = parts(day);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(y, m - 1 + n, Math.min(d, lastDay)));
}

export function daysBetween(from: Day, to: Day): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function inRange(day: Day, range: DayRange): boolean {
  return day >= range.start && day <= range.end;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

/** "Sep 28, 2026". */
export function formatDay(day: Day): string {
  const [y, m, d] = parts(day);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

/** "Aug 24 – Oct 27, 2026", or with both years when they differ. */
export function formatRange(range: DayRange): string {
  const [y1, m1, d1] = parts(range.start);
  const y2 = parts(range.end)[0];
  const left = y1 === y2 ? `${MONTHS[m1 - 1].slice(0, 3)} ${d1}` : formatDay(range.start);
  return `${left} – ${formatDay(range.end)}`;
}

/** "2026-09" for a day. */
export function monthOf(day: Day): string {
  return day.slice(0, 7);
}

/** "September 2026" for "2026-09". */
export function formatMonth(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

// ── Date ranges ─────────────────────────────────────────────────────────────────

export type RangePreset = 'month' | 'semester' | 'year' | 'custom';

export interface ReportRange extends DayRange {
  preset: RangePreset;
  /** What the range is called on the page: "Fall 2026", "October 2026". */
  label: string;
  /** The period's own last day. `end` stops at today when the period isn't over. */
  periodEnd: Day;
}

/**
 * The days a preset covers, up to today. "This semester" is the SIUE term holding
 * today, or the last one to end when today falls between terms; "This year" is the
 * school year (Aug 1 – Jul 31). A custom range is used as given (start ≤ end).
 */
export function resolveRange(
  preset: RangePreset,
  today: Day,
  custom?: DayRange,
  terms: Term[] = SIUE_TERMS,
): ReportRange {
  const upToToday = (periodEnd: Day) => (periodEnd < today ? periodEnd : today);

  if (preset === 'custom' && custom && custom.start <= custom.end) {
    return { preset, start: custom.start, end: custom.end, periodEnd: custom.end, label: formatRange(custom) };
  }
  if (preset === 'semester') {
    const current = terms.find((t) => inRange(today, t));
    const term = current ?? [...terms].filter((t) => t.end < today).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (term) {
      return { preset, start: term.start, end: upToToday(term.end), periodEnd: term.end, label: term.name };
    }
  }
  if (preset === 'year') {
    const [y, m, d] = parts(today);
    const startYear = m > SCHOOL_YEAR_START.month || (m === SCHOOL_YEAR_START.month && d >= SCHOOL_YEAR_START.day) ? y : y - 1;
    const start = `${startYear}-${String(SCHOOL_YEAR_START.month).padStart(2, '0')}-${String(SCHOOL_YEAR_START.day).padStart(2, '0')}`;
    const periodEnd = addDays(addMonths(start, 12), -1);
    return { preset, start, end: upToToday(periodEnd), periodEnd, label: `School year ${startYear}–${String(startYear + 1).slice(2)}` };
  }
  // 'month', and the fallback when no term is on the calendar yet.
  const start = `${today.slice(0, 8)}01`;
  const periodEnd = addDays(addMonths(start, 1), -1);
  return { preset: 'month', start, end: today, periodEnd, label: formatMonth(monthOf(today)) };
}

export interface Comparison {
  kind: 'last-year' | 'previous' | 'none';
  range: DayRange | null;
  /** Always shown next to a comparison: what it is compared with, or why there's none. */
  label: string;
}

/**
 * What a range is compared with: the same dates last year when logging covered all
 * of them, otherwise the same number of days just before, otherwise nothing. A
 * period from before logging started would read as a false zero, so it's never used.
 */
export function comparisonFor(range: DayRange, loggingStart: Day | null): Comparison {
  const covered = (r: DayRange) => loggingStart !== null && loggingStart <= r.start;
  const lastYear = { start: addMonths(range.start, -12), end: addMonths(range.end, -12) };
  if (covered(lastYear)) {
    return { kind: 'last-year', range: lastYear, label: `the same dates last year (${formatRange(lastYear)})` };
  }
  const length = daysBetween(range.start, range.end) + 1;
  const previous = { start: addDays(range.start, -length), end: addDays(range.start, -1) };
  if (covered(previous)) {
    return { kind: 'previous', range: previous, label: `the ${length} days before (${formatRange(previous)})` };
  }
  return {
    kind: 'none',
    range: null,
    label: loggingStart
      ? `No comparison yet: outreach logging started ${formatDay(loggingStart)}`
      : 'No comparison yet: no outreach has been logged',
  };
}

// ── Outreach logging ────────────────────────────────────────────────────────────

export interface LoggingStatus {
  /** The first logged activity's day, or null when nothing is logged. */
  start: Day | null;
  total: number;
}

/** When logging started and how much there is. Pass every activity, not one state's. */
export function loggingStatus(activities: ActivityRecord[]): LoggingStatus {
  let start: Day | null = null;
  for (const a of activities) {
    const d = dayOf(a.date);
    if (start === null || d < start) start = d;
  }
  return { start, total: activities.length };
}

// ── Reach ───────────────────────────────────────────────────────────────────────

/** Activities whose school is on the list (an archived school's activities aren't). */
function onListedSchools(activities: ActivityRecord[], schools: School[]): ActivityRecord[] {
  const ids = new Set(schools.map((s) => s.id));
  return activities.filter((a) => ids.has(a.schoolId));
}

/** Each school's first logged activity day. */
export function firstActivityDays(activities: ActivityRecord[]): Map<string, Day> {
  const first = new Map<string, Day>();
  for (const a of activities) {
    const d = dayOf(a.date);
    const seen = first.get(a.schoolId);
    if (!seen || d < seen) first.set(a.schoolId, d);
  }
  return first;
}

export interface StateCount {
  total: number;
  ids: string[];
}

export interface Reach {
  totalSchools: number;
  /** Schools with at least one logged activity in the range (any type). */
  engagedIds: string[];
  /** Engaged schools whose first-ever activity is in the range. */
  firstTimeIds: string[];
  /** Per state: its schools, and the engaged ones. */
  byState: Record<string, StateCount>;
}

/**
 * Engaged = at least one logged activity in the range, bulk-imported attendance
 * included. Being listed on an event doesn't count.
 */
export function reach(schools: School[], activities: ActivityRecord[], range: DayRange): Reach {
  const listed = onListedSchools(activities, schools);
  const engaged = new Set(listed.filter((a) => inRange(dayOf(a.date), range)).map((a) => a.schoolId));
  const first = firstActivityDays(listed);
  const byState: Record<string, StateCount> = {};
  for (const s of schools) {
    const entry = (byState[s.state || '(none)'] ??= { total: 0, ids: [] });
    entry.total++;
    if (engaged.has(s.id)) entry.ids.push(s.id);
  }
  const engagedIds = schools.filter((s) => engaged.has(s.id)).map((s) => s.id);
  return {
    totalSchools: schools.length,
    engagedIds,
    firstTimeIds: engagedIds.filter((id) => inRange(first.get(id)!, range)),
    byState,
  };
}

// ── Activity ────────────────────────────────────────────────────────────────────

export interface ActivitySummary {
  /** Activity ids in the range, on listed schools. */
  ids: string[];
  /** Activity ids by activity_type. */
  byType: Record<string, string[]>;
  /** Students at events: the sum of bulk-imported attendee counts. */
  students: number;
  /** The bulk-imported attendance rows those students come from. */
  studentRowIds: string[];
}

export function activitySummary(activities: ActivityRecord[], schools: School[], range: DayRange): ActivitySummary {
  const rows = onListedSchools(activities, schools).filter((a) => inRange(dayOf(a.date), range));
  const byType: Record<string, string[]> = {};
  for (const a of rows) (byType[a.activityType] ??= []).push(a.id);
  const studentRows = rows.filter((a) => a.importBatchId && a.attendeeCount);
  return {
    ids: rows.map((a) => a.id),
    byType,
    students: studentRows.reduce((sum, a) => sum + (a.attendeeCount ?? 0), 0),
    studentRowIds: studentRows.map((a) => a.id),
  };
}

export interface MonthRow {
  month: string;
  activityIds: string[];
  byType: Record<string, number>;
  /** Schools with activity that month, and those whose first-ever activity it was. */
  schoolIds: string[];
  newSchoolIds: string[];
  students: number;
}

export interface Monthly {
  months: MonthRow[];
  /** Months in the range with at least one activity: the trend chart needs MIN_MONTHS_FOR_TREND. */
  monthsWithData: number;
}

/** One row per calendar month the range touches, oldest first. */
export function monthly(activities: ActivityRecord[], schools: School[], range: DayRange): Monthly {
  const listed = onListedSchools(activities, schools);
  const first = firstActivityDays(listed);
  const months: MonthRow[] = [];
  for (let m = monthOf(range.start); m <= monthOf(range.end); m = monthOf(addMonths(`${m}-01`, 1))) {
    months.push({ month: m, activityIds: [], byType: {}, schoolIds: [], newSchoolIds: [], students: 0 });
  }
  const index = new Map(months.map((row) => [row.month, row]));
  for (const a of listed) {
    const d = dayOf(a.date);
    if (!inRange(d, range)) continue;
    const row = index.get(monthOf(d))!;
    row.activityIds.push(a.id);
    row.byType[a.activityType] = (row.byType[a.activityType] ?? 0) + 1;
    if (!row.schoolIds.includes(a.schoolId)) {
      row.schoolIds.push(a.schoolId);
      if (monthOf(first.get(a.schoolId)!) === row.month) row.newSchoolIds.push(a.schoolId);
    }
    if (a.importBatchId && a.attendeeCount) row.students += a.attendeeCount;
  }
  return { months, monthsWithData: months.filter((row) => row.activityIds.length > 0).length };
}

// ── Contact coverage ────────────────────────────────────────────────────────────

export interface CountyCoverage {
  state: string;
  county: string;
  schoolIds: string[];
  /** Schools here with no active contact. */
  withoutIds: string[];
}

export interface ContactCoverage {
  /** Contacts on listed schools, and the active ones. */
  contactIds: string[];
  activeContactIds: string[];
  /** Schools with at least one active contact, and those with none. */
  withIds: string[];
  withoutIds: string[];
  byState: Record<string, { total: number; withoutIds: string[] }>;
  /** Lowest share covered first, then the most schools. */
  byCounty: CountyCoverage[];
  /** Schools by how many active contacts they have: "0", "1", "2-5", "6-15", "16+". */
  buckets: Record<string, string[]>;
}

export const NO_COUNTY = '(no county)';

function bucket(n: number): string {
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 15) return '6-15';
  return '16+';
}

export function contactCoverage(schools: School[], contacts: Contact[]): ContactCoverage {
  const ids = new Set(schools.map((s) => s.id));
  const listed = contacts.filter((c) => ids.has(c.schoolId));
  const active = listed.filter((c) => c.isActive);
  const perSchool = new Map<string, number>();
  for (const c of active) perSchool.set(c.schoolId, (perSchool.get(c.schoolId) ?? 0) + 1);

  const byState: ContactCoverage['byState'] = {};
  const counties = new Map<string, CountyCoverage>();
  const buckets: Record<string, string[]> = { '0': [], '1': [], '2-5': [], '6-15': [], '16+': [] };
  for (const s of schools) {
    const n = perSchool.get(s.id) ?? 0;
    const st = (byState[s.state || '(none)'] ??= { total: 0, withoutIds: [] });
    st.total++;
    const county = s.county.trim() || NO_COUNTY;
    const key = `${s.state}|${county}`;
    const c = counties.get(key) ?? { state: s.state, county, schoolIds: [], withoutIds: [] };
    c.schoolIds.push(s.id);
    if (n === 0) {
      st.withoutIds.push(s.id);
      c.withoutIds.push(s.id);
    }
    counties.set(key, c);
    buckets[bucket(n)].push(s.id);
  }
  const share = (c: CountyCoverage) => (c.schoolIds.length - c.withoutIds.length) / c.schoolIds.length;
  return {
    contactIds: listed.map((c) => c.id),
    activeContactIds: active.map((c) => c.id),
    withIds: schools.filter((s) => perSchool.has(s.id)).map((s) => s.id),
    withoutIds: schools.filter((s) => !perSchool.has(s.id)).map((s) => s.id),
    byState,
    byCounty: [...counties.values()].sort((a, b) => share(a) - share(b) || b.schoolIds.length - a.schoolIds.length
      || (a.state + a.county).localeCompare(b.state + b.county)),
    buckets,
  };
}

// ── Events ──────────────────────────────────────────────────────────────────────

export interface EventSummary {
  /** Outreach events (testing dates left out) in the range that have happened (day ≤ today). */
  pastIds: string[];
  /** Outreach events from today on, soonest first, with no end. */
  upcomingIds: string[];
  upcomingByMonth: Record<string, number>;
  /** Upcoming events that list at least one school. */
  upcomingWithSchoolsIds: string[];
}

export function eventSummary(events: Event[], range: DayRange, today: Day): EventSummary {
  const outreach = events.filter((e) => !isTestingDate(e));
  const upcoming = outreach
    .filter((e) => dayOf(e.date) >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  const upcomingByMonth: Record<string, number> = {};
  for (const e of upcoming) upcomingByMonth[monthOf(dayOf(e.date))] = (upcomingByMonth[monthOf(dayOf(e.date))] ?? 0) + 1;
  return {
    pastIds: outreach.filter((e) => inRange(dayOf(e.date), range) && dayOf(e.date) < today).map((e) => e.id),
    upcomingIds: upcoming.map((e) => e.id),
    upcomingByMonth,
    upcomingWithSchoolsIds: upcoming.filter((e) => e.participatingSchools.length > 0).map((e) => e.id),
  };
}

export interface EventFollowUp {
  eventId: string;
  day: Day;
  /** Listed schools that are on the schools list. */
  schoolIds: string[];
  /** Of those, the ones with a call, email or visit within FOLLOW_UP_DAYS after. */
  followedIds: string[];
  /** The follow-up window hasn't closed yet: the rate isn't final. */
  windowOpen: boolean;
}

/**
 * For each outreach event in the range that has happened: did each listed school get
 * a call, email or visit in the FOLLOW_UP_DAYS days after it? Attendance rows don't
 * count as follow-up.
 */
export function eventFollowUps(events: Event[], activities: ActivityRecord[], schools: School[], range: DayRange, today: Day): EventFollowUp[] {
  const ids = new Set(schools.map((s) => s.id));
  const contacts = onListedSchools(activities, schools).filter((a) => a.activityType !== EVENT_ATTENDANCE_TYPE);
  return events
    .filter((e) => !isTestingDate(e) && inRange(dayOf(e.date), range) && dayOf(e.date) < today)
    .map((e) => {
      const day = dayOf(e.date);
      const until = addDays(day, FOLLOW_UP_DAYS);
      const schoolIds = [...new Set(e.participatingSchools)].filter((id) => ids.has(id));
      const followedIds = schoolIds.filter((id) => contacts.some((a) => a.schoolId === id && dayOf(a.date) > day && dayOf(a.date) <= until));
      return { eventId: e.id, day, schoolIds, followedIds, windowOpen: until >= today };
    })
    .sort((a, b) => b.schoolIds.length - a.schoolIds.length || (a.day < b.day ? 1 : a.day > b.day ? -1 : a.eventId.localeCompare(b.eventId)));
}

// ── Coverage gaps ───────────────────────────────────────────────────────────────

export interface Gaps {
  /** Schools with no activity on or before asOf. */
  neverIds: string[];
  /** Schools whose last activity is more than QUIET_MONTHS before asOf. */
  quietIds: string[];
  /** "State|County" keys of counties where no school has any activity. */
  untouchedCounties: string[];
  /** The day a school's last activity must be before to count as quiet. */
  quietBefore: Day;
}

export function gaps(schools: School[], activities: ActivityRecord[], asOf: Day): Gaps {
  const last = new Map<string, Day>();
  for (const a of onListedSchools(activities, schools)) {
    const d = dayOf(a.date);
    if (d > asOf) continue;
    const seen = last.get(a.schoolId);
    if (!seen || d > seen) last.set(a.schoolId, d);
  }
  const quietBefore = addMonths(asOf, -QUIET_MONTHS);
  const touched = new Set<string>();
  const all = new Set<string>();
  for (const s of schools) {
    const key = `${s.state}|${s.county.trim() || NO_COUNTY}`;
    all.add(key);
    if (last.has(s.id)) touched.add(key);
  }
  return {
    neverIds: schools.filter((s) => !last.has(s.id)).map((s) => s.id),
    quietIds: schools.filter((s) => last.has(s.id) && last.get(s.id)! < quietBefore).map((s) => s.id),
    untouchedCounties: [...all].filter((k) => !touched.has(k)).sort(),
    quietBefore,
  };
}

// ── Data health ─────────────────────────────────────────────────────────────────

export interface DataHealth {
  /** Contacts on listed schools by when they were last verified. */
  verifiedRecentIds: string[];
  verifiedOlderIds: string[];
  neverVerifiedIds: string[];
  /** Contacts the scraper has ever seen. */
  scrapedContactIds: string[];
  /** Schools by the scraper's last check of their website; "unchecked" when never checked. */
  siteStatus: Record<string, string[]>;
  noCountyIds: string[];
  /** The day a verification must be on or after to count as recent. */
  recentFrom: Day;
}

export function dataHealth(schools: School[], contacts: Contact[], asOf: Day): DataHealth {
  const ids = new Set(schools.map((s) => s.id));
  const listed = contacts.filter((c) => ids.has(c.schoolId));
  const recentFrom = addMonths(asOf, -VERIFIED_RECENT_MONTHS);
  const verified = (c: Contact) => (c.lastVerifiedAt ? dayOf(c.lastVerifiedAt) : null);
  const siteStatus: Record<string, string[]> = { working: [], broken: [], not_found: [], unchecked: [] };
  for (const s of schools) siteStatus[s.sourceStatus ?? 'unchecked'].push(s.id);
  return {
    verifiedRecentIds: listed.filter((c) => { const v = verified(c); return v !== null && v >= recentFrom && v <= asOf; }).map((c) => c.id),
    verifiedOlderIds: listed.filter((c) => { const v = verified(c); return v !== null && v < recentFrom; }).map((c) => c.id),
    neverVerifiedIds: listed.filter((c) => verified(c) === null).map((c) => c.id),
    scrapedContactIds: listed.filter((c) => c.lastScrapedAt).map((c) => c.id),
    siteStatus,
    noCountyIds: schools.filter((s) => !s.county.trim()).map((s) => s.id),
    recentFrom,
  };
}

// ── Snapshot: every figure as a plain number ───────────────────────────────────

export interface ReportInput {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
}

/**
 * Every figure on the page as a number, keyed the same way as the JSON from
 * db/checks/reports_checks.sql, so the two can be compared key by key.
 */
export function reportSnapshot(data: ReportInput, range: DayRange, today: Day): Record<string, number> {
  const { schools, contacts, events, activities } = data;
  const r = reach(schools, activities, range);
  const act = activitySummary(activities, schools, range);
  const mon = monthly(activities, schools, range);
  const cov = contactCoverage(schools, contacts);
  const ev = eventSummary(events, range, today);
  const fu = eventFollowUps(events, activities, schools, range, today);
  const g = gaps(schools, activities, range.end);
  const h = dataHealth(schools, contacts, range.end);
  const out: Record<string, number> = {
    'schools.total': r.totalSchools,
    'reach.engaged': r.engagedIds.length,
    'reach.first_time': r.firstTimeIds.length,
    'activity.total': act.ids.length,
    'activity.students': act.students,
    'activity.student_rows': act.studentRowIds.length,
    'activity.months_with_data': mon.monthsWithData,
    'contacts.total': cov.contactIds.length,
    'contacts.active': cov.activeContactIds.length,
    'coverage.with': cov.withIds.length,
    'coverage.without': cov.withoutIds.length,
    'events.past': ev.pastIds.length,
    'events.upcoming': ev.upcomingIds.length,
    'events.upcoming_with_schools': ev.upcomingWithSchoolsIds.length,
    'followup.events': fu.length,
    'followup.schools': fu.reduce((n, e) => n + e.schoolIds.length, 0),
    'followup.followed': fu.reduce((n, e) => n + e.followedIds.length, 0),
    'followup.closed_schools': fu.filter((e) => !e.windowOpen).reduce((n, e) => n + e.schoolIds.length, 0),
    'followup.closed_followed': fu.filter((e) => !e.windowOpen).reduce((n, e) => n + e.followedIds.length, 0),
    'gaps.never': g.neverIds.length,
    'gaps.quiet': g.quietIds.length,
    'gaps.untouched_counties': g.untouchedCounties.length,
    'health.verified_recent': h.verifiedRecentIds.length,
    'health.verified_older': h.verifiedOlderIds.length,
    'health.never_verified': h.neverVerifiedIds.length,
    'health.scraped_contacts': h.scrapedContactIds.length,
    'health.no_county': h.noCountyIds.length,
  };
  for (const [state, s] of Object.entries(r.byState)) {
    out[`reach.state.${state}.total`] = s.total;
    out[`reach.state.${state}.engaged`] = s.ids.length;
  }
  for (const [state, s] of Object.entries(cov.byState)) out[`coverage.state.${state}.without`] = s.withoutIds.length;
  for (const [b, list] of Object.entries(cov.buckets)) out[`coverage.bucket.${b}`] = list.length;
  for (const c of cov.byCounty) {
    out[`coverage.county.${c.state}|${c.county}.total`] = c.schoolIds.length;
    out[`coverage.county.${c.state}|${c.county}.without`] = c.withoutIds.length;
  }
  for (const [type, list] of Object.entries(act.byType)) out[`activity.type.${type}`] = list.length;
  for (const row of mon.months) if (row.activityIds.length) {
    out[`month.${row.month}.activities`] = row.activityIds.length;
    out[`month.${row.month}.schools`] = row.schoolIds.length;
    out[`month.${row.month}.new_schools`] = row.newSchoolIds.length;
    out[`month.${row.month}.students`] = row.students;
  }
  for (const [m, n] of Object.entries(ev.upcomingByMonth)) out[`events.upcoming.${m}`] = n;
  for (const [status, list] of Object.entries(h.siteStatus)) out[`health.site.${status}`] = list.length;
  return out;
}
