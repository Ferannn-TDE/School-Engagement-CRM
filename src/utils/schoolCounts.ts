import type { Contact } from '../types';

/**
 * The one definition of "has a contact", used by every page that counts schools with or
 * without one (Reports, Schools, Dashboard, Priorities, Counties and county pages, the
 * Meeting summary): a school has a contact when at least one ACTIVE person is on file
 * there. Inactive people are still "on file" and shown as such, but never count as a
 * contact.
 *
 * Which schools are counted is decided once, before any page sees the data: the loader
 * leaves archived schools out, and RegionScope keeps the chosen state's. No page filters
 * by school type or by the school's own active flag.
 */
export interface ContactCounts {
  /** Active people on file: what "has a contact" means. */
  active: number;
  /** Everyone on file, active or not. */
  onFile: number;
}

const NONE: ContactCounts = { active: 0, onFile: 0 };

export function contactCountsBySchool(contacts: Pick<Contact, 'schoolId' | 'isActive'>[]): Map<string, ContactCounts> {
  const map = new Map<string, ContactCounts>();
  for (const c of contacts) {
    const e = map.get(c.schoolId) ?? { active: 0, onFile: 0 };
    e.onFile++;
    if (c.isActive) e.active++;
    map.set(c.schoolId, e);
  }
  return map;
}

export function contactCountsOf(map: Map<string, ContactCounts>, schoolId: string): ContactCounts {
  return map.get(schoolId) ?? NONE;
}

/** True when the school has no active contact (it may still have inactive people on file). */
export function hasNoContact(map: Map<string, ContactCounts>, schoolId: string): boolean {
  return contactCountsOf(map, schoolId).active === 0;
}

/** "3", or "3 (5 on file)" when inactive people are on file too. */
export function contactCountLabel(c: ContactCounts): string {
  return c.onFile > c.active ? `${c.active} (${c.onFile} on file)` : String(c.active);
}
