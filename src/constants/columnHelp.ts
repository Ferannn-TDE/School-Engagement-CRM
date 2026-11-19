import { FOLLOW_UP_DAYS, RECENT_CONTACT_DAYS } from './reportSettings';

/**
 * What unclear table headers mean, in plain words, shown from the (i) next to them.
 * SCORE and ENGAGEMENT describe computeEngagementScore() in utils/engagementScore.ts:
 * change them together.
 */
export const COLUMN_HELP = {
  score:
    'Out of 100, from four parts:\n' +
    '• Contacts: 10 points per active contact person, up to 30.\n' +
    '• Recent activity: 10 points per visit, call, email or event in the last 6 months, up to 30.\n' +
    '• Events: 10 points per event the school was listed on or attended, up to 20. An imported attendance list with no event chosen counts as one event.\n' +
    '• Programs: 10 points per active STEM program, up to 20.\n' +
    'Activities dated in the future count once their day comes.',
  engagement:
    'How engaged the school is, from its score:\n' +
    '• High: 60 to 100\n' +
    '• Medium: 30 to 59\n' +
    '• Low: 0 to 29\n' +
    'This is not the school’s priority tier (High, Standard or Low), which you set on the school form.',
  schoolActivity:
    'How many visits, calls, emails and events are logged for this school, and the date of the most recent one. Activities dated in the future count once their day comes.',
  schoolContacts: 'People on file at this school, active or not.',
  activeContacts: 'Active contact people on file at this school.',
  lastContact:
    'The date of the most recent visit, call, email or event logged for this school. “Never” means nothing has been logged yet.',
  recentLastContact:
    `The most recent visit, call, email or event, and what kind it was. A school stays on this list for ${RECENT_CONTACT_DAYS} days after it.`,
  whyHere: 'Why this school is on the list, and what to do next.',
  eventSchools: 'How many schools are listed on this event.',
  eventAttendees: 'The number of attendees typed on the event. Imported visitors are counted on the Reports page.',
  eventSource:
    'Where the event came from: added in the app, found on a school’s online calendar, or an IACAC college fair. Testing dates (SAT, ACT and similar) are school busy days, not outreach.',
  noContact: 'Schools in this county with no active contact person on file.',
  contacted: 'Schools in this county with any visit, call, email or event logged up to the end of the chosen dates, out of all its schools.',
  followedUp:
    `Schools that got a call, email or visit within ${FOLLOW_UP_DAYS} days after the event, out of the schools that attended. “Window open” means the ${FOLLOW_UP_DAYS} days aren’t over yet.`,
  schoolAsTyped: 'The school’s name exactly as it was in the uploaded file.',
  matchedSchool: 'The school in the directory this row was saved to.',
  visitors: 'How many people this row counts. A row left blank in the file is shown as 1.',
} as const;
