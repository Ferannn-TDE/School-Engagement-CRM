import { supabase, fetchAllRows } from './supabase';
import { acceptPatch, dismissPatch } from '../utils/pending';
import type { PendingMap } from '../utils/pending';
import type { School, SchoolType } from '../types';
import type { DistrictOption } from '../utils/districts';
import { nowISO } from '../utils/helpers';

interface SchoolRow {
  facility_key: string;
  name: string;
  district_id: number | null;
  phone: string | null;
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
  /** db/027 */
  verified_by?: string | null;
  updated_by?: string | null;
  last_scraped_at?: string | null;
  source_status?: string | null;
  source_checked_at?: string | null;
  missed_runs?: number | null;
  missing_since?: string | null;
  manual_fields?: string[] | null;
  pending_scraped?: PendingMap | null;
  website_override?: string | null;
  staff_page_override?: string | null;
  priority_tier: string | null;
  state_code: string | null;
}

function mapSchoolType(typeOfSchool: string | null): SchoolType {
  if (!typeOfSchool) return 'high_school';
  const lower = typeOfSchool.toLowerCase();
  if (lower.includes('middle') || lower.includes('junior')) return 'middle_school';
  return 'high_school';
}

function isPriorityTier(value: string | null): value is NonNullable<School['priorityTier']> {
  return value === 'high' || value === 'standard' || value === 'low';
}

// Filled by fetchSchools; every row read afterwards (after an edit, an import) uses it.
let districtNames = new Map<number, string>();
let districtList: DistrictOption[] = [];

/** Every named district (from the last load), for matching imports and the school form's picker. */
export function getDistricts(): DistrictOption[] {
  return districtList;
}

function rowToSchool(row: SchoolRow): School {
  return {
    id: row.facility_key,
    name: row.name,
    district: row.district_id != null ? row.district_id.toString() : undefined,
    districtName: row.district_id != null ? districtNames.get(row.district_id) : undefined,
    districtId: row.district_id ?? undefined,
    county: row.county_name ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state_code ?? '',
    zipCode: row.zipcode ?? '',
    phone: row.phone?.trim() || undefined,
    website: row.website?.trim() || undefined,
    websiteOverride: row.website_override ?? undefined,
    staffPageOverride: row.staff_page_override ?? undefined,
    schoolType: mapSchoolType(row.type_of_school),
    isActive: row.is_active ?? true,
    notes: row.notes ?? undefined,
    enrollment: row.enrollment ?? undefined,
    gradeRange: row.grade_range ?? undefined,
    dataSource: (row.data_source as School['dataSource']) ?? 'manual',
    isVerified: row.is_verified ?? false,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    verifiedBy: row.verified_by ?? undefined,
    lastUpdatedAt: row.updated_at ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    lastScrapedAt: row.last_scraped_at ?? undefined,
    sourceStatus:
      row.source_status === 'working' || row.source_status === 'broken' || row.source_status === 'not_found'
        ? row.source_status
        : undefined,
    sourceCheckedAt: row.source_checked_at ?? undefined,
    missedRuns: row.missed_runs ?? undefined,
    missingSince: row.missing_since ?? undefined,
    lockedFields: row.manual_fields ?? [],
    pendingScraped: row.pending_scraped ?? {},
    // The scraper writes its lookup result ("website_verified", "official_roster_only")
    // into this column. Only the app's own tiers are priorities; anything else is
    // shown as standard and left untouched in the database.
    priorityTier: isPriorityTier(row.priority_tier) ? row.priority_tier : 'standard',
    createdAt: row.created_at ?? nowISO(),
    updatedAt: row.updated_at ?? nowISO(),
  };
}

/**
 * district_id → district_name. schools.district_id is the scraper's internal id (482),
 * which means nothing to a user; the name is shown instead. The scraper's placeholder
 * "Unknown district" is left out. A failure here only hides the names: it never stops
 * the schools loading.
 */
async function fetchDistrictNames(): Promise<Map<number, string>> {
  try {
    const rows = await fetchAllRows<{ district_id: number; district_name: string | null; state_code: string | null }>(
      'district', 'district_id', 'district_id, district_name, state_code'
    );
    const names = new Map<number, string>();
    const list: DistrictOption[] = [];
    for (const r of rows) {
      const name = r.district_name?.trim();
      if (name && name.toLowerCase() !== 'unknown district') {
        names.set(r.district_id, name);
        list.push({ id: r.district_id, name, state: (r.state_code ?? '').trim().toUpperCase() });
      }
    }
    districtList = list.sort((a, b) => a.name.localeCompare(b.name));
    return names;
  } catch (err) {
    console.error('fetchDistrictNames failed:', err);
    return new Map();
  }
}

