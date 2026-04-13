import { supabase } from './supabase';
import type { Event } from '../types';
import { EventType } from '../types';
import { nowISO } from '../utils/helpers';

// All events live in the `events` table.
// Scraped events are identified by is_scraped = true and have fair_name populated.
// App IDs are always "e_<event_id>".

interface EventRow {
  event_id: number;
  schools_involved: string | null;
  location: string | null;
  time: string | null;
  date: string | null;
  attendance: number | null;
  is_scraped: boolean | null;
  external_id: string | null;
  fair_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function rowToEvent(row: EventRow): Event {
  const schools = row.schools_involved
    ? row.schools_involved.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    id: `e_${row.event_id}`,
    name: row.fair_name ?? row.location ?? 'Untitled Event',
    type: row.is_scraped ? EventType.OUTREACH_FAIR : EventType.OTHER,
    date: row.date ?? nowISO(),
    endDate: undefined,
    location: row.location ?? '',
    participatingSchools: schools,
    attendeeCount: row.attendance ?? undefined,
    notes: undefined,
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? nowISO(),
  };
}

function parseEventId(id: string): number {
  // Strips "e_" prefix; also tolerates legacy "se_" IDs if any linger in state
  return parseInt(id.replace(/^[es]e?_/, ''), 10);
}

export async function fetchEvents(): Promise<Event[]> {
  const { data, error } = await supabase.from('events').select('*');
  if (error) throw error;
  return (data as EventRow[]).map(rowToEvent);
}

export async function createEvent(
  event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Event> {
  const dateOnly = event.date ? event.date.slice(0, 10) : null;
  const timeOnly = event.date
    ? new Date(event.date).toTimeString().slice(0, 8)
    : null;

  const { data, error } = await supabase
    .from('events')
    .insert({
      fair_name: event.name,
      schools_involved: event.participatingSchools.join(',') || null,
      location: event.location,
      time: timeOnly,
      date: dateOnly,
      attendance: event.attendeeCount ?? null,
      is_scraped: false,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data as EventRow);
}

export async function updateEvent(id: string, updates: Partial<Event>): Promise<void> {
  const eventId = parseEventId(id);
  const patch: Partial<EventRow> = {};
  if (updates.name !== undefined) patch.fair_name = updates.name;
  if (updates.location !== undefined) patch.location = updates.location;
  if (updates.attendeeCount !== undefined) patch.attendance = updates.attendeeCount;
  if (updates.participatingSchools !== undefined) {
    patch.schools_involved = updates.participatingSchools.join(',') || null;
  }
  if (updates.date !== undefined) {
    patch.date = updates.date.slice(0, 10);
    patch.time = new Date(updates.date).toTimeString().slice(0, 8);
  }
  const { error } = await supabase
    .from('events')
    .update(patch)
    .eq('event_id', eventId);
  if (error) throw error;
}

export async function deleteEvent(id: string): Promise<void> {
  const eventId = parseEventId(id);
  const { error } = await supabase.from('events').delete().eq('event_id', eventId);
  if (error) throw error;
}
