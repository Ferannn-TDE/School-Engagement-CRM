import { supabase, fetchAllRows } from './supabase';
import type { MatchSchool } from '../utils/activityImportMatch';
import type { PlannedActivity } from '../utils/activityImportFile';

// Activity-import batches (db/022). A batch and its activities are saved together by
// create_import_batch, and archived or restored together by archive_import_batch /
// restore_import_batch; all three run as the signed-in user, so RLS and aal2 apply.

interface ImportBatchRow {
  batch_id: string;
  file_name: string;
  file_hash: string;
  row_count: number;
  activity_type: string;
  /** db/030 */
  activity_type_other?: string | null;
  activity_date: string;
  description: string;
  event_id: number | null;
  created_at: string;
  created_by: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
}

export interface ImportBatch {
  id: string;
  fileName: string;
  fileHash: string;
  rowCount: number;
  activityType: string;
  /** The "Please specify" text when activityType is 'other' (db/030). */
  activityTypeOther?: string;
  activityDate: string;
  description: string;
  eventId?: string;
  createdAt: string;
  createdBy?: string;
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  /** Activities saved with the batch, and how many of them are archived. */
  activityCount: number;
  archivedActivityCount: number;
}

function rowToBatch(row: ImportBatchRow, counts?: { total: number; archived: number }): ImportBatch {
  return {
    id: row.batch_id,
    fileName: row.file_name,
    fileHash: row.file_hash,
    rowCount: row.row_count,
    activityType: row.activity_type,
    activityTypeOther: row.activity_type_other ?? undefined,
    activityDate: row.activity_date,
    description: row.description,
    eventId: row.event_id != null ? `e_${row.event_id}` : undefined,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
    archived: row.archived,
    archivedAt: row.archived_at ?? undefined,
    archivedBy: row.archived_by ?? undefined,
    activityCount: counts?.total ?? 0,
    archivedActivityCount: counts?.archived ?? 0,
  };
}

/** The most recent batches, newest first, with their activity counts. */
export async function fetchRecentImportBatches(limit = 20): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as ImportBatchRow[];
  if (!rows.length) return [];
  const { data: acts, error: actsError } = await supabase
    .from('activities')
    .select('import_batch_id, archived')
    .in('import_batch_id', rows.map((r) => r.batch_id));
  if (actsError) throw actsError;
  const counts = new Map<string, { total: number; archived: number }>();
  for (const a of (acts ?? []) as { import_batch_id: string; archived: boolean }[]) {
    const c = counts.get(a.import_batch_id) ?? { total: 0, archived: 0 };
    c.total += 1;
    if (a.archived) c.archived += 1;
    counts.set(a.import_batch_id, c);
  }
  return rows.map((r) => rowToBatch(r, counts.get(r.batch_id)));
}

/** One batch by id (the visit details panel), without activity counts. Null if not found. */
export async function fetchImportBatch(batchId: string): Promise<ImportBatch | null> {
  const { data, error } = await supabase.from('import_batches').select('*').eq('batch_id', batchId).maybeSingle();
  if (error) throw error;
  return data ? rowToBatch(data as ImportBatchRow) : null;
}

/** Earlier batches saved from a file with the same bytes, archived ones included. */
export async function findImportBatchesByHash(fileHash: string): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .eq('file_hash', fileHash)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ImportBatchRow[]).map((r) => rowToBatch(r));
}

export interface NewImportBatch {
  fileName: string;
  fileHash: string;
  rowCount: number;
  activityType: string;
  activityTypeOther?: string;
  /** "2026-10-01" */
  activityDate: string;
  description: string;
  /** App event id ("e_123"), if the activities are linked to an event. */
  eventId?: string;
  activities: PlannedActivity[];
  /** The file's rows that were saved (db/029): kept so the batch can be previewed. */
  rows: NewImportRow[];
}

/**
 * One saved file row (db/029). visitorName is student data: the table is readable by
 * editors and admins only (RLS), and names never go to lists, exports or Reports
 * (scripts/verify-no-names.mjs fails the build if they do).
 */
export interface NewImportRow {
  rowNumber: number;
  schoolAsTyped: string;
  cityAsTyped: string;
  stateAsTyped: string;
  schoolId: string | null;
  visitors: number | null;
  visitorName: string | null;
}

export interface ImportRow extends NewImportRow {
  id: string;
  activityId?: string;
  archived: boolean;
}

interface ImportRowRow {
  row_id: number;
  row_number: number;
  school_as_typed: string;
  city_as_typed: string;
  state_as_typed: string;
  school_id: string | null;
  activity_id: string | null;
  visitors: number | null;
  visitor_name: string | null;
  archived: boolean;
}

