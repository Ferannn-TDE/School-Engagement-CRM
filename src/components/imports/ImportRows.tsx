import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { Missing } from '../common/Missing';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useAppContext } from '../../context/useAppContext';
import { fileHash, readActivityWorkbook } from '../../utils/activityImportFile';
import { matchRows, type MatchSchool } from '../../utils/activityImportMatch';
import { parseVisitors } from '../../utils/visitors';
import { writeErrorMessage } from '../../utils/writeErrors';
import {
  attachImportRows,
  fetchImportRows,
  removeVisitorName,
  type ImportBatch,
  type ImportRow,
  type NewImportRow,
} from '../../services/importBatchesService';

// The rows of an activity import (db/029): what each row said, which school it matched,
// its visitors and an optional name. Names are student data: only editors and admins
// can read import_rows (RLS), and the Import page is editors-only anyway.

/** "View rows": a batch's saved rows in a table. */
export function BatchRowsModal({ batch, onClose }: { batch: ImportBatch; onClose: () => void }) {
  const { getSchoolById } = useAppContext();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<ImportRow | null>(null);

  useEffect(() => {
    let live = true;
    fetchImportRows(batch.id)
      .then((r) => { if (live) setRows(r); })
      .catch((err: unknown) => { if (live) setError(writeErrorMessage(err, 'The rows couldn’t be loaded.')); });
    return () => { live = false; };
  }, [batch.id]);

  const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500';
  return (
    <Modal open onClose={onClose} title={`Rows of ${batch.fileName}`} size="xl">
      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : rows === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          This batch was saved before rows were kept. Use “Add rows from the original file” to add them.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-neutral-100">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: '4rem' }} />
              <col />
              <col />
              <col style={{ width: '6rem' }} />
              <col />
            </colgroup>
            <thead className="bg-neutral-50 sticky top-0">
              <tr>
                <th className={th}>Row</th>
                <th className={th}>School as typed</th>
                <th className={th}>Matched school</th>
                <th className={`${th} text-right`}>Visitors</th>
                <th className={th}>Name</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {rows.map((r) => (
                <tr key={r.id} style={{ height: '3rem' }}>
                  <td className="px-3 text-neutral-500 tabular-nums">{r.rowNumber}</td>
                  <td className="px-3 truncate" title={[r.schoolAsTyped, r.cityAsTyped, r.stateAsTyped].filter(Boolean).join(', ')}>
                    {r.schoolAsTyped || <Missing label="Blank" />}
                    {(r.cityAsTyped || r.stateAsTyped) && (
                      <span className="text-neutral-500"> ({[r.cityAsTyped, r.stateAsTyped].filter(Boolean).join(', ')})</span>
                    )}
                  </td>
                  <td className="px-3 truncate">
                    {r.schoolId ? getSchoolById(r.schoolId)?.name ?? 'An archived school' : <Missing label="Not matched" />}
                  </td>
                  <td className="px-3 text-right tabular-nums">{r.visitors ?? 1}</td>
                  <td className="px-3">
                    {r.visitorName ? (
                      <span className="flex items-center justify-between gap-2 min-w-0">
                        <span className="truncate">{r.visitorName}</span>
                        <button type="button" onClick={() => setRemoving(r)} className="shrink-0 text-xs text-neutral-500 hover:text-error underline">
                          Remove name
                        </button>
                      </span>
                    ) : <Missing label="No name" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this name?"
        message={removing ? `Row ${removing.rowNumber}: the name “${removing.visitorName}” is blanked. The row, its school and its visitor count stay. This can’t be undone from the app.` : ''}
        confirmLabel="Remove name"
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeVisitorName(removing.id);
            setRows((rs) => rs?.map((x) => (x.id === removing.id ? { ...x, visitorName: null } : x)) ?? rs);
            toast.success('Name removed');
          } catch (err) {
            toast.error(writeErrorMessage(err, 'The name couldn’t be removed.'));
          }
          setRemoving(null);
        }}
      />
    </Modal>
  );
}

/**
 * "Add rows from the original file", for a batch saved before rows were kept. The file
 * must be the same one (its SHA-256 is checked here and again by the database), and the
 * rows are only linked to the schools the batch already has. No activity is created.
 */
export function AttachRowsButton({ batch, onDone }: { batch: ImportBatch; onDone: () => void }) {
  const { state } = useAppContext();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if ((await fileHash(bytes)) !== batch.fileHash) {
        toast.error(`That isn’t the file “${batch.fileName}” was imported from. Choose the original file, unchanged.`);
        return;
      }
      const read = readActivityWorkbook(XLSX.read(bytes, { type: 'array', raw: true }));
      if (!read.ok) {
        toast.error('No rows could be read from that file.');
        return;
      }
      // Each row's school: the first match that's one of this batch's schools.
      const batchSchools = new Set(state.activities.filter((a) => a.importBatchId === batch.id).map((a) => a.schoolId));
      const schools: MatchSchool[] = state.schools.map((s) => ({ id: s.id, name: s.name, city: s.city, state: s.state }));
      const rows: NewImportRow[] = matchRows(read.rows, schools)
        .filter((r) => r.outcome !== 'header' && r.outcome !== 'blank')
        .map((r) => {
          const school = r.candidates.map((c) => c.school.id).find((id) => batchSchools.has(id)) ?? null;
          return {
            rowNumber: r.row,
            schoolAsTyped: r.name,
            cityAsTyped: r.city,
            stateAsTyped: r.state,
            schoolId: school,
            visitors: parseVisitors(r.visitors ?? '').value,
            visitorName: r.visitorName?.trim() || null,
          };
        })
        .filter((r) => r.schoolId !== null);
      const n = await attachImportRows(batch.id, batch.fileHash, rows);
      toast.success(`Added ${n} rows to ${batch.fileName}`);
      onDone();
    } catch (err) {
      toast.error(writeErrorMessage(err, 'The rows couldn’t be added.'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="sr-only"
        aria-label={`Original file for ${batch.fileName}`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
      />
      <Button size="sm" variant="ghost" loading={busy} onClick={() => input.current?.click()}>
        <FileUp size={14} /> Add rows from the original file
      </Button>
    </>
  );
}