export async function fetchSchools(): Promise<School[]> {
  // Paged: there are more schools than PostgREST returns in one response.
  // Archived schools (db/009) are left out; Settings → Archived lists them.
  const [rows, names] = await Promise.all([
    fetchAllRows<SchoolRow>('schools', 'facility_key', '*', { archived: false }),
    fetchDistrictNames(),
  ]);
  districtNames = names;
  return rows
    .map(rowToSchool)
    .sort((a, b) => a.name.localeCompare(b.name));
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
    district_id: school.districtId ?? null,
      county_name: school.county,
      address: school.address,
      city: school.city,
      state_code: school.state || null,
      zipcode: school.zipCode,
      phone: school.phone || null,
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
    district_id: school.districtId ?? null,
    county_name: school.county,
    address: school.address,
    city: school.city,
    zipcode: school.zipCode,
    state_code: school.state || null,
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
    /** The matched district (utils/districts matchDistrict); unmatched names are left out. */
    districtId?: number;
    county: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    /** Omitted when the file doesn't say, so an existing school's type is kept. */
    schoolType?: 'high_school' | 'middle_school';
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
          // UPDATE — fill in only what the file provides. A blank cell never
          // overwrites a stored value, and is_verified and data_source are kept.
          const patch: Record<string, string | number> = {};
          if (school.districtId != null) patch.district_id = school.districtId;
          if (school.county.trim()) patch.county_name = school.county.trim();
          if (school.address.trim()) patch.address = school.address.trim();
          if (school.city.trim()) patch.city = school.city.trim();
          if (school.zipCode.trim()) patch.zipcode = school.zipCode.trim();
          if (school.state) patch.state_code = school.state;
          if (school.schoolType) {
            patch.type_of_school = school.schoolType === 'high_school' ? 'High School' : 'Middle School';
          }
          if (Object.keys(patch).length === 0) {
            allSchools.push(rowToSchool(existing));
            updated++;
            return;
          }
          const { data, error } = await supabase
            .from('schools')
            .update(patch)
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
              district_id: school.districtId ?? null,
              county_name: school.county,
              address: school.address,
              city: school.city,
              zipcode: school.zipCode,
              state_code: school.state || null,
              type_of_school: school.schoolType === 'middle_school' ? 'Middle School' : 'High School',
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
  // The district chosen in the school form's picker (never free text). The scraper keeps
  // district_id as it is on its runs, so the choice sticks.
  if ('districtId' in updates) patch.district_id = updates.districtId ?? null;
  if (updates.county !== undefined) patch.county_name = updates.county;
  if (updates.address !== undefined) patch.address = updates.address;
  if (updates.city !== undefined) patch.city = updates.city;
  if (updates.state) patch.state_code = updates.state;
  if (updates.zipCode !== undefined) patch.zipcode = updates.zipCode;
  // Present-but-empty means the phone was cleared in the form.
  if ('phone' in updates) patch.phone = updates.phone || null;
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

/**
 * Archives a school with its staff and their school links, all with one timestamp,
 * in one database call (db/009 archive_school). Nothing is deleted; Settings →
 * Archived can restore exactly that set.
 */
export async function archiveSchool(id: string): Promise<void> {
  const { error } = await supabase.rpc('archive_school', { p_facility_key: id });
  if (error) throw error;
}

/** What the database stamped when Verified was switched (db/027 sets who and when). */
export interface VerificationStamp {
  id: string;
  isVerified: boolean;
  lastVerifiedAt?: string;
  verifiedBy?: string;
}

/** Turns Verified on or off for schools; returns the stamps the database recorded. */
export async function setSchoolsVerified(ids: string[], verified: boolean): Promise<VerificationStamp[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('schools')
    .update({ is_verified: verified })
    .in('facility_key', ids)
    .select('facility_key, is_verified, last_verified_at, verified_by');
  if (error) throw error;
  return ((data ?? []) as { facility_key: string; is_verified: boolean | null; last_verified_at: string | null; verified_by: string | null }[])
    .map((r) => ({ id: r.facility_key, isVerified: !!r.is_verified, lastVerifiedAt: r.last_verified_at ?? undefined, verifiedBy: r.verified_by ?? undefined }));
}

/**
 * Answers "The website now says X — keep yours or use this?" for a school field.
 * Reads the row fresh so the answer applies to what is stored now. Returns the school.
 */
export async function resolveSchoolPending(
  id: string,
  column: string,
  choice: 'use' | 'keep',
  who: string
): Promise<School> {
  const { data: current, error: readError } = await supabase
    .from('schools').select('manual_fields, pending_scraped').eq('facility_key', id).single();
  if (readError) throw readError;
  const pending = (current.pending_scraped ?? {}) as PendingMap;
  if (!pending[column]) throw new Error(`No website value waiting for ${column}`);
  const patch = choice === 'use'
    ? acceptPatch(column, pending, current.manual_fields ?? [])
    : dismissPatch(column, pending, who);
  const { data, error } = await supabase.from('schools').update(patch).eq('facility_key', id).select().single();
  if (error) throw error;
  return rowToSchool(data as SchoolRow);
}

/**
 * Saves the client's own website and staff-page links (db/013). Stored apart from the
 * scraped website; null clears an override so the scraped link is used again.
 */
export async function setSchoolLinks(
  id: string,
  links: { websiteOverride: string | null; staffPageOverride: string | null }
): Promise<School> {
  const { data, error } = await supabase
    .from('schools')
    .update({ website_override: links.websiteOverride, staff_page_override: links.staffPageOverride })
    .eq('facility_key', id)
    .select()
    .single();
  if (error) throw error;
  return rowToSchool(data as SchoolRow);
}

/** The "last updated" stamp the database recorded for a school (db/027), read after an edit. */
export async function fetchSchoolUpdateStamp(id: string): Promise<{ lastUpdatedAt?: string; updatedBy?: string }> {
  const { data, error } = await supabase.from('schools').select('updated_at, updated_by').eq('facility_key', id).single();
  if (error) throw error;
  const r = data as { updated_at: string | null; updated_by: string | null };
  return { lastUpdatedAt: r.updated_at ?? undefined, updatedBy: r.updated_by ?? undefined };
}
