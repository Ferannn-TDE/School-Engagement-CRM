import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Bug, CheckCircle, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { Header } from '../components/layout/Header';
import { Breadcrumb } from '../components/common/Breadcrumb';
import { Card } from '../components/common/Card';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/EmptyState';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import {
  fetchBugReports,
  fetchIsAdmin,
  setBugReportArchived,
  setBugReportStatus,
  type BugReport,
} from '../services/bugReportsService';
import toast from 'react-hot-toast';
import { browserName } from '../utils/browserName';
import { useConfirm } from '../hooks/useConfirm';

type View = 'open' | 'resolved' | 'archived';

const VIEWS: { key: View; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'archived', label: 'Archived' },
];

const inView = (r: BugReport, view: View) =>
  view === 'archived' ? r.archived : !r.archived && r.status === view;

/** Version, screen and browser, behind a toggle: what a maintainer needs, not a reader. */
function ReportDetails({ report: r }: { report: BugReport }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-800">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-neutral-50 px-3 py-2 text-neutral-700">
          <dt className="text-neutral-500">Browser</dt><dd>{r.userAgent ? browserName(r.userAgent) : 'Not recorded'}</dd>
          <dt className="text-neutral-500">Screen</dt><dd>{r.screen ? r.screen.replace('x', ' × ') : 'Not recorded'}</dd>
          <dt className="text-neutral-500">App version</dt>
          <dd>
            {r.appVersion && /^[0-9a-f]{7,40}$/.test(r.appVersion) ? (
              <a href={`https://github.com/Ferannn-TDE/School-Engagement-CRM/commit/${r.appVersion}`} target="_blank" rel="noreferrer"
                className="font-mono underline decoration-dotted underline-offset-2 hover:text-siue-red">{r.appVersion}</a>
            ) : r.appVersion ?? 'Not recorded'}
            <span className="text-neutral-500"> (the commit that was live when it was sent)</span>
          </dd>
          <dt className="text-neutral-500">Reference</dt><dd className="font-mono">{r.id.slice(0, 8)}</dd>
        </dl>
      )}
    </div>
  );
}

/**
 * Settings → Problem reports (db/024). Admins see every report and can mark it
 * resolved or archive it; anyone else sees only the reports they filed.
 */
export function BugReportsPage() {
  const [reports, setReports] = useState<BugReport[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      const [list, isAdmin] = await Promise.all([fetchBugReports(), fetchIsAdmin()]);
      setReports(list);
      setAdmin(isAdmin);
      setError(null);
    } catch (err) {
      console.error('fetchBugReports failed:', err);
      setError((err as { message?: string })?.message ?? String(err));
      setReports([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.key, (reports ?? []).filter((r) => inView(r, v.key)).length])) as Record<View, number>,
    [reports]
  );
  const shown = (reports ?? []).filter((r) => inView(r, view));

  const act = async (r: BugReport, change: () => Promise<void>, done: string) => {
    setBusy(r.id);
    try {
      await change();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(`Couldn’t update the report: ${(err as { message?: string })?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <Breadcrumb crumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Problem reports' }]} />
      <Header
        title="Problem reports"
        subtitle="Sent with the Report a problem button on every page. Nothing is deleted: archive what's done with."
      />
      <div className="p-8 space-y-6 max-w-4xl">
        {reports === null ? (
          <LoadingSpinner />
        ) : error ? (
          <Card>
            <p className="text-sm text-neutral-700">Problem reports couldn’t be loaded: {error}</p>
          </Card>
        ) : (
          <>
            {!admin && (
              <p className="text-sm text-neutral-600">
                You’re seeing only the reports you sent. Admins see every report and mark them resolved.
              </p>
            )}
            <div className="flex border-b border-neutral-200" role="tablist">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  role="tab"
                  aria-selected={view === v.key}
                  onClick={() => setView(v.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    view === v.key ? 'border-siue-red text-siue-red' : 'border-transparent text-neutral-500 hover:text-neutral-700'
                  }`}
                >
                  {v.label} <span className="text-neutral-400">({counts[v.key]})</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Bug size={32} />}
                  title={view === 'open' ? 'No open reports' : view === 'resolved' ? 'No resolved reports' : 'Nothing archived'}
                  description="Reports appear here when someone uses Report a problem."
                />
              </Card>
            ) : (
              <Card padding={false}>
                <ul className="divide-y divide-neutral-100">
                  {shown.map((r) => (
                    <li key={r.id} className="px-6 py-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                          <div><dt className="text-xs text-neutral-500">When</dt><dd className="text-neutral-800">{format(new Date(r.createdAt), 'MMM d, yyyy h:mm a')}</dd></div>
                          <div><dt className="text-xs text-neutral-500">Who</dt><dd className="text-neutral-800 break-all">{r.reporterEmail ?? 'Unknown'}</dd></div>
                          <div className="min-w-0"><dt className="text-xs text-neutral-500">Page</dt><dd className="font-mono text-xs text-neutral-800 break-all pt-0.5">{r.page}</dd></div>
                        </dl>
                        {r.status === 'resolved' && <Badge variant="success">Resolved</Badge>}
                      </div>
                      <p className="text-sm text-neutral-800 whitespace-pre-wrap break-words">{r.description}</p>
                      <ReportDetails report={r} />
                      {(r.resolvedAt || r.archivedAt) && (
                        <p className="text-xs text-neutral-500">
                          {r.resolvedAt ? `Resolved ${format(new Date(r.resolvedAt), 'MMM d, yyyy')}${r.resolvedBy ? ` by ${r.resolvedBy}` : ''}` : ''}
                          {r.resolvedAt && r.archivedAt ? ' · ' : ''}
                          {r.archivedAt ? `Archived ${format(new Date(r.archivedAt), 'MMM d, yyyy')}${r.archivedBy ? ` by ${r.archivedBy}` : ''}` : ''}
                        </p>
                      )}
                      {admin && (
                        <div className="flex flex-wrap gap-2">
                          {!r.archived && (
                            r.status === 'open' ? (
                              <Button size="sm" variant="secondary" disabled={busy !== null}
                                onClick={() => void act(r, () => setBugReportStatus(r.id, 'resolved'), 'Marked resolved')}>
                                <CheckCircle size={14} /> Mark resolved
                              </Button>
                            ) : (
                              <Button size="sm" variant="secondary" disabled={busy !== null}
                                onClick={() => void act(r, () => setBugReportStatus(r.id, 'open'), 'Reopened')}>
                                <RotateCcw size={14} /> Reopen
                              </Button>
                            )
                          )}
                          {r.archived ? (
                            <Button size="sm" variant="secondary" disabled={busy !== null}
                              onClick={() => void act(r, () => setBugReportArchived(r.id, false), 'Restored')}>
                              <RotateCcw size={14} /> Restore
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={busy !== null}
                              onClick={() => confirm({
                                title: 'Archive this report?',
                                message: 'It moves to the Archived tab. Nothing is deleted, and you can restore it from there.',
                                confirmLabel: 'Archive report',
                              }, () => act(r, () => setBugReportArchived(r.id, true), 'Archived'))}>
                              <Archive size={14} /> Archive
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </div>
      {dialog}
    </div>
  );
}
