import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { TOOLTIP_CLS } from '../../constants/charts';
import { downloadFile, classNames } from '../../utils/helpers';
import { fmt, listToCsv, pct, type ListSpec } from '../../utils/reportLists';

export function ReportSection({ label, question, takeaway, children, source }: {
  label: string;
  question: string;
  takeaway?: ReactNode;
  children: ReactNode;
  source: string;
}) {
  return (
    <section className="bg-white rounded-xl border border-neutral-100 shadow-sm p-5 sm:p-6 space-y-5" aria-label={label}>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
        <h2 className="text-lg font-semibold text-neutral-800 text-balance">{question}</h2>
      </div>
      {takeaway && <p className="text-[15px] text-neutral-800 max-w-3xl">{takeaway}</p>}
      {children}
      <p className="text-xs text-neutral-500 border-t border-neutral-100 pt-3">Counted from: {source}</p>
    </section>
  );
}

/** A number that opens the list behind it. */
export function Figure({ value, list, onOpen }: { value: number | string; list: () => ListSpec; onOpen: (list: ListSpec) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(list())}
      className="underline decoration-dotted decoration-neutral-400 underline-offset-[5px] decoration-1 hover:decoration-siue-red focus-visible:outline-2 focus-visible:outline-info rounded-sm"
      title="Show the list behind this number"
    >
      {typeof value === 'number' ? fmt(value) : value}
    </button>
  );
}

export function Tile({ label, value, of, note, hero }: { label: string; value: ReactNode; of?: string; note?: ReactNode; hero?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={classNames('font-semibold text-neutral-800 tracking-tight', hero ? 'text-5xl leading-tight' : 'text-3xl')}>
        {value}
        {of && <span className="text-base font-medium text-neutral-500"> {of}</span>}
      </p>
      {note && <p className="text-xs text-neutral-600">{note}</p>}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">{children}</div>;
}

export function Note({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 space-y-0.5">
      <p className="font-semibold text-neutral-800">{title}</p>
      {children && <p>{children}</p>}
    </div>
  );
}

/** A share of a whole as a thin bar, with its figure. */
export function Meter({ label, part, whole, figure }: { label: string; part: number; whole: number; figure: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="text-neutral-700 truncate">{label}</span>
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
        <div className="h-full rounded-full bg-[#2a78d6]" style={{ width: `${pct(part, whole)}%` }} />
      </div>
      <span className="text-xs text-neutral-600 tabular-nums whitespace-nowrap">{figure}</span>
    </div>
  );
}

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

/** Columns: one series (each bar can take its own colour) or several stacked, with a legend. */
export function Columns({ rows, xKey, series, colorFor, onPick, ariaLabel, height = 220 }: {
  rows: Array<Record<string, string | number>>;
  xKey: string;
  series: ColumnSeries[];
  colorFor?: (index: number) => string;
  onPick?: (index: number) => void;
  ariaLabel: string;
  height?: number;
}) {
  const stacked = series.length > 1;
  return (
    <div className="space-y-2" role="img" aria-label={ariaLabel}>
      {stacked && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}
            </span>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="#E8E9EA" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#6f7275' }} tickLine={false} axisLine={{ stroke: '#B0B3B5' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6f7275' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            content={({ active, payload, label }) => active && payload?.length ? (
              <div className={TOOLTIP_CLS}>
                <p className="text-neutral-500 mb-1">{label}</p>
                {payload.map((p) => (
                  <p key={String(p.dataKey)} className="flex justify-between gap-4">
                    <span>{series.find((s) => s.key === p.dataKey)?.label}</span>
                    <b className="tabular-nums">{fmt(Number(p.value))}</b>
                  </p>
                ))}
                {onPick && <p className="text-neutral-400 mt-1">Click to see the list</p>}
              </div>
            ) : null}
          />
          {series.map((s, si) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stacked ? 'a' : undefined}
              fill={s.color}
              maxBarSize={28}
              radius={si === series.length - 1 ? [4, 4, 0, 0] : 0}
              onClick={onPick ? (_, index) => onPick(index) : undefined}
              style={onPick ? { cursor: 'pointer' } : undefined}
            >
              {!stacked && colorFor && rows.map((_, i) => <Cell key={i} fill={colorFor(i)} />)}
              {!stacked && <LabelList dataKey={s.key} position="top" style={{ fontSize: 11, fill: '#54585A', fontWeight: 600 }} formatter={(v: unknown) => (Number(v) ? fmt(Number(v)) : '')} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SHOWN_ROWS = 500;

/** The list behind a figure, with a CSV download of every row. */
export function ListModal({ list, onClose }: { list: ListSpec | null; onClose: () => void }) {
  if (!list) return null;
  const shown = list.rows.slice(0, SHOWN_ROWS);
  return (
    <Modal open onClose={onClose} title={list.title} size="xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-neutral-600">
            {list.subtitle} · {fmt(list.rows.length)} row{list.rows.length === 1 ? '' : 's'}
          </p>
          <Button size="sm" variant="secondary" disabled={!list.rows.length}
            onClick={() => downloadFile(listToCsv(list), `${list.filename}.csv`)}>
            <Download size={14} /> Download CSV
          </Button>
        </div>
        {list.rows.length === 0 ? (
          <p className="text-sm text-neutral-500 py-6 text-center">Nothing here for this range.</p>
        ) : (
          <div className="overflow-x-auto border border-neutral-100 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  {list.columns.map((c) => (
                    <th key={c.key} className={classNames('px-3 py-2 text-xs font-medium text-neutral-500 whitespace-nowrap', c.numeric ? 'text-right' : 'text-left')}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    {list.columns.map((c, ci) => (
                      <td key={c.key} className={classNames('px-3 py-2 tabular-nums', c.numeric ? 'text-right' : 'text-left')}>
                        {ci === 0 && row.link
                          ? <Link to={row.link} className="text-neutral-800 hover:text-siue-red underline-offset-2 hover:underline">{row.cells[c.key]}</Link>
                          : row.cells[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.rows.length > SHOWN_ROWS && (
          <p className="text-xs text-neutral-500">Showing the first {SHOWN_ROWS}; the CSV has all {fmt(list.rows.length)}.</p>
        )}
      </div>
    </Modal>
  );
}
