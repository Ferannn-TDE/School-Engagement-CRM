import { isAfter, subMonths, differenceInDays } from 'date-fns';
import type { Contact, ActivityRecord, Event, Program } from '../types';

export interface EngagementResult {
  score: number;
  tier: 'high' | 'medium' | 'low';
  recommendations: string[];
}

export function computeEngagementScore(
  contacts: Contact[],
  activities: ActivityRecord[],
  events: Event[],
  programs: Program[]
): EngagementResult {
  const now = new Date();
  const sixMonthsAgo = subMonths(now, 6);

  const activeContacts = contacts.filter((c) => c.isActive);
  const recentActivities = activities.filter((a) => isAfter(new Date(a.date), sixMonthsAgo));
  const activePrograms = programs.filter((p) => p.isActive);

  // Scoring: each category capped so total is 0–100
  const contactPts = Math.min(activeContacts.length, 3) * 10;   // 0–30
  const activityPts = Math.min(recentActivities.length, 3) * 10; // 0–30
  const eventPts = Math.min(events.length, 2) * 10;              // 0–20
  const programPts = Math.min(activePrograms.length, 2) * 10;    // 0–20
  const score = contactPts + activityPts + eventPts + programPts;

  const tier: 'high' | 'medium' | 'low' =
    score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';

  const recommendations: string[] = [];

  if (activeContacts.length === 0) {
    recommendations.push('No active contacts — reach out to establish a school liaison.');
  } else if (activeContacts.length === 1) {
    recommendations.push('Only 1 active contact — consider building a broader relationship at this school.');
  }

  if (recentActivities.length === 0) {
    if (activities.length > 0) {
      const latest = activities.reduce((a, b) =>
        new Date(a.date) > new Date(b.date) ? a : b
      );
      const daysSince = differenceInDays(now, new Date(latest.date));
      recommendations.push(
        `No activity in the last 6 months — last contact was ${daysSince} day${daysSince !== 1 ? 's' : ''} ago.`
      );
    } else {
      recommendations.push('No activity logged yet — schedule an initial outreach visit or call.');
    }
  }

  if (events.length === 0) {
    recommendations.push(
      'This school has never appeared at an event — invite them to an upcoming fair or campus visit.'
    );
  }

  if (activePrograms.length === 0) {
    recommendations.push(
      'No STEM programs recorded — survey the school to identify CS, engineering, or robotics offerings.'
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      'Strong engagement — maintain regular contact and continue inviting this school to events.'
    );
  }

  return { score, tier, recommendations };
}
