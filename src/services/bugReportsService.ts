import { supabase } from './supabase';

// Problem reports (db/024). Anyone signed in, viewers included, can file one and read
// their own; only admins (db/023) read every report and resolve or archive them. The
// database stamps who filed a report and when, so neither is sent from here.

interface BugReportRow {
  report_id: string;
  created_at: string;
  reporter_email: string | null;
  page: string;
  description: string;
  user_agent: string | null;
  screen: string | null;
  app_version: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null;
  resolved_by: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
}

export interface BugReport {
  id: string;
  createdAt: string;
  reporterEmail?: string;
  page: string;
  description: string;
  userAgent?: string;
  screen?: string;
  appVersion?: string;
  status: 'open' | 'resolved';
  resolvedAt?: string;
  resolvedBy?: string;
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
}

function rowToReport(row: BugReportRow): BugReport {
  return {
    id: row.report_id,
    createdAt: row.created_at,
    reporterEmail: row.reporter_email ?? undefined,
    page: row.page,
    description: row.description,
    userAgent: row.user_agent ?? undefined,
    screen: row.screen ?? undefined,
    appVersion: row.app_version ?? undefined,
    status: row.status,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    archived: row.archived,
    archivedAt: row.archived_at ?? undefined,
    archivedBy: row.archived_by ?? undefined,
  };
}

/** What is sent with a report besides the description: shown in the form, too. */
export function reportContext(page: string) {
  return {
    page: page.slice(0, 500),
    userAgent: navigator.userAgent.slice(0, 1000),
    screen: `${window.innerWidth}x${window.innerHeight}`,
    appVersion: __APP_VERSION__,
  };
}

/** Files a report; returns its id (the reference shown to the user). */
export async function submitBugReport(page: string, description: string): Promise<string> {
  const ctx = reportContext(page);
  const { data, error } = await supabase
    .from('bug_reports')
    .insert({
      page: ctx.page,
      description: description.trim().slice(0, 5000),
      user_agent: ctx.userAgent,
      screen: ctx.screen,
      app_version: ctx.appVersion,
    })
    .select('report_id')
    .single();
  if (error) throw error;
  return (data as { report_id: string }).report_id;
}

/** Every report an admin may see (anyone else gets only their own), newest first. */
export async function fetchBugReports(): Promise<BugReport[]> {
  const { data, error } = await supabase
    .from('bug_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as BugReportRow[]).map(rowToReport);
}

export async function fetchIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) throw error;
  return data === true;
}

/** Admins only (RLS). The database stamps who resolved it and when. */
export async function setBugReportStatus(id: string, status: 'open' | 'resolved'): Promise<void> {
  const { data, error } = await supabase.from('bug_reports').update({ status }).eq('report_id', id).select('report_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only admins can change a report');
}

/** Admins only (RLS). Archived, never deleted (db/009). */
export async function setBugReportArchived(id: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.from('bug_reports').update({ archived }).eq('report_id', id).select('report_id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only admins can change a report');
}
