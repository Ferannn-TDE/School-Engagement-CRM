import type { ActivityRecord, Contact, Event, Program, School } from '../types';

/** The states the CRM covers. '' means both (the "All" choice). */
export type Region = '' | 'IL' | 'MO';

export const REGIONS: { value: Region; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'IL', label: 'IL' },
  { value: 'MO', label: 'MO' },
];

export function parseRegion(value: string | null | undefined): Region {
  return value === 'IL' || value === 'MO' ? value : '';
}

/**
 * The state named in a free-text location, only when it is unambiguous:
 * "Kankakee, IL 60901" -> IL. Returns null when neither or both states appear.
 */
export function stateFromLocation(location: string | null | undefined): 'IL' | 'MO' | null {
  const text = ` ${location ?? ''} `;
  const il = /,\s*IL\b|\bIllinois\b|\bIL\s+6[0-2]\d{3}\b/i.test(text);
  const mo = /,\s*MO\b|\bMissouri\b|\bMO\s+6[3-5]\d{3}\b/i.test(text);
  if (il && !mo) return 'IL';
  if (mo && !il) return 'MO';
  return null;
}

/**
 * Which states an event belongs to: those of its participating schools, or, for
 * events with no school (e.g. IACAC college fairs), the state named in its
 * location. Empty means Unknown, which only the "All" choice shows.
 */
export function eventStates(event: Pick<Event, 'participatingSchools' | 'location'>, schoolState: Map<string, string>): Set<string> {
  const states = new Set<string>();
  for (const id of event.participatingSchools) {
    const st = schoolState.get(id);
    if (st) states.add(st);
  }
  if (states.size === 0) {
    const fromLocation = stateFromLocation(event.location);
    if (fromLocation) states.add(fromLocation);
  }
  return states;
}

/** The five tables every page reads (the shape of AppState). */
export interface RegionData {
  schools: School[];
  contacts: Contact[];
  events: Event[];
  activities: ActivityRecord[];
  programs: Program[];
}

/**
 * One state's slice of the data: its schools and everything attached to them.
 * Contacts, logged contacts and programs follow their school. Events follow their
 * participating schools, or the state named in their location when they have none;
 * events with neither are Unknown and appear only under All.
 */
export function scopeToRegion(data: RegionData, region: Region): RegionData {
  if (!region) return data;
  const schoolState = new Map(data.schools.map((s) => [s.id, s.state]));
  const inRegion = (schoolId: string) => schoolState.get(schoolId) === region;
  return {
    schools: data.schools.filter((s) => s.state === region),
    contacts: data.contacts.filter((c) => inRegion(c.schoolId)),
    events: data.events.filter((e) => eventStates(e, schoolState).has(region)),
    activities: data.activities.filter((a) => inRegion(a.schoolId)),
    programs: data.programs.filter((p) => inRegion(p.schoolId)),
  };
}
