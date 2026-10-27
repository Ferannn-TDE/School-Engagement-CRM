/**
 * The Reports fixture (scripts/fixtures/reports/data.json) as the app sees it.
 *
 * The rows are in the live tables' shape so the SQL check can load them as they
 * are; this turns them into the app's types the way the services do when loading
 * (archived rows left out, activities' dates at local noon, contacts placed by their
 * junction row or else staff.school_worked_at, an archived school's contacts
 * dropped). Only the fields the Reports figures read are filled in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityRecord, Contact, Event, School } from '../src/types';
import { ContactRole, EventType } from '../src/types';
import type { ReportInput } from '../src/utils/reports';

export interface FixtureRows {
  schools: { facility_key: string; name: string; state_code: string | null; county_name: string | null; archived: boolean; source_status: School['sourceStatus'] | null }[];
  activities: { activity_id: string; event_id: number | null; school_id: string; activity_type: string; date: string; archived: boolean; import_batch_id: string | null; attendee_count: number | null }[];
  events: { event_id: number; fair_name: string | null; date: string | null; time: string | null; schools_involved: string | null; location: string | null; category: string | null; archived: boolean }[];
  staff: { staff_id: number; school_worked_at: string | null; is_active: boolean | null; archived: boolean; last_verified_at: string | null; last_scraped_at: string | null }[];
  contacts: { school_id: string; staff_id: number; archived: boolean }[];
}

export function loadFixtureRows(): FixtureRows {
  return JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures', 'reports', 'data.json'), 'utf8'));
}

const STAMP = '2026-01-01T00:00:00Z';

/** The rows as the app holds them after loading (every state). */
export function toAppData(rows: FixtureRows, today: string): ReportInput & { programs: [] } {
  const schools: School[] = rows.schools.filter((s) => !s.archived).map((s) => ({
    id: s.facility_key, name: s.name, county: s.county_name ?? '', address: '', city: '',
    state: s.state_code ?? '', zipCode: '', schoolType: 'high_school', isActive: true,
    sourceStatus: s.source_status ?? undefined, createdAt: STAMP, updatedAt: STAMP,
  }));

  const activities: ActivityRecord[] = rows.activities.filter((a) => !a.archived).map((a) => ({
    id: a.activity_id, schoolId: a.school_id, activityType: a.activity_type,
    date: `${a.date.slice(0, 10)}T12:00:00`, description: '',
    eventId: a.event_id != null ? `e_${a.event_id}` : undefined,
    importBatchId: a.import_batch_id ?? undefined, attendeeCount: a.attendee_count ?? undefined,
  }));

  const events: Event[] = rows.events.filter((e) => !e.archived).map((e) => ({
    id: `e_${e.event_id}`, name: e.fair_name ?? e.location ?? 'Untitled Event', type: EventType.OTHER,
    // A missing date loads as "now" in eventsService.
    date: e.date ? `${e.date}T${(e.time ?? '00:00:00').slice(0, 8)}` : `${today}T00:00:00`,
    category: e.category ?? undefined, location: e.location ?? '',
    participatingSchools: (e.schools_involved ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    createdAt: STAMP, updatedAt: STAMP,
  }));

  // contactsService: junction rows in (school_id, staff_id) order, the last one wins.
  const junction = new Map<number, string>();
  for (const j of rows.contacts.filter((c) => !c.archived).sort((a, b) => (a.school_id < b.school_id ? -1 : a.school_id > b.school_id ? 1 : a.staff_id - b.staff_id))) {
    junction.set(j.staff_id, j.school_id);
  }
  const archivedSchools = new Set(rows.schools.filter((s) => s.archived).map((s) => s.facility_key));
  const contacts: Contact[] = rows.staff.filter((s) => !s.archived).map((s) => ({
    id: String(s.staff_id), firstName: '', lastName: '', email: '', role: ContactRole.OTHER,
    schoolId: junction.get(s.staff_id) ?? s.school_worked_at ?? '', isActive: s.is_active ?? true,
    lastVerifiedAt: s.last_verified_at ?? undefined, lastScrapedAt: s.last_scraped_at ?? undefined,
    createdAt: STAMP, updatedAt: STAMP,
  })).filter((c) => !archivedSchools.has(c.schoolId));

  return { schools, contacts, events, activities, programs: [] };
}
