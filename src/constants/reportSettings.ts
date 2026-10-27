/**
 * Settings for the Reports page. Every date range and threshold the page uses is
 * here, so a change of term dates or a rule is one edit.
 */

export interface Term {
  name: string;
  /** First and last day, "YYYY-MM-DD", both included. */
  start: string;
  end: string;
}

/**
 * SIUE's official terms, from the registrar's key dates (checked 27 Oct 2026):
 * the official start of the semester to the end of the term. Days between terms
 * (winter break, August) belong to no semester; "This semester" then shows the
 * term that just ended. Add each new term when the registrar publishes it.
 */
export const SIUE_TERMS: Term[] = [
  { name: 'Summer 2026', start: '2026-06-01', end: '2026-08-08' },
  { name: 'Fall 2026', start: '2026-08-24', end: '2026-12-18' },
  { name: 'Spring 2027', start: '2027-01-11', end: '2027-05-07' },
];

/** The school year runs Aug 1 – Jul 31. */
export const SCHOOL_YEAR_START = { month: 8, day: 1 };

/** A call, email or visit this many days after an event counts as its follow-up. */
export const FOLLOW_UP_DAYS = 60;

/** A school with no activity for this many months has gone quiet. */
export const QUIET_MONTHS = 6;

/** A contact verified within this many months counts as current. */
export const VERIFIED_RECENT_MONTHS = 6;

/** Month-by-month charts appear once this many months have activity. */
export const MIN_MONTHS_FOR_TREND = 3;

/** The activity type bulk-imported attendance lists are saved as (db/022). */
export const EVENT_ATTENDANCE_TYPE = 'event_participation';
