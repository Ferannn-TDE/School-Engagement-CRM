import { supabase } from './supabase';

// Settings → Archived: everything archived instead of deleted (db/009), and restore.

export type ArchivedKind = 'school' | 'contact' | 'event' | 'program' | 'activity';

export interface ArchivedItem {
  kind: ArchivedKind;
  /** The row's key: facility_key, staff_id, event_id, program_id or activity_id. */
  id: string;
  label: string;
  detail: string;
  archivedAt: string | null;
  archivedBy: string | null;
}

interface Stamp {
  archived_at: string | null;
  archived_by: string | null;
}

const STAMP = 'archived_at, archived_by';

async function archivedRows<T>(table: string, columns: string): Promise<(T & Stamp)[]> {
  const { data, error } = await supabase
    .from(table)
    .select(`${columns}, ${STAMP}`)
    .eq('archived', true)
    .order('archived_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as (T & Stamp)[];
}

export async function fetchArchivedItems(): Promise<ArchivedItem[]> {
  const [schools, staff, events, programs, activities] = await Promise.all([
    archivedRows<{ facility_key: string; name: string; city: string | null; state_code: string | null }>(
      'schools', 'facility_key, name, city, state_code'),
    archivedRows<{ staff_id: number; name: string; job_name: string | null; school_worked_at: string | null }>(
      'staff', 'staff_id, name, job_name, school_worked_at'),
    archivedRows<{ event_id: number; fair_name: string | null; location: string | null; date: string | null }>(
      'events', 'event_id, fair_name, location, date'),
    archivedRows<{ program_id: string; name: string; school_id: string }>(
      'programs', 'program_id, name, school_id'),
    archivedRows<{ activity_id: string; activity_type: string; date: string; school_id: string | null }>(
      'activities', 'activity_id, activity_type, date, school_id'),
  ]);
  const stamp = (r: Stamp) => ({ archivedAt: r.archived_at, archivedBy: r.archived_by });
  return [
    ...schools.map((r) => ({
      kind: 'school' as const, id: r.facility_key, label: r.name,
      detail: [r.city, r.state_code].filter(Boolean).join(', '), ...stamp(r),
    })),
    ...staff.map((r) => ({
      kind: 'contact' as const, id: String(r.staff_id), label: r.name,
      detail: [r.job_name, r.school_worked_at].filter(Boolean).join(' · '), ...stamp(r),
    })),
    ...events.map((r) => ({
      kind: 'event' as const, id: String(r.event_id), label: r.fair_name ?? r.location ?? 'Untitled event',
      detail: [r.date, r.location].filter(Boolean).join(' · '), ...stamp(r),
    })),
    ...programs.map((r) => ({
      kind: 'program' as const, id: r.program_id, label: r.name, detail: r.school_id, ...stamp(r),
    })),
    ...activities.map((r) => ({
      kind: 'activity' as const, id: r.activity_id, label: `Logged ${r.activity_type}`,
      detail: [r.date, r.school_id].filter(Boolean).join(' · '), ...stamp(r),
    })),
  ];
}

/**
 * Restores an archived item. A school comes back with the staff and links archived
 * with it, and a contact with their links (db/009 restore_school / restore_contact).
 */
export async function restoreItem(kind: ArchivedKind, id: string): Promise<void> {
  const { error } =
    kind === 'school'
      ? await supabase.rpc('restore_school', { p_facility_key: id })
      : kind === 'contact'
        ? await supabase.rpc('restore_contact', { p_staff_id: parseInt(id, 10) })
        : kind === 'event'
          ? await supabase.from('events').update({ archived: false }).eq('event_id', parseInt(id, 10))
          : kind === 'program'
            ? await supabase.from('programs').update({ archived: false }).eq('program_id', id)
            : await supabase.from('activities').update({ archived: false }).eq('activity_id', id);
  if (error) throw error;
}
