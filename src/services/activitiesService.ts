import { supabase } from './supabase';
import type { ActivityRecord } from '../types';

interface ActivityRow {
  activity_id: string;
  school_id: string;
  contact_id: string | null;
  event_id: string | null;
  activity_type: string;
  date: string;
  description: string;
  outcome: string | null;
}

function rowToActivity(row: ActivityRow): ActivityRecord {
  return {
    id: row.activity_id,
    schoolId: row.school_id,
    contactId: row.contact_id ?? undefined,
    eventId: row.event_id ?? undefined,
    activityType: row.activity_type,
    date: row.date,
    description: row.description,
    outcome: row.outcome ?? undefined,
  };
}

export async function fetchActivities(): Promise<ActivityRecord[]> {
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw error;
  return (data as ActivityRow[]).map(rowToActivity);
}

export async function createActivity(
  activity: Omit<ActivityRecord, 'id'>
): Promise<ActivityRecord> {
  const { data, error } = await supabase
    .from('activities')
    .insert({
      school_id: activity.schoolId,
      contact_id: activity.contactId ?? null,
      event_id: activity.eventId ?? null,
      activity_type: activity.activityType,
      date: activity.date,
      description: activity.description,
      outcome: activity.outcome ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToActivity(data as ActivityRow);
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase
    .from('activities')
    .delete()
    .eq('activity_id', id);
  if (error) throw error;
}
