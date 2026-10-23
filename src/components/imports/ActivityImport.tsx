import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { AlertTriangle, Archive, CheckCircle, Download, RotateCcw, Search, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../common/Card';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Textarea } from '../common/Textarea';
import { Badge } from '../common/Badge';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ArchivedMatchesPanel } from './ArchivedMatchesPanel';
import { useAppContext } from '../../context/useAppContext';
import {
  hasSchoolRows,
  matchRows,
  searchSchools,
  type MatchSchool,
  type RowMatch,
  type RowOutcome,
} from '../../utils/activityImportMatch';
import { buildActivityTemplate, fileHash, planActivities, readActivityWorkbook } from '../../utils/activityImportFile';
import { looksLikeSpreadsheet } from '../../utils/importParsing';
import { describeFileRejection, formatBytes, MAX_UPLOAD_BYTES } from '../../utils/helpers';
import type { ArchivedDecision, ArchivedMatch } from '../../utils/archivedMatches';
import { restoreItem } from '../../services/archiveService';
import {
  archiveImportBatch,
  createImportBatch,
  fetchArchivedSchoolsForMatching,
  fetchRecentImportBatches,
  findImportBatchesByHash,
  restoreImportBatch,
  type ImportBatch,
} from '../../services/importBatchesService';

// Import → Import Activities: a list of schools (the client's template, e.g. the
// attendees of an event) becomes one activity per school, all with the details chosen
// here, saved as one batch that can be archived as a whole (db/022). Matching rules:
// utils/activityImportMatch.ts. Nothing is saved until "Save"; uncertain matches are
// never picked for the user, schools are never created, archived schools are never
// restored without asking.

const IMPORT_ACTIVITY_TYPES: Record<string, string> = {
  event_participation: 'Event attendance',
  visit: 'Visit',
  call: 'Phone call',
  email: 'Email',
};

const OUTCOME_LABELS: Record<Exclude<RowOutcome, 'header' | 'blank' | 'not_a_school'>, string> = {
  matched: 'Matched',
  suggested: 'Suggested',
  not_k12: 'Not a K-12 school',
  not_found: 'Not found',
};

interface Details {
  activityType: string;
  date: string;
  description: string;
  eventId: string;
}

interface Preview {
  fileName: string;
  hash: string;
  results: RowMatch[];
  schools: MatchSchool[];
  /** Earlier batches from a file with the same bytes; null if the check failed. */
  priorBatches: ImportBatch[] | null;
  hashCheckError?: string;
  archivedCheckError?: string;
}

const placeLabel = (s: { city: string; state: string }) => [s.city, s.state].filter(Boolean).join(', ');

