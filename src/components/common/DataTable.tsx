import { useEffect, useRef, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type PaginationState,
  type SortingState,
  type Updater,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { classNames } from '../../utils/helpers';
import { useUrlState, useUrlStateBatch } from '../../hooks/useUrlState';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  searchValue?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  /** Optional column width percentages, e.g. ['30%', '20%', '15%', '15%', '20%']. Must sum to 100%. */
  columnWidths?: string[];
  /** Keep sort, page and page size in the address (?sort=-name&page=3&size=50), so
   *  they survive leaving the tab, a refresh and the back button. */
  urlState?: boolean;
  /** Changes whenever the page's own filters change; the table then returns to
   *  page 1. Restoring a saved address is not a change. */
  resetKey?: string;
}

const PAGE_SIZES = [25, 50, 100];

function parseSort(value: string): SortingState {
  if (!value) return [];
  return value.startsWith('-') ? [{ id: value.slice(1), desc: true }] : [{ id: value, desc: false }];
}

function formatSort(sorting: SortingState): string {
  const first = sorting[0];
  return first ? `${first.desc ? '-' : ''}${first.id}` : '';
}

export function DataTable<T>({
  data,
  columns,
  searchValue,
  pageSize = 25,
  onRowClick,
  emptyMessage = 'No data found.',
  emptyAction,
  columnWidths,
  urlState = false,
  resetKey,
}: DataTableProps<T>) {
  // Both stores always exist (hooks can't be conditional); urlState picks one.
  const [localSorting, setLocalSorting] = useState<SortingState>([]);
  const [localPagination, setLocalPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [urlSort, setUrlSort] = useUrlState('sort');
  const [urlPage, setUrlPage] = useUrlState('page', '1');
  const [urlSize] = useUrlState('size', String(pageSize));
  // Page and size change together; two separate updates would each start from the
  // old address and the second would undo the first.
  const setUrlValues = useUrlStateBatch();

  const sorting = urlState ? parseSort(urlSort) : localSorting;
  const parsedSize = Number(urlSize);
  const pagination: PaginationState = urlState
    ? {
        pageIndex: Math.max(0, (Number(urlPage) || 1) - 1),
        pageSize: PAGE_SIZES.includes(parsedSize) ? parsedSize : pageSize,
      }
    : localPagination;

  const onSortingChange = (updater: Updater<SortingState>) => {
    const next = typeof updater === 'function' ? updater(sorting) : updater;
    if (urlState) setUrlSort(formatSort(next));
    else setLocalSorting(next);
  };
  const onPaginationChange = (updater: Updater<PaginationState>) => {
    const next = typeof updater === 'function' ? updater(pagination) : updater;
    if (urlState) {
      setUrlValues({
        page: next.pageIndex === 0 ? '' : String(next.pageIndex + 1),
        size: next.pageSize === pageSize ? '' : String(next.pageSize),
      });
    } else {
      setLocalPagination(next);
    }
  };

  // Back to page 1 when the search or the page's filters change, but not on the
  // first render: that is a saved address being restored.
  const lastReset = useRef<string | undefined>(undefined);
  const combinedReset = `${resetKey ?? ''}\u0000${searchValue ?? ''}`;
  useEffect(() => {
    if (lastReset.current !== undefined && lastReset.current !== combinedReset) {
      if (urlState) setUrlPage('1');
      else setLocalPagination((p) => ({ ...p, pageIndex: 0 }));
    }
    lastReset.current = combinedReset;
  }, [combinedReset, urlState, setUrlPage]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: searchValue, pagination },
    onSortingChange,
    onPaginationChange,
    // Data arrives after the page renders; resetting then would throw away a
    // restored page number. Resets happen explicitly above instead.
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // A saved page number beyond the end (the data shrank since): move to the last page.
  const pageCount = table.getPageCount();
  useEffect(() => {
    if (pageCount > 0 && pagination.pageIndex >= pageCount) table.setPageIndex(pageCount - 1);
  }, [pageCount, pagination.pageIndex, table]);

  return (
    <div className="pb-4">
      <div className="overflow-x-auto rounded-lg border border-neutral-100">
        <table className="min-w-full divide-y divide-neutral-100 table-fixed">
          {columnWidths && (
            <colgroup>
              {columnWidths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          <thead className="bg-neutral-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={classNames(
                      'px-4 py-3 text-left text-xs font-semibold text-neutral-500 uppercase tracking-wider',
                      header.column.getCanSort() && 'cursor-pointer select-none hover:text-neutral-700'
                    )}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getCanSort() && (
                        <span className="text-neutral-300">
                          {header.column.getIsSorted() === 'asc' ? (
                            <ChevronUp size={14} />
                          ) : header.column.getIsSorted() === 'desc' ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronsUpDown size={14} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="bg-white divide-y divide-neutral-50">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-neutral-400"
                >
                  <p className="text-lg mb-2">{emptyMessage}</p>
                  {emptyAction}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={classNames(
                    'hover:bg-neutral-50 transition-colors',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm text-neutral-700">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between mt-4 px-4 text-sm">
          <p className="text-neutral-500">
            Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
            {' '}-{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}
            {' '}of {table.getFilteredRowModel().rows.length}
          </p>
          <div className="flex items-center gap-2">
            <select
              value={table.getState().pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              className="border border-neutral-200 rounded-lg px-2 py-1 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </select>
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="px-3 py-1 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-neutral-500">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="px-3 py-1 rounded-lg border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
