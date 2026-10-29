/** The page sizes tables offer (DataTable keeps the choice in the address). */
const DEFAULT_SIZES = [10, 25, 50, 100];

interface PaginationProps {
  pageIndex: number;
  pageSize: number;
  total: number;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizes?: number[];
  /** What the rows are, for "Showing 1–10 of 219 counties". */
  noun?: string;
}

/** Previous / Next paging under a table, the same everywhere. Hidden when one page holds everything. */
export function Pagination({ pageIndex, pageSize, total, onPageChange, onPageSizeChange, pageSizes = DEFAULT_SIZES, noun }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const first = pageIndex * pageSize + 1;
  const last = Math.min((pageIndex + 1) * pageSize, total);
  const button = 'px-3 py-1 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-4 text-sm">
      <p className="text-neutral-500">
        Showing {first.toLocaleString('en-US')}–{last.toLocaleString('en-US')} of {total.toLocaleString('en-US')}{noun ? ` ${noun}` : ''}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="border border-neutral-200 rounded-lg px-2 py-1 text-sm"
            aria-label="Rows per page"
          >
            {pageSizes.map((size) => <option key={size} value={size}>{size} per page</option>)}
          </select>
        )}
        <button type="button" onClick={() => onPageChange(pageIndex - 1)} disabled={pageIndex === 0} className={button}>Previous</button>
        <span className="text-neutral-500">Page {pageIndex + 1} of {pageCount}</span>
        <button type="button" onClick={() => onPageChange(pageIndex + 1)} disabled={pageIndex >= pageCount - 1} className={button}>Next</button>
      </div>
    </div>
  );
}