function SchoolSearch({ schools, preferState, onPick }: { schools: MatchSchool[]; preferState: string; onPick: (s: MatchSchool) => void }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSchools(query, schools, preferState), [query, schools, preferState]);
  return (
    <div className="mt-2 max-w-md">
      <label className="relative block">
        <span className="sr-only">Search for a school</span>
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search schools by name or city"
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-siue-red"
        />
      </label>
      {query.trim() && (
        <ul className="mt-1 border border-neutral-200 rounded-md divide-y divide-neutral-100 bg-white">
          {results.length === 0 && <li className="px-3 py-2 text-xs text-neutral-500">No school starts with those words.</li>}
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => { onPick(s); setQuery(''); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                {s.name} <span className="text-neutral-500">({placeLabel(s)})</span>
                {s.archived && <Badge variant="default" className="ml-2">Archived</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentImports({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ImportBatch | null>(null);

  const load = useCallback(() => {
    fetchRecentImportBatches()
      .then((b) => { setBatches(b); setError(null); })
      .catch((err: unknown) => setError((err as { message?: string })?.message ?? String(err)));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const restore = async (b: ImportBatch) => {
    try {
      await restoreImportBatch(b.id);
      toast.success(`Restored ${b.fileName}`);
      load();
      onChanged();
    } catch (err) {
      toast.error(`Couldn't restore: ${(err as { message?: string })?.message ?? err}`);
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold text-neutral-800">Recent imports</h2>
      <p className="text-sm text-neutral-500 mt-1 mb-4">
        Each saved upload is one batch. Archiving a batch archives its activities; Restore brings them back.
      </p>
      {error ? (
        <p className="text-sm text-neutral-600">Recent imports couldn't be loaded: {error}</p>
      ) : batches === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-sm text-neutral-500">No activity imports yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {batches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800">
                  {b.fileName}
                  {b.archived && <Badge variant="default" className="ml-2">Archived</Badge>}
                </p>
                <p className="text-xs text-neutral-500">
                  {IMPORT_ACTIVITY_TYPES[b.activityType] ?? b.activityType} on {format(new Date(`${b.activityDate}T12:00:00`), 'MMM d, yyyy')}
                  {' · '}{b.activityCount} activit{b.activityCount === 1 ? 'y' : 'ies'} from {b.rowCount} rows
                  {' · '}imported {format(new Date(b.createdAt), 'MMM d, yyyy h:mm a')}{b.createdBy ? ` by ${b.createdBy}` : ''}
                  {b.archived && b.archivedAt ? ` · archived ${format(new Date(b.archivedAt), 'MMM d, yyyy')}${b.archivedBy ? ` by ${b.archivedBy}` : ''}` : ''}
                </p>
              </div>
              {b.archived ? (
                <Button size="sm" variant="secondary" onClick={() => void restore(b)}>
                  <RotateCcw size={14} /> Restore
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirm(b)}>
                  <Archive size={14} /> Archive this batch
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Archive this batch?"
        message={confirm ? `The ${confirm.activityCount - confirm.archivedActivityCount} active activities from "${confirm.fileName}" leave the school pages and reports. Nothing is deleted: Restore here brings them back.` : ''}
        confirmLabel="Archive batch"
        variant="secondary"
        onConfirm={async () => {
          if (!confirm) return;
          try {
            await archiveImportBatch(confirm.id);
          } catch (err) {
            toast.error(`Couldn't archive: ${(err as { message?: string })?.message ?? err}`);
            throw err;
          }
          toast.success(`Archived ${confirm.fileName}`);
          load();
          onChanged();
        }}
      />
    </Card>
  );
}

export function ActivityImport() {
  const { state, reload } = useAppContext();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [details, setDetails] = useState<Details>({ activityType: 'event_participation', date: '', description: '', eventId: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<number, string | null>>({});
  const [searching, setSearching] = useState<Record<number, boolean>>({});
  const [archivedDecisions, setArchivedDecisions] = useState<Record<string, ArchivedDecision>>({});
  const [repeatAcknowledged, setRepeatAcknowledged] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ activities: number; rows: number; fileName: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const dateError = !details.date ? 'Choose the date' : details.date > today ? 'The date can’t be in the future' : '';
  const detailsReady = !!details.activityType && !dateError;

  const eventOptions = useMemo(
    () =>
      state.events
        .filter((e) => e.id.startsWith('e_') && e.category !== 'school_testing_date')
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((e) => ({ value: e.id, label: `${e.name} (${format(new Date(e.date), 'MMM d, yyyy')})` })),
    [state.events]
  );

  const schoolById = useMemo(() => new Map((preview?.schools ?? []).map((s) => [s.id, s])), [preview]);

  // A school that already has an activity with this date, type and event.
  const duplicateOf = useCallback(
    (schoolId: string) =>
      state.activities.find(
        (a) =>
          a.schoolId === schoolId &&
          a.date.slice(0, 10) === details.date &&
          a.activityType === details.activityType &&
          (a.eventId ?? '') === details.eventId
      ),
    [state.activities, details]
  );

  const parseFile = (file: File) => {
    setParseError(null);
    setParsing(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setParsing(false);
      setParseError(`We couldn't read "${file.name}". The file may be in use by another program — close it in Excel and try again.`);
    };
    reader.onload = async (e) => {
      try {
        const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
        const isCsv = file.name.toLowerCase().endsWith('.csv');
        if (!isCsv && !looksLikeSpreadsheet(bytes)) {
          setParsing(false);
          setParseError(`"${file.name}" doesn't look like a real Excel file, even though it's named like one. Try opening it in Excel and re-saving it as .xlsx, then upload again.`);
          return;
        }
        const read = readActivityWorkbook(XLSX.read(bytes, { type: 'array', raw: true }));
        if (!read.ok) {
          setParsing(false);
          setParseError(read.reason === 'no-sheets' ? `"${file.name}" has no sheets in it.` : `"${file.name}" has no schools in it.`);
          return;
        }

        let archived: MatchSchool[] = [];
        let archivedCheckError: string | undefined;
        try {
          archived = await fetchArchivedSchoolsForMatching();
        } catch (err) {
          archivedCheckError = (err as { message?: string })?.message ?? String(err);
        }
        const schools: MatchSchool[] = [
          ...state.schools.map((s) => ({ id: s.id, name: s.name, city: s.city, state: s.state })),
          ...archived,
        ];
        const results = matchRows(read.rows, schools);
        if (!hasSchoolRows(results)) {
          setParsing(false);
          setParseError(`"${file.name}" has only a header row. Add one school per row under it, then upload again.`);
          return;
        }

        const hash = await fileHash(bytes);
        let priorBatches: ImportBatch[] | null = null;
        let hashCheckError: string | undefined;
        try {
          priorBatches = await findImportBatchesByHash(hash);
        } catch (err) {
          hashCheckError = (err as { message?: string })?.message ?? String(err);
        }

        // Matched rows start ticked, unless the school already has this activity.
        // Every other outcome starts unticked: the person picks or skips.
        const initial: Record<number, string | null> = {};
        for (const r of results) {
          const top = r.candidates[0]?.school;
          initial[r.row] = r.outcome === 'matched' && top && !duplicateOf(top.id) ? top.id : null;
        }
        setChoices(initial);
        setSearching({});
        setArchivedDecisions({});
        setRepeatAcknowledged(false);
        setPreview({ fileName: file.name, hash, results, schools, priorBatches, hashCheckError, archivedCheckError });
      } catch (err) {
        console.error('Activity import parse failed:', err);
        setParseError(`We couldn't read "${file.name}". It may be damaged or not a real spreadsheet. Try re-saving it as .xlsx, then upload again.`);
      } finally {
        setParsing(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    disabled: parsing || !detailsReady,
    onDrop: (files) => { if (files[0]) parseFile(files[0]); },
    onDropRejected: (rejections) => {
      const message = describeFileRejection(rejections[0], 'a CSV or Excel file (.csv, .xlsx, .xls)');
      setParseError(message);
      toast.error(message);
    },
  });

  // Rows whose chosen school is archived count only once the person chooses Restore.
  const archivedMatches: ArchivedMatch[] = useMemo(() => {
    const byKey = new Map<string, ArchivedMatch>();
    for (const [row, id] of Object.entries(choices)) {
      const s = id ? schoolById.get(id) : undefined;
      if (!s?.archived) continue;
      const key = `school:${s.id}`;
      const m = byKey.get(key) ?? { key, kind: 'school' as const, id: s.id, label: `${s.name} (${placeLabel(s)})`, rows: [] };
      m.rows.push(`Row ${row}`);
      byKey.set(key, m);
    }
    return [...byKey.values()];
  }, [choices, schoolById]);

  const isUsed = useCallback(
    (row: number) => {
      const id = choices[row];
      if (!id) return false;
      const s = schoolById.get(id);
      return !s?.archived || archivedDecisions[`school:${id}`] === 'restore';
    },
    [choices, schoolById, archivedDecisions]
  );

  const plan = useMemo(
    () => planActivities((preview?.results ?? []).map((r) => ({ row: r.row, schoolId: isUsed(r.row) ? choices[r.row] : null }))),
    [preview, choices, isUsed]
  );
  const usedRows = plan.reduce((n, p) => n + p.rows.length, 0);
  const repeatBlocked = !!preview?.priorBatches?.length && !repeatAcknowledged;

  const reset = () => {
    setPreview(null);
    setChoices({});
    setParseError(null);
  };

  const save = async () => {
    if (!preview || !plan.length) return;
    setSaving(true);
    try {
      for (const m of archivedMatches) {
        if (archivedDecisions[m.key] === 'restore' && plan.some((p) => p.schoolId === m.id)) {
          await restoreItem('school', m.id);
        }
      }
      await createImportBatch({
        fileName: preview.fileName,
        fileHash: preview.hash,
        rowCount: preview.results.filter((r) => r.outcome !== 'header' && r.outcome !== 'blank').length,
        activityType: details.activityType,
        activityDate: details.date,
        description: details.description.trim(),
        eventId: details.eventId || undefined,
        activities: plan,
      });
      setSaved({ activities: plan.length, rows: usedRows, fileName: preview.fileName });
      toast.success(`Saved ${plan.length} activities`);
      reset();
      setRefreshKey((k) => k + 1);
      await reload();
    } catch (err) {
      console.error('Activity import save failed:', err);
      toast.error(`Nothing was saved: ${(err as { message?: string })?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  const setChoice = (row: number, id: string | null) => setChoices((c) => ({ ...c, [row]: id }));

  const groups = (['matched', 'suggested', 'not_k12', 'not_found'] as const).map((outcome) => ({
    outcome,
    rows: (preview?.results ?? []).filter((r) => r.outcome === outcome),
  }));
  const skippedRows = (preview?.results ?? []).filter((r) => r.outcome === 'not_a_school' || r.outcome === 'header');

  const renderChosen = (r: RowMatch) => {
    const id = choices[r.row];
    const s = id ? schoolById.get(id) : undefined;
    if (!s) return <span className="text-neutral-400">Skipped</span>;
    const dup = duplicateOf(s.id);
    return (
      <span>
        {s.name} <span className="text-neutral-500">({placeLabel(s)})</span>
        {s.archived && <Badge variant="default" className="ml-2">Archived</Badge>}
        {dup && <Badge variant="warning" className="ml-2">Possible duplicate</Badge>}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {!preview && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-neutral-800">Import activities from a list of schools</h2>
              <p className="text-sm text-neutral-500 mt-1 max-w-2xl">
                One row per attendee: school name, city, state. Each school becomes one activity with the details below;
                a school listed several times gets one activity with an attendee count.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => XLSX.writeFile(buildActivityTemplate(), 'activity-import-template.xlsx')}>
              <Download size={14} /> Download template
            </Button>
          </div>

          {saved && (
            <p role="status" className="mb-4 flex items-center gap-2 text-sm text-success">
              <CheckCircle size={16} /> Saved {saved.activities} activities from {saved.rows} rows of “{saved.fileName}”. It’s listed under Recent imports.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            <Select
              label="Activity type"
              required
              value={details.activityType}
              onChange={(e) => setDetails((d) => ({ ...d, activityType: e.target.value }))}
              options={Object.entries(IMPORT_ACTIVITY_TYPES).map(([value, label]) => ({ value, label }))}
            />
            <Input
              label="Date"
              type="date"
              required
              max={today}
              value={details.date}
              error={details.date ? dateError || undefined : undefined}
              onChange={(e) => setDetails((d) => ({ ...d, date: e.target.value }))}
            />
            <Select
              label="Linked event (optional)"
              value={details.eventId}
              onChange={(e) => {
                const eventId = e.target.value;
                const ev = state.events.find((x) => x.id === eventId);
                const evDay = ev?.date.slice(0, 10);
                setDetails((d) => ({ ...d, eventId, date: !d.date && evDay && evDay <= today ? evDay : d.date }));
              }}
              options={[{ value: '', label: 'No event' }, ...eventOptions]}
            />
            <Textarea
              label="Description"
              rows={2}
              value={details.description}
              onChange={(e) => setDetails((d) => ({ ...d, description: e.target.value }))}
              placeholder="e.g. Students attended Engineering Day"
            />
          </div>

          {parseError && (
            <div role="alert" className="mb-4 flex items-start gap-2 p-3 rounded-lg border border-error/30 bg-error/5 text-sm text-neutral-800">
              <AlertTriangle size={16} className="text-error shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              !detailsReady
                ? 'border-neutral-200 bg-neutral-50 cursor-not-allowed'
                : parsing
                  ? 'border-neutral-200 bg-neutral-50 cursor-wait'
                  : isDragActive
                    ? 'border-siue-red bg-red-50 cursor-pointer'
                    : 'border-neutral-300 hover:border-siue-red cursor-pointer'
            }`}
          >
            <input {...getInputProps()} aria-label="Upload a list of schools" />
            <Upload size={28} className="mx-auto mb-2 text-neutral-400" />
            <p className="text-sm font-medium text-neutral-700">
              {!detailsReady ? 'Choose the activity type and date first' : parsing ? 'Reading the file…' : 'Drag and drop the list, or click to browse'}
            </p>
            <p className="text-xs text-neutral-500 mt-1">
              .xlsx, .xls or .csv, up to {formatBytes(MAX_UPLOAD_BYTES)}. Columns: school name, city, state, with or without a header.
            </p>
          </div>
        </Card>
      )}

      {preview && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-neutral-800">Preview: {preview.fileName}</h2>
              <p className="text-sm text-neutral-500 mt-1">
                {IMPORT_ACTIVITY_TYPES[details.activityType]} on {format(new Date(`${details.date}T12:00:00`), 'MMM d, yyyy')}
                {details.eventId && ` · ${state.events.find((e) => e.id === details.eventId)?.name ?? ''}`}. Nothing is saved until you choose Save.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>Cancel</Button>
          </div>

          {preview.priorBatches && preview.priorBatches.length > 0 && (
            <div role="alert" className="mb-4 p-3 rounded-lg border border-warning/40 bg-warning/10 text-sm text-neutral-800">
              <p className="font-medium flex items-center gap-2"><AlertTriangle size={16} className="text-warning" /> This file was imported before</p>
              <ul className="mt-1 ml-6 list-disc text-neutral-700">
                {preview.priorBatches.map((b) => (
                  <li key={b.id}>
                    {format(new Date(b.createdAt), 'MMM d, yyyy')}{b.createdBy ? ` by ${b.createdBy}` : ''}
                    {b.archived ? ' (archived since)' : ''}
                  </li>
                ))}
              </ul>
              {!repeatAcknowledged && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setRepeatAcknowledged(true)}>It’s a different visit: continue</Button>
                  <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>
                </div>
              )}
            </div>
          )}
          {preview.hashCheckError && (
            <p className="mb-4 text-sm text-neutral-600">Couldn’t check whether this file was imported before ({preview.hashCheckError}).</p>
          )}
          {preview.archivedCheckError && (
            <p className="mb-4 text-sm text-neutral-600">Couldn’t check for archived schools ({preview.archivedCheckError}); a row naming one will show as Not found.</p>
          )}

          <div className="flex flex-wrap gap-2 mb-6 text-sm">
            {groups.map((g) => (
              <a key={g.outcome} href={`#ai-${g.outcome}`} className="px-3 py-1.5 rounded-full bg-neutral-100 text-neutral-700 hover:bg-neutral-200">
                {OUTCOME_LABELS[g.outcome]} <strong>{g.rows.length}</strong>
              </a>
            ))}
            <span className="px-3 py-1.5 rounded-full bg-neutral-100 text-neutral-500">Skipped rows {skippedRows.length}</span>
          </div>

          <ArchivedMatchesPanel matches={archivedMatches} decisions={archivedDecisions} onChange={setArchivedDecisions} disabled={saving} />

          {groups.map(({ outcome, rows }) =>
            rows.length === 0 ? null : (
              <section key={outcome} id={`ai-${outcome}`} className="mb-6" aria-label={OUTCOME_LABELS[outcome]}>
                <h3 className="text-sm font-semibold text-neutral-800 mb-1">
                  {OUTCOME_LABELS[outcome]} <span className="font-normal text-neutral-500">({rows.length} rows)</span>
                </h3>
                <p className="text-xs text-neutral-500 mb-2">
                  {outcome === 'matched' && 'Ticked. Untick any that are wrong. "Worded differently" means the file\'s name isn\'t the database name; check those.'}
                  {outcome === 'suggested' && 'Uncertain: pick the right school or leave it skipped. Never picked for you.'}
                  {outcome === 'not_k12' && 'Colleges and online schools aren\'t in the schools list. Skipped unless you pick a school.'}
                  {outcome === 'not_found' && 'No school matched. Search for it, or leave it skipped.'}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                        <th className="py-2 pr-3 w-12">Use</th>
                        <th className="py-2 pr-3 w-12">Row</th>
                        <th className="py-2 pr-3">In the file</th>
                        <th className="py-2 pr-3">School</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {rows.map((r) => {
                        const top = r.candidates[0]?.school;
                        const chosen = choices[r.row];
                        const chosenSchool = chosen ? schoolById.get(chosen) : undefined;
                        return (
                          <tr key={r.row} className="align-top">
                            <td className="py-2 pr-3">
                              <input
                                type="checkbox"
                                aria-label={`Use row ${r.row}`}
                                checked={isUsed(r.row)}
                                disabled={!chosen || (chosenSchool?.archived ?? false) || saving}
                                onChange={(e) => setChoice(r.row, e.target.checked ? chosen ?? null : null)}
                                className="accent-siue-red"
                              />
                            </td>
                            <td className="py-2 pr-3 text-neutral-500">{r.row}</td>
                            <td className="py-2 pr-3">
                              {r.name} <span className="text-neutral-500">({placeLabel(r) || 'no city or state'})</span>
                            </td>
                            <td className="py-2 pr-3">
                              {outcome === 'matched' && (
                                <>
                                  {chosen ? renderChosen(r) : (
                                    <button type="button" className="text-info hover:underline" onClick={() => setChoice(r.row, top?.id ?? null)}>
                                      Use {top?.name} ({top && placeLabel(top)})
                                    </button>
                                  )}
                                  {!r.identical && <Badge variant="info" className="ml-2">Worded differently</Badge>}
                                  {!chosen && top && duplicateOf(top.id) && <Badge variant="warning" className="ml-2">Possible duplicate</Badge>}
                                </>
                              )}
                              {outcome === 'suggested' && (
                                <fieldset>
                                  <legend className="sr-only">School for row {r.row}</legend>
                                  <p className="text-xs text-neutral-500 mb-1">{r.reasons.join(' · ')}</p>
                                  {r.candidates.map((c) => (
                                    <label key={c.school.id} className="flex items-center gap-2 py-0.5">
                                      <input type="radio" name={`row-${r.row}`} className="accent-siue-red" checked={chosen === c.school.id} onChange={() => setChoice(r.row, c.school.id)} disabled={saving} />
                                      <span>
                                        {c.school.name} <span className="text-neutral-500">({placeLabel(c.school)})</span>
                                        {c.school.archived && <Badge variant="default" className="ml-2">Archived</Badge>}
                                        {duplicateOf(c.school.id) && <Badge variant="warning" className="ml-2">Possible duplicate</Badge>}
                                      </span>
                                    </label>
                                  ))}
                                  <label className="flex items-center gap-2 py-0.5">
                                    <input type="radio" name={`row-${r.row}`} className="accent-siue-red" checked={!chosen} onChange={() => setChoice(r.row, null)} disabled={saving} />
                                    <span className="text-neutral-600">Skip</span>
                                  </label>
                                  {chosen && !r.candidates.some((c) => c.school.id === chosen) && <p className="mt-1">{renderChosen(r)}</p>}
                                </fieldset>
                              )}
                              {(outcome === 'not_k12' || outcome === 'not_found') && (
                                <>
                                  {chosen ? (
                                    <span>
                                      {renderChosen(r)}
                                      <button type="button" className="ml-2 text-xs text-info hover:underline" onClick={() => setChoice(r.row, null)}>Clear</button>
                                    </span>
                                  ) : (
                                    <span className="text-neutral-500">
                                      {outcome === 'not_k12' ? r.reasons.join('; ') : 'Skipped'}
                                    </span>
                                  )}
                                </>
                              )}
                              {outcome !== 'matched' && (
                                searching[r.row] || outcome === 'not_found' ? (
                                  <SchoolSearch schools={preview.schools} preferState={r.state} onPick={(s) => setChoice(r.row, s.id)} />
                                ) : (
                                  <button type="button" className="block mt-1 text-xs text-info hover:underline" onClick={() => setSearching((x) => ({ ...x, [r.row]: true }))}>
                                    Search for another school
                                  </button>
                                )
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          )}

          {skippedRows.length > 0 && (
            <details className="mb-6 text-sm">
              <summary className="cursor-pointer text-neutral-700">Skipped rows ({skippedRows.length}): headers and placeholders such as “None”</summary>
              <ul className="mt-2 ml-4 list-disc text-neutral-600">
                {skippedRows.map((r) => (
                  <li key={r.row}>Row {r.row}: {r.name || '(empty)'} {r.outcome === 'header' ? '(header row)' : '(not a school)'}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-200">
            <p className="text-sm text-neutral-700">
              <strong>{plan.length}</strong> activit{plan.length === 1 ? 'y' : 'ies'} from {usedRows} row{usedRows === 1 ? '' : 's'}
              {plan.some((p) => p.attendeeCount > 1) && `, ${plan.filter((p) => p.attendeeCount > 1).length} with an attendee count above 1`}.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={reset} disabled={saving}>Cancel</Button>
              <Button onClick={() => void save()} loading={saving} disabled={saving || plan.length === 0 || repeatBlocked}>
                Save {plan.length} activit{plan.length === 1 ? 'y' : 'ies'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <RecentImports refreshKey={refreshKey} onChanged={() => void reload()} />
    </div>
  );
}
