import { format } from 'date-fns';
import { supabase, fetchAllRows } from './supabase';
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
  category: string | null;
  /** db/028: NULL = "Not set". */
  event_type?: string | null;
  event_type_other?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * The event's local date and time. Every event is stored in local (Central) time:
 * school-calendar events since db/017 and scraper-fixes a70d4af, IACAC and manually
 * entered events always. A date on its own is that local day. Midnight exactly means
 * an all-day event.
 */
function localDateTime(row: EventRow): { date: string; hasTime: boolean } {
  if (!row.date) return { date: nowISO(), hasTime: false };
  if (!row.time) return { date: `${row.date}T00:00:00`, hasTime: false };
  const local = `${row.date}T${row.time.slice(0, 8)}`;
  return { date: local, hasTime: !local.endsWith('T00:00:00') };
}

function rowToEvent(row: EventRow, listed: string[] = []): Event {
  const { date, hasTime } = localDateTime(row);
  // schools_involved holds at most one school (its foreign key): the host school the
  // school-calendar scraper found. Everyone else listed is in event_schools (db/031).
  const host = row.schools_involved?.trim() || undefined;
  const schools = [...new Set([...(host ? [host] : []), ...listed])];
  return {
    id: `e_${row.event_id}`,
    name: row.fair_name ?? row.location ?? 'Untitled Event',
    // Saved since db/028. Before, the app showed "Outreach Fair" for scraped events and
    // "Other" for the rest; those events now show "Not set" until someone edits them.
    type: (row.event_type as EventType | null) ?? undefined,
    typeOther: row.event_type_other ?? undefined,
    date,
    hasTime,
    source: row.external_id?.startsWith('schoolreach:')
      ? 'school_calendar'
      : row.external_id?.startsWith('iacac:')
        ? 'iacac'
        : row.external_id?.startsWith('import:')
          ? 'import'
          : 'manual',
    category: row.category ?? undefined,
    endDate: undefined,
    location: row.location ?? '',
    participatingSchools: schools,
    hostSchoolId: host,
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

/** The table or function db/031 adds isn't there yet (PostgREST / Postgres codes). */
function isMissing031(err: { code?: string } | null): boolean {
  return !!err && ['PGRST205', 'PGRST202', '42P01', '42883'].includes(err.code ?? '');
}

/** Each event's listed schools from event_schools (db/031); empty until 031 is applied. */
async function fetchListedSchools(): Promise<Map<number, string[]>> {
  const byEvent = new Map<number, string[]>();
  try {
    const rows = await fetchAllRows<{ event_id: number; school_id: string }>(
      'event_schools', 'event_school_id', 'event_id, school_id', { archived: false });
    for (const r of rows) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r.school_id]);
  } catch (err) {
    if (!isMissing031(err as { code?: string })) throw err;
  }
  return byEvent;
}

export async function fetchEvents(): Promise<Event[]> {
  // Archived events (db/009) are left out; Settings → Archived lists them.
  const [{ data, error }, listed] = await Promise.all([
    supabase.from('events').select('*').eq('archived', false),
    fetchListedSchools(),
  ]);
  if (error) throw error;
  return (data as EventRow[]).map((row) => rowToEvent(row, listed.get(row.event_id)));
}

/**
 * Makes the event's listed schools exactly `schoolIds` (db/031 set_event_schools: adds,
 * restores and archives in one transaction; nothing is deleted). The host school from
 * the school calendar stays in schools_involved and isn't part of this list.
 */
async function saveListedSchools(eventId: number, schoolIds: string[], hostSchoolId?: string): Promise<void> {
  const ids = [...new Set(schoolIds)].filter((id) => id !== hostSchoolId);
  const { error } = await supabase.rpc('set_event_schools', { p_event_id: eventId, p_school_ids: ids });
  if (!error) return;
  if (isMissing031(error)) {
    throw Object.assign(new Error('The database needs update 031 (event schools) before an event can list schools.'), { code: 'APP031' });
  }
  throw error;
}

/** The event's local calendar day and time, from the form's local date-time. */
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm:ss') };
}

export async function createEvent(
  event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Event> {
  const parts = event.date ? localParts(event.date) : null;

  const { data, error } = await supabase
    .from('events')
    .insert({
      fair_name: event.name,
      location: event.location,
      time: parts?.time ?? null,
      date: parts?.date ?? null,
      attendance: event.attendeeCount ?? null,
      is_scraped: false,
      event_type: event.type ?? null,
      event_type_other: event.type === 'other' ? event.typeOther ?? null : null,
    })
    .select()
    .single();
  if (error) throw error;
  const row = data as EventRow;
  if (event.participatingSchools.length) {
    try {
      await saveListedSchools(row.event_id, event.participatingSchools);
    } catch (err) {
      // Don't leave a half-saved event behind: archive it (restorable) and report why.
      await supabase.from('events').update({ archived: true }).eq('event_id', row.event_id);
      throw err;
    }
  }
  return rowToEvent(row, event.participatingSchools);
}

/**
 * A minimal event made from Import Activities ("Other: type an event name"): the name,
 * the batch's day as an all-day event, type Not set, and an external_id of
 * "import:<uuid>" so it shows as "Added from an import". The scraper only writes its own
 * "schoolreach:" and "iacac:" rows, and only where is_scraped is true.
 */
export async function createImportedEvent(name: string, day: string): Promise<Event> {
  const { data, error } = await supabase
    .from('events')
    .insert({
      fair_name: name.trim(),
      date: day,
      time: '00:00:00',
      is_scraped: false,
      event_type: null,
      external_id: `import:${crypto.randomUUID()}`,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToEvent(data as EventRow);
}

export async function updateEvent(id: string, updates: Partial<Event>, hostSchoolId?: string): Promise<void> {
  const eventId = parseEventId(id);
  const patch: Partial<EventRow> = {};
  if (updates.name !== undefined) patch.fair_name = updates.name;
  if (updates.location !== undefined) patch.location = updates.location || null;
  if (updates.attendeeCount !== undefined) patch.attendance = updates.attendeeCount;
  if (updates.type !== undefined) {
    patch.event_type = updates.type;
    patch.event_type_other = updates.type === 'other' ? updates.typeOther ?? null : null;
  }
  if (updates.date !== undefined) {
    const parts = localParts(updates.date);
    patch.date = parts.date;
    patch.time = parts.time;
  }
  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from('events')
      .update(patch)
      .eq('event_id', eventId);
    if (error) throw error;
  }
  if (updates.participatingSchools !== undefined) {
    await saveListedSchools(eventId, updates.participatingSchools, hostSchoolId);
  }
}

/** Archives an event: it stays in the database and can be restored (db/009). */
export async function archiveEvent(id: string): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({ archived: true })
    .eq('event_id', parseEventId(id));
  if (error) throw error;
}
