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
  const { data, error } = await supabase.from('schools').select('*').order('name', { ascending: true });
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
      data_source: school.dataSource ?? 'manual',
      is_verified: school.isVerified ?? false,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToSchool(data as SchoolRow);
}

export async function createSchoolsBulk(
  schools: Omit<School, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<School[]> {
  if (schools.length === 0) return [];
  const rows = schools.map((school) => ({
    facility_key: crypto.randomUUID(),
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
    data_source: school.dataSource ?? 'imported',
    is_verified: school.isVerified ?? false,
  }));
  const { data, error } = await supabase.from('schools').insert(rows).select();
  if (error) throw error;
  return (data as SchoolRow[]).map(rowToSchool);
}

export interface ImportSchoolsResult {
  schools: School[];
  created: number;
  updated: number;
  failed: number;
}

/**
 * Import-specific bulk upsert. Pre-fetches existing schools by name so:
 *  - new schools are INSERTed with is_verified=false
 *  - existing schools are UPDATEd (address/county/etc.) but is_verified is preserved
 *  - per-row errors are caught so one bad row doesn't abort the batch
 *  - returns all schools (new + existing) so callers can build a name→id map for contacts
 */
export async function importSchoolsBulk(
  schools: Array<{
    name: string;
    district?: string;
    county: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    schoolType: 'high_school' | 'middle_school';
  }>
): Promise<ImportSchoolsResult> {
  if (schools.length === 0) return { schools: [], created: 0, updated: 0, failed: 0 };

  const names = [...new Set(schools.map((s) => s.name).filter(Boolean))];

  // Fresh DB look-up — not relying on potentially-stale in-memory state
  const { data: existingData, error: fetchError } = await supabase
    .from('schools')
    .select('*')
    .in('name', names);

  if (fetchError) {
    console.error('importSchoolsBulk: fetch existing failed', fetchError);
    throw fetchError;
  }

  const existingByName = new Map<string, SchoolRow>(
    (existingData as SchoolRow[]).map((r) => [r.name.toLowerCase(), r])
  );

  const allSchools: School[] = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  await Promise.all(
    schools.map(async (school) => {
      const existing = existingByName.get(school.name.toLowerCase());
      try {
        if (existing) {
          // UPDATE — preserve is_verified
          const { data, error } = await supabase
            .from('schools')
            .update({
              county_name: school.county,
              address: school.address,
              city: school.city,
              zipcode: school.zipCode,
              type_of_school: school.schoolType === 'high_school' ? 'High School' : 'Middle School',
              data_source: 'imported',
            })
            .eq('facility_key', existing.facility_key)
            .select()
            .single();
          if (error) throw error;
          allSchools.push(rowToSchool(data as SchoolRow));
          updated++;
        } else {
          // INSERT — new record, is_verified=false
          const { data, error } = await supabase
            .from('schools')
            .insert({
              facility_key: crypto.randomUUID(),
              name: school.name,
              county_name: school.county,
              address: school.address,
              city: school.city,
              zipcode: school.zipCode,
              type_of_school: school.schoolType === 'high_school' ? 'High School' : 'Middle School',
              is_active: true,
              data_source: 'imported',
              is_verified: false,
              priority_tier: 'standard',
            })
            .select()
            .single();
          if (error) throw error;
          allSchools.push(rowToSchool(data as SchoolRow));
          created++;
        }
      } catch (err) {
        const pgErr = err as { code?: string };
        if (pgErr?.code === '23505') {
          // Unique-violation: the pre-fetch missed it (race / case mismatch).
          // Recover the real row so contacts can still link to the correct id.
          const { data: recovered } = await supabase
            .from('schools')
            .select('*')
            .ilike('name', school.name)
            .single();
          if (recovered) {
            allSchools.push(rowToSchool(recovered as SchoolRow));
            updated++; // counts as "existing, not re-inserted"
          } else {
            console.error(`importSchoolsBulk: failed for "${school.name}"`, err);
            failed++;
          }
        } else {
          console.error(`importSchoolsBulk: failed for "${school.name}"`, err);
          failed++;
          if (existing) allSchools.push(rowToSchool(existing));
        }
      }
    })
  );

  return { schools: allSchools, created, updated, failed };
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

export async function deleteSchool(id: string): Promise<{ deletedContactIds: string[] }> {
  // 1. Find all staff that reference this school so we can clean up state
  const { data: staffData } = await supabase
    .from('staff')
    .select('staff_id')
    .eq('school_worked_at', id);

  const staffIds: number[] = (staffData ?? []).map((r: { staff_id: number }) => r.staff_id);

  // 2. Remove junction rows first (contacts table is a school↔staff junction)
  if (staffIds.length > 0) {
    await supabase.from('contacts').delete().in('staff_id', staffIds);
  }
  // Also remove any junction rows keyed by school_id directly
  await supabase.from('contacts').delete().eq('school_id', id);

  // 3. Delete staff records — clears the FK that blocks school deletion
  if (staffIds.length > 0) {
    await supabase.from('staff').delete().in('staff_id', staffIds);
  }

  // 4. Now safe to delete the school
  const { error } = await supabase.from('schools').delete().eq('facility_key', id);
  if (error) throw error;

  return { deletedContactIds: staffIds.map(String) };
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
