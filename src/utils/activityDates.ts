import { addYears, format } from 'date-fns';
import type { ActivityRecord } from '../types';

// An activity can be dated up to a year ahead: a visit or an event that is planned,
// such as a list of people coming tomorrow. Until its day it is "Upcoming": shown in
// the school's Activity History, but counted nowhere (Reports, Priorities, the
// engagement score, the Schools columns, the Dashboard) and never the "last contact".

/** Today as "yyyy-MM-dd", in the browser's time zone. */
export function todayDay(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}

/** The latest date an activity can have: one year from today. */
export function latestActivityDay(now: Date = new Date()): string {
  return format(addYears(now, 1), 'yyyy-MM-dd');
}

/** The rule for an activity date typed in a form: '' when it's fine. */
export function activityDateError(day: string, now: Date = new Date()): string {
  if (!day) return 'Choose the date';
  if (day > latestActivityDay(now)) return 'The date can’t be more than a year ahead';
  return '';
}

/** True once the activity's day has come: only these are counted. */
export function hasHappened(activity: Pick<ActivityRecord, 'date'>, today: string = todayDay()): boolean {
  return activity.date.slice(0, 10) <= today;
}

/** The activities whose day has come (today included). */
export function happenedActivities<T extends Pick<ActivityRecord, 'date'>>(activities: T[], today: string = todayDay()): T[] {
  return activities.filter((a) => hasHappened(a, today));
}

/** The note shown under a date that is in the future. */
export function futureDateNote(day: string): string {
  const shown = format(new Date(`${day}T12:00:00`), 'MMM d, yyyy');
  return `This date is in the future. It’s saved as upcoming and won’t count in Reports or Priorities until ${shown}. Update the number of visitors after the event if it changed.`;
}
