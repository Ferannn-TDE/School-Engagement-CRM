import { ContactRole, ContactRoleLabels } from '../types';
import type { Contact } from '../types';

const ROLE_VALUES = new Set<string>(Object.values(ContactRole));

/**
 * The category a job title belongs to. Never guesses: a title that fits no
 * category is OTHER (and keeps its real title for display), and only a missing
 * title is UNSPECIFIED.
 */
export function roleFromTitle(title: string | null | undefined): ContactRole {
  const trimmed = title?.trim();
  if (!trimmed) return ContactRole.UNSPECIFIED;
  // Older app versions stored the category key itself ("principal", "cs_teacher").
  if (ROLE_VALUES.has(trimmed)) return trimmed as ContactRole;
  const lower = trimmed.toLowerCase();
  if (lower.includes('superintendent')) return ContactRole.SUPERINTENDENT;
  if (lower.includes('principal')) return ContactRole.PRINCIPAL;
  if (lower.includes('counselor') || lower.includes('guidance')) return ContactRole.COUNSELOR;
  if (lower.includes('computer science') || lower.includes('computing')) return ContactRole.CS_TEACHER;
  if (lower.includes('engineering')) return ContactRole.ENGINEERING_TEACHER;
  if (lower.includes('math') || lower.includes('mathematics')) return ContactRole.MATH_TEACHER;
  if (lower.includes('science')) return ContactRole.SCIENCE_TEACHER;
  return ContactRole.OTHER;
}

/** What to show for a contact's role: the category, or their real title when it fits none. */
export function contactRoleLabel(contact: Pick<Contact, 'role' | 'title'>): string {
  if (contact.role === ContactRole.OTHER) return contact.title?.trim() || ContactRoleLabels[ContactRole.OTHER];
  return ContactRoleLabels[contact.role];
}
