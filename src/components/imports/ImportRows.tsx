import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { FileUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { Missing } from '../common/Missing';
import { Pagination } from '../common/Pagination';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { HeaderWithInfo } from '../common/InfoTip';
import { COLUMN_HELP } from '../../constants/columnHelp';
import { ColGroup, cellClass, headClass, tableProps, type ColumnSpec } from '../common/tableColumns';
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

/** Row, School as typed, City, State, Matched school, Visitors, Name. */
const ROW_COLUMNS: ColumnSpec[] = [
  { kind: 'number', width: '4.5rem' }, 'primary', { kind: 'text', width: '9rem' }, { kind: 'text', width: '5rem' },
  { kind: 'text', width: '16rem' }, 'number', { kind: 'text', width: '15rem' },
];

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

  // Same look as the other tables (DataTable): grey header, 25 rows a page, nothing cut
  // off: long school names wrap.
  const [page, setPage] = useState(0);
  const PAGE = 25;
  const pages = rows ? Math.max(1, Math.ceil(rows.length / PAGE)) : 1;
  const current = Math.min(page, pages - 1);
  const shown = rows ? rows.slice(current * PAGE, (current + 1) * PAGE) : [];
  const th = (i: number) => headClass(ROW_COLUMNS[i]);
  const td = (i: number) => `${cellClass(ROW_COLUMNS[i])} align-top text-sm text-neutral-700 break-words`;
  return (
    <Modal open onClose={onClose} title={`Rows of ${batch.fileName}`} size="wide">
      {error ? (
        <p className="text-sm text-error">{error}</p>
      ) : rows === null ? (
        <p className="text-sm text-neutral-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-600">
          This batch was saved before rows were kept. Use “Add rows from the original file” to add them.
        </p>
      ) : (
        <>
          <div className="max-h-[65vh] overflow-auto rounded-lg border border-neutral-100">
            <table {...tableProps(ROW_COLUMNS, 'divide-y divide-neutral-100')}>
              <ColGroup specs={ROW_COLUMNS} />
              <thead className="bg-neutral-50 sticky top-0 z-10">
                <tr>
                  <th className={th(0)}>Row</th>
                  <th className={th(1)}><HeaderWithInfo label="School as typed" info={COLUMN_HELP.schoolAsTyped} /></th>
                  <th className={th(2)}>City</th>
                  <th className={th(3)}>State</th>
                  <th className={th(4)}><HeaderWithInfo label="Matched school" info={COLUMN_HELP.matchedSchool} /></th>
                  <th className={th(5)}><HeaderWithInfo label="Visitors" info={COLUMN_HELP.visitors} /></th>
                  <th className={th(6)}>Name</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-neutral-50">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className={`${td(0)} text-neutral-500`}>{r.rowNumber}</td>
                    <td className={td(1)}>{r.schoolAsTyped || <Missing label="Blank" />}</td>
                    <td className={td(2)}>{r.cityAsTyped || <Missing label="No city" />}</td>
                    <td className={td(3)}>{r.stateAsTyped || <Missing label="No state" />}</td>
                    <td className={td(4)}>
                      {r.schoolId ? getSchoolById(r.schoolId)?.name ?? 'An archived school' : <Missing label="Not matched" />}
                    </td>
                    <td className={td(5)}>{r.visitors ?? 1}</td>
                    <td className={td(6)}>
                      {r.visitorName ? (
                        <div className="flex items-start justify-between gap-3">
                          <span className="min-w-0 break-words">{r.visitorName}</span>
                          <button type="button" onClick={() => setRemoving(r)} className="shrink-0 text-xs text-neutral-500 hover:text-error underline">
                            Remove name
                          </button>
                        </div>
                      ) : <Missing label="No name" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination pageIndex={current} pageSize={PAGE} total={rows.length} onPageChange={setPage} noun="rows" />
        </>
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
