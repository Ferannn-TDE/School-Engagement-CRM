import { supabase } from './supabase';
import type { School, SchoolType } from '../types';
import { nowISO } from '../utils/helpers';

interface SchoolRow {
  facility_key: string;
  name: string;
  district_id: number | null;
  phone_number: string | null;
  address: string | null;
  class_size: number | null;
  rating: number | null;
  type_of_school: string | null;
  admin: string | null;
  city: string | null;
  zipcode: string | null;
  grades_served: string | null;
  website: string | null;
  county_name: string | null;
  is_active: boolean | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  enrollment: number | null;
  grade_range: string | null;
  data_source: string | null;
  is_verified: boolean | null;
  last_verified_at: string | null;
  priority_tier: string | null;
}

function mapSchoolType(typeOfSchool: string | null): SchoolType {
  if (!typeOfSchool) return 'high_school';
  const lower = typeOfSchool.toLowerCase();
  if (lower.includes('middle') || lower.includes('junior')) return 'middle_school';
  return 'high_school';
}

function rowToSchool(row: SchoolRow): School {
  return {
    id: row.facility_key,
    name: row.name,
    district: row.district_id != null ? row.district_id.toString() : undefined,
    county: row.county_name ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    state: 'IL',
    zipCode: row.zipcode ?? '',
    schoolType: mapSchoolType(row.type_of_school),
    isActive: row.is_active ?? true,
    notes: row.notes ?? undefined,
    enrollment: row.enrollment ?? undefined,
    gradeRange: row.grade_range ?? undefined,
    dataSource: (row.data_source as School['dataSource']) ?? 'manual',
    isVerified: row.is_verified ?? false,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    priorityTier: (row.priority_tier as School['priorityTier']) ?? 'standard',
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? nowISO(),
  };
}

export async function fetchSchools(): Promise<School[]> {
  const { data, error } = await supabase.from('schools').select('*');
  if (error) throw error;
  return (data as SchoolRow[]).map(rowToSchool);
}


export async function createSchool(
  school: Omit<School, 'id' | 'createdAt' | 'updatedAt'>
): Promise<School> {
  const facilityKey = crypto.randomUUID();
  const { data, error } = await supabase
    .from('schools')
    .insert({
      facility_key: facilityKey,
      name: school.name,
      county_name: school.county,
      address: school.address,
      city: school.city,
      zipcode: school.zipCode,
      type_of_school: school.schoolType === 'high_school' ? 'High School' : 'Middle School',
      is_active: school.isActive,
      notes: school.notes ?? null,
      enrollment: school.enrollment ?? null,
      grade_range: school.gradeRange ?? null,
      priority_tier: school.priorityTier ?? 'standard',
    })
    .select()
    .single();
  if (error) throw error;
  return rowToSchool(data as SchoolRow);
}

export async function updateSchool(id: string, updates: Partial<School>): Promise<void> {
  const patch: Partial<SchoolRow> = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.county !== undefined) patch.county_name = updates.county;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.city !== undefined) patch.city = updates.city;
  if (updates.zipCode !== undefined) patch.zipcode = updates.zipCode;
  if (updates.schoolType !== undefined) {
    patch.type_of_school =
      updates.schoolType === 'high_school' ? 'High School' : 'Middle School';
  }
  if (updates.isActive !== undefined) patch.is_active = updates.isActive;
  if (updates.notes !== undefined) patch.notes = updates.notes ?? null;
  if (updates.enrollment !== undefined) patch.enrollment = updates.enrollment ?? null;
  if (updates.gradeRange !== undefined) patch.grade_range = updates.gradeRange ?? null;
  if (updates.priorityTier !== undefined) patch.priority_tier = updates.priorityTier ?? null;
  const { error } = await supabase
    .from('schools')
    .update(patch)
    .eq('facility_key', id);
  if (error) throw error;
}

export async function deleteSchool(id: string): Promise<void> {
  const { error } = await supabase.from('schools').delete().eq('facility_key', id);
  if (error) throw error;
}

export async function markSchoolVerified(id: string): Promise<void> {
  const { error } = await supabase
    .from('schools')
    .update({ is_verified: true, last_verified_at: new Date().toISOString() })
    .eq('facility_key', id);
  if (error) throw error;
}

export async function markSchoolsVerifiedBulk(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('schools')
    .update({ is_verified: true, last_verified_at: new Date().toISOString() })
    .in('facility_key', ids);
  if (error) throw error;
}
