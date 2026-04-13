import { supabase } from './supabase';
import type { Contact } from '../types';
import { ContactRole } from '../types';
import { nowISO } from '../utils/helpers';

interface StaffRow {
  staff_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  job_name: string | null;
  school_worked_at: string | null;
  is_active: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  data_source: string | null;
  is_verified: boolean | null;
  last_verified_at: string | null;
}

interface JunctionRow {
  school_id: string;
  staff_id: number;
}

function mapJobNameToRole(jobName: string | null): ContactRole {
  if (!jobName) return ContactRole.PRINCIPAL;
  const lower = jobName.toLowerCase();
  if (lower.includes('superintendent')) return ContactRole.SUPERINTENDENT;
  if (lower.includes('principal')) return ContactRole.PRINCIPAL;
  if (lower.includes('counselor') || lower.includes('guidance')) return ContactRole.COUNSELOR;
  if (lower.includes('computer science') || lower.includes('computing')) return ContactRole.CS_TEACHER;
  if (lower.includes('engineering')) return ContactRole.ENGINEERING_TEACHER;
  if (lower.includes('math') || lower.includes('mathematics')) return ContactRole.MATH_TEACHER;
  if (lower.includes('science')) return ContactRole.SCIENCE_TEACHER;
  return ContactRole.PRINCIPAL;
}

function splitName(fullName: string | null): { firstName: string; lastName: string } {
  if (!fullName || fullName.trim() === '') return { firstName: '', lastName: '' };
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return {
    firstName: trimmed.slice(0, spaceIndex),
    lastName: trimmed.slice(spaceIndex + 1),
  };
}

function rowToContact(staff: StaffRow, schoolId: string): Contact {
  const { firstName, lastName } = splitName(staff.name);
  return {
    id: staff.staff_id.toString(),
    firstName,
    lastName,
    email: staff.email ?? '',
    phone: staff.phone ?? undefined,
    role: mapJobNameToRole(staff.job_name),
    schoolId,
    isActive: staff.is_active ?? true,
    notes: staff.notes ?? undefined,
    dataSource: (staff.data_source as Contact['dataSource']) ?? 'manual',
    isVerified: staff.is_verified ?? false,
    lastVerifiedAt: staff.last_verified_at ?? undefined,
    createdAt: staff.created_at ?? nowISO(),
    updatedAt: staff.updated_at ?? nowISO(),
    lastContactDate: undefined,
  };
}

export async function fetchContacts(): Promise<Contact[]> {
  const [staffResult, junctionResult] = await Promise.all([
    supabase.from('staff').select('*'),
    supabase.from('contacts').select('*'),
  ]);
  if (staffResult.error) throw staffResult.error;
  if (junctionResult.error) throw junctionResult.error;

  const staffRows = staffResult.data as StaffRow[];
  const junctionRows = junctionResult.data as JunctionRow[];

  // Build staff_id -> school_id lookup from junction table
  const schoolIdMap = new Map<number, string>();
  for (const j of junctionRows) {
    schoolIdMap.set(j.staff_id, j.school_id);
  }

  return staffRows.map((staff) => {
    const schoolId =
      schoolIdMap.get(staff.staff_id) ?? staff.school_worked_at ?? '';
    return rowToContact(staff, schoolId);
  });
}


export async function createContact(
  contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Contact> {
  const fullName = `${contact.firstName} ${contact.lastName}`.trim();
  const { data: staffData, error: staffError } = await supabase
    .from('staff')
    .insert({
      name: fullName,
      email: contact.email,
      phone: contact.phone ?? null,
      job_name: contact.role,
      school_worked_at: contact.schoolId,
      is_active: contact.isActive,
      notes: contact.notes ?? null,
      data_source: 'manual',
    })
    .select()
    .single();
  if (staffError) throw staffError;

  const staff = staffData as StaffRow;

  if (contact.schoolId) {
    const { error: junctionError } = await supabase
      .from('contacts')
      .insert({ school_id: contact.schoolId, staff_id: staff.staff_id });
    if (junctionError) console.error('Failed to link contact to school:', junctionError);
  }

  return rowToContact(staff, contact.schoolId);
}

export async function createContactsBulk(
  contacts: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<Contact[]> {
  if (contacts.length === 0) return [];

  const staffRows = contacts.map((c) => ({
    name: `${c.firstName} ${c.lastName}`.trim(),
    email: c.email,
    phone: c.phone ?? null,
    job_name: c.role,
    school_worked_at: c.schoolId,
    is_active: c.isActive,
    notes: c.notes ?? null,
    data_source: c.dataSource ?? 'manual',
  }));

  const { data: staffData, error } = await supabase
    .from('staff')
    .insert(staffRows)
    .select();
  if (error) throw error;

  const insertedStaff = staffData as StaffRow[];

  // Link each inserted staff member to their school
  const junctionRows = insertedStaff
    .map((staff, i) => ({ school_id: contacts[i]?.schoolId ?? '', staff_id: staff.staff_id }))
    .filter((j) => j.school_id);

  if (junctionRows.length > 0) {
    const { error: junctionError } = await supabase.from('contacts').insert(junctionRows);
    if (junctionError) console.error('Failed to bulk-link contacts to schools:', junctionError);
  }

  return insertedStaff.map((staff, i) =>
    rowToContact(staff, contacts[i]?.schoolId ?? '')
  );
}

export async function updateContact(id: string, updates: Partial<Contact>): Promise<void> {
  const staffId = parseInt(id, 10);
  const patch: Partial<StaffRow> = {};

  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    const { data } = await supabase
      .from('staff')
      .select('name')
      .eq('staff_id', staffId)
      .single();
    const current = splitName((data as { name: string } | null)?.name ?? null);
    const firstName = updates.firstName ?? current.firstName;
    const lastName = updates.lastName ?? current.lastName;
    patch.name = `${firstName} ${lastName}`.trim();
  }
  if (updates.email !== undefined) patch.email = updates.email;
  if (updates.phone !== undefined) patch.phone = updates.phone ?? null;
  if (updates.role !== undefined) patch.job_name = updates.role;
  if (updates.schoolId !== undefined) patch.school_worked_at = updates.schoolId;
  if (updates.isActive !== undefined) patch.is_active = updates.isActive;
  if (updates.notes !== undefined) patch.notes = updates.notes ?? null;

  const { error } = await supabase
    .from('staff')
    .update(patch)
    .eq('staff_id', staffId);
  if (error) throw error;

  // Re-link to new school if schoolId changed
  if (updates.schoolId !== undefined) {
    await supabase.from('contacts').delete().eq('staff_id', staffId);
    await supabase
      .from('contacts')
      .insert({ school_id: updates.schoolId, staff_id: staffId });
  }
}

export async function markContactVerified(id: string): Promise<void> {
  const staffId = parseInt(id, 10);
  const { error } = await supabase
    .from('staff')
    .update({ is_verified: true, last_verified_at: new Date().toISOString() })
    .eq('staff_id', staffId);
  if (error) throw error;
}

export async function deleteContact(id: string): Promise<void> {
  const staffId = parseInt(id, 10);
  // Remove junction rows first to avoid FK issues
  await supabase.from('contacts').delete().eq('staff_id', staffId);
  const { error } = await supabase
    .from('staff')
    .delete()
    .eq('staff_id', staffId);
  if (error) throw error;
}