const rowsPayload = (rows: NewImportRow[]) => rows.map((r) => ({
  row_number: r.rowNumber, school_as_typed: r.schoolAsTyped, city_as_typed: r.cityAsTyped,
  state_as_typed: r.stateAsTyped, school_id: r.schoolId, visitors: r.visitors, visitor_name: r.visitorName,
}));

const toImportRow = (r: ImportRowRow): ImportRow => ({
  id: String(r.row_id), rowNumber: r.row_number, schoolAsTyped: r.school_as_typed, cityAsTyped: r.city_as_typed,
  stateAsTyped: r.state_as_typed, schoolId: r.school_id, activityId: r.activity_id ?? undefined,
  visitors: r.visitors, visitorName: r.visitor_name, archived: r.archived,
});

/** A batch's saved rows, in file order. Empty for viewers (RLS) and for batches saved before 029. */
export async function fetchImportRows(batchId: string): Promise<ImportRow[]> {
  const { data, error } = await supabase
    .from('import_rows').select('*').eq('batch_id', batchId).order('row_number');
  if (error) throw error;
  return ((data ?? []) as ImportRowRow[]).map(toImportRow);
}

/** How many rows each batch has saved (0 = saved before 029, or a viewer). */
export async function fetchImportRowCounts(batchIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!batchIds.length) return counts;
  const { data, error } = await supabase.from('import_rows').select('batch_id').in('batch_id', batchIds);
  if (error) throw error;
  for (const r of (data ?? []) as { batch_id: string }[]) counts.set(r.batch_id, (counts.get(r.batch_id) ?? 0) + 1);
  return counts;
}

/** The visitors' names behind one activity (editors and admins only; [] for viewers). */
export async function fetchVisitorNames(activityId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('import_rows').select('visitor_name, row_number').eq('activity_id', activityId)
    .not('visitor_name', 'is', null).order('row_number');
  if (error) throw error;
  return ((data ?? []) as { visitor_name: string }[]).map((r) => r.visitor_name);
}

/**
 * Adds the rows of a batch saved before 029 from its original file: refused unless the
 * file's SHA-256 is the batch's, and only once. Creates no activity. Returns the count.
 */
export async function attachImportRows(batchId: string, fileHash: string, rows: NewImportRow[]): Promise<number> {
  const { data, error } = await supabase.rpc('attach_import_rows', {
    p_batch_id: batchId, p_file_hash: fileHash, p_rows: rowsPayload(rows),
  });
  if (error) throw error;
  return data as number;
}

/** Saves the batch, one activity per school, and the rows, in one transaction; returns the batch id. */
export async function createImportBatch(batch: NewImportBatch): Promise<string> {
  const eventId = batch.eventId ? parseInt(batch.eventId.replace(/^e_/, ''), 10) : null;
  const { data, error } = await supabase.rpc('create_import_batch', {
    p_file_name: batch.fileName,
    p_file_hash: batch.fileHash,
    p_row_count: batch.rowCount,
    p_activity_type: batch.activityType,
    p_activity_date: batch.activityDate,
    p_description: batch.description,
    p_event_id: eventId != null && !Number.isNaN(eventId) ? eventId : null,
    p_schools: batch.activities.map((a) => ({ school_id: a.schoolId, attendee_count: a.attendeeCount })),
    p_rows: rowsPayload(batch.rows),
    // db/030: kept only when the type is 'other'.
    p_activity_type_other: batch.activityTypeOther ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Archives a batch and its activities (db/009 style: kept, restorable). */
export async function archiveImportBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_import_batch', { p_batch_id: batchId });
  if (error) throw error;
}

/** Restores a batch and exactly the activities archived with it. */
export async function restoreImportBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('restore_import_batch', { p_batch_id: batchId });
  if (error) throw error;
}

/** Archived schools, so an import row that names one is shown as archived, not "Not found". */
export async function fetchArchivedSchoolsForMatching(): Promise<MatchSchool[]> {
  const rows = await fetchAllRows<{ facility_key: string; name: string; city: string | null; state_code: string | null }>(
    'schools',
    'facility_key',
    'facility_key, name, city, state_code',
    { archived: true }
  );
  return rows.map((r) => ({ id: r.facility_key, name: r.name, city: r.city ?? '', state: r.state_code ?? '', archived: true }));
}

/** Blanks one visitor's name (nothing is deleted: the row, school and count stay). Editors only. */
export async function removeVisitorName(rowId: string): Promise<void> {
  const { data, error } = await supabase
    .from('import_rows').update({ visitor_name: null }).eq('row_id', Number(rowId)).select('row_id');
  if (error) throw error;
  if (!data?.length) throw new Error('The name could not be removed (no row changed).');
}
