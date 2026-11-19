import type { RowData } from '@tanstack/react-table';
import { classNames } from '../../utils/helpers';

export { ColGroup } from './ColGroup';

/**
 * The column types every table uses, so columns are the same width on every page
 * and a table never spreads out with big gaps:
 *
 * - primary: the main text (a name). Takes the space the others leave.
 * - text:    short text (county, role, source).
 * - number:  a count. Tabular figures so digits line up.
 * - date:    a date, on one line.
 * - badge:   a status pill.
 * - actions: the row's buttons, 128px, on the right.
 *
 * Everything is left-aligned except actions. A column can ask for its own width
 * (`{ kind: 'text', width: '14rem' }`) when its values are known to be longer; on a
 * primary column the width is only its narrowest (it still takes what's left).
 */
export type ColumnKind = 'primary' | 'text' | 'number' | 'date' | 'badge' | 'actions';
export type ColumnSpec = ColumnKind | { kind: ColumnKind; width?: string };

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's type (see tableColumns.ts). Defaults to 'text'; the first column is 'primary'. */
    kind?: ColumnKind;
    /** Overrides the type's width, e.g. '14rem'. */
    width?: string;
    /** A plain-language explanation shown from an (i) next to the header. */
    info?: string;
  }
}

/** Widths in rem, so a table's narrowest size can be added up. 8rem = 128px. */
const WIDTH_REM: Record<Exclude<ColumnKind, 'primary'>, number> = {
  text: 11,
  number: 7,
  date: 8.5,
  badge: 8.5,
  actions: 8,
};
/** The primary column's narrowest width before the table scrolls inside its card. */
const PRIMARY_MIN_REM = 14;

export function specKind(spec: ColumnSpec): ColumnKind {
  return typeof spec === 'string' ? spec : spec.kind;
}

/** The width for the column's <col>: undefined for primary (it takes what's left). */
export function columnWidth(spec: ColumnSpec): string | undefined {
  const kind = specKind(spec);
  if (kind === 'primary') return undefined;
  if (typeof spec !== 'string' && spec.width) return spec.width;
  return `${WIDTH_REM[kind]}rem`;
}

function remOf(width: string | undefined, fallback: number): number {
  if (!width) return fallback;
  const m = /^([\d.]+)(rem|px)$/.exec(width);
  if (!m) return fallback;
  return m[2] === 'px' ? Number(m[1]) / 16 : Number(m[1]);
}

/** The narrowest the table gets (every fixed column plus room for the primary one). */
export function tableMinWidth(specs: ColumnSpec[]): string {
  const rem = specs.reduce((sum, spec) => {
    const kind = specKind(spec);
    if (kind === 'primary') return sum + remOf(typeof spec === 'string' ? undefined : spec.width, PRIMARY_MIN_REM);
    return sum + remOf(columnWidth(spec), WIDTH_REM[kind]);
  }, 0);
  return `${rem}rem`;
}

/** Header cell classes for a column type. */
export function headClass(spec: ColumnSpec): string {
  return classNames(
    'px-4 py-3 text-xs font-semibold text-neutral-500 uppercase tracking-wider align-bottom',
    specKind(spec) === 'actions' ? 'text-right' : 'text-left',
  );
}

/** Body cell classes for a column type. */
export function cellClass(spec: ColumnSpec): string {
  const kind = specKind(spec);
  return classNames(
    'px-4 py-2',
    // Actions aren't clipped: an IconButton opens out over the column to its left.
    kind === 'actions' ? 'text-right' : 'text-left overflow-hidden',
    (kind === 'number' || kind === 'date') && 'tabular-nums whitespace-nowrap',
  );
}

/** Props for a <table> built from column types: fixed layout, full width, scrolls when narrower. */
export function tableProps(specs: ColumnSpec[], className?: string) {
  return {
    className: classNames('w-full table-fixed', className),
    style: { minWidth: tableMinWidth(specs) },
  };
}
