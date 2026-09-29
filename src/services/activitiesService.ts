import { supabase, fetchAllRows } from './supabase';
import type { ActivityRecord } from '../types';

interface ActivityRow {
  activity_id: string;
  school_id: string;
  contact_id: string | null;
  event_id: number | null;
  activity_type: string;
  date: string;
  description: string;
  outcome: string | null;
}

// The column is a plain calendar date ("2026-09-28"). new Date() reads that form as
// midnight UTC, which is the previous evening in Illinois and Missouri, so every
// caller would show the day before. Noon local time names the same day everywhere.
function toLocalDay(date: string): string {
  return `${date.slice(0, 10)}T12:00:00`;
}

// App event ids look like "e_123"; the column is an integer.
function toEventRowId(eventId: string | undefined): number | null {
  if (!eventId) return null;
  const n = parseInt(eventId.replace(/^e_/, ''), 10);
  return Number.isNaN(n) ? null : n;
}

function rowToActivity(row: ActivityRow): ActivityRecord {
  return {
    id: row.activity_id,
    schoolId: row.school_id,
    contactId: row.contact_id ?? undefined,
    eventId: row.event_id != null ? `e_${row.event_id}` : undefined,
    activityType: row.activity_type,
    date: toLocalDay(row.date),
    description: row.description,
    outcome: row.outcome ?? undefined,
  };
}

export async function fetchActivities(): Promise<ActivityRecord[]> {
  // Paged: logged contacts grow without limit, and a single request stops at 1,000.
  // Archived logged contacts (db/009) are left out.
  const rows = await fetchAllRows<ActivityRow>('activities', ['date', 'activity_id'], '*', { archived: false });
  return rows
    .map(rowToActivity)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function createActivity(
  activity: Omit<ActivityRecord, 'id'>
): Promise<ActivityRecord> {
  const { data, error } = await supabase
    .from('activities')
    .insert({
      school_id: activity.schoolId,
      contact_id: activity.contactId ?? null,
      event_id: toEventRowId(activity.eventId),
      activity_type: activity.activityType,
      date: activity.date.slice(0, 10),
      description: activity.description,
      outcome: activity.outcome ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToActivity(data as ActivityRow);
}

/** Archives a logged contact: it stays in the database and can be restored (db/009). */
export async function archiveActivity(id: string): Promise<void> {
  const { error } = await supabase
    .from('activities')
    .update({ archived: true })
    .eq('activity_id', id);
  if (error) throw error;
}
