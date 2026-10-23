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
  /** "2026-10-01" */
  activityDate: string;
  description: string;
  /** App event id ("e_123"), if the activities are linked to an event. */
  eventId?: string;
  activities: PlannedActivity[];
}

/** Saves the batch and one activity per school in one transaction; returns the batch id. */
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
