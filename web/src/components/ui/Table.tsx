import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ErrorState, Skeleton } from './Feedback';
import { Select } from './Form';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Server sort key; makes the header clickable. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  /** Hide on narrow screens to keep tables scannable. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

const hideClass = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden' };

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  sort?: string;
  order?: 'asc' | 'desc';
  onSort?: (key: string, order: 'asc' | 'desc') => void;
  selectable?: boolean;
  selected?: Set<number | string>;
  onSelectedChange?: (s: Set<number | string>) => void;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  footer?: ReactNode;
  maxHeight?: string;
  skeletonRows?: number;
}

export function DataTable<T>({
  columns, rows, rowKey, loading, error, onRetry, empty, sort, order, onSort, selectable, selected, onSelectedChange,
  onRowClick, rowClassName, footer, maxHeight, skeletonRows = 8,
}: DataTableProps<T>) {
  const keys = rows?.map(rowKey) ?? [];
  const allSelected = keys.length > 0 && keys.every((k) => selected?.has(k));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) keys.forEach((k) => next.delete(k));
    else keys.forEach((k) => next.add(k));
    onSelectedChange?.(next);
  };
  const toggle = (k: number | string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange?.(next);
  };
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (error) return <ErrorState error={error} onRetry={onRetry} compact />;

  return (
    <div className="scrollbar-thin overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-subtle">
          <tr className="border-b border-line">
            {selectable && (
              <th className="w-9 px-3 py-2">
                <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={toggleAll} className="size-3.5 accent-[var(--brand-600)]" />
              </th>
            )}
            {columns.map((c) => {
              const active = sort === c.sortKey && c.sortKey;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('h-9 whitespace-nowrap px-3 text-[11.5px] font-medium uppercase tracking-[0.04em] text-muted', align(c.align), c.hideBelow && hideClass[c.hideBelow], c.headerClassName)}
                >
                  {c.sortKey && onSort ? (
                    <button
                      type="button"
                      className={cn('inline-flex items-center gap-1 uppercase hover:text-fg', active && 'text-fg')}
                      onClick={() => onSort(c.sortKey!, active && order === 'asc' ? 'desc' : 'asc')}
                    >
                      {c.header}
                      {active ? (order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ChevronsUpDown className="size-3 opacity-40" />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && !rows
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {selectable && <td className="px-3 py-3" />}
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-3', c.hideBelow && hideClass[c.hideBelow])}>
                      <Skeleton className={cn('h-3', c.align === 'right' ? 'ml-auto w-16' : 'w-3/4')} />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((row) => {
                const k = rowKey(row);
                const isSelected = selected?.has(k);
                return (
                  <tr
                    key={k}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'border-b border-line transition-colors last:border-0',
                      onRowClick && 'cursor-pointer hover:bg-hover',
                      isSelected && 'bg-brand-50/70',
                      rowClassName?.(row),
                    )}
                  >
                    {selectable && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select row" checked={Boolean(isSelected)} onChange={() => toggle(k)} className="size-3.5 accent-[var(--brand-600)]" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn('h-10 whitespace-nowrap px-3 py-1.5 align-middle', align(c.align), c.hideBelow && hideClass[c.hideBelow], c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
        {footer && <tfoot className="border-t border-line-strong bg-subtle/60">{footer}</tfoot>}
      </table>
      {!loading && rows && rows.length === 0 && empty}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange, onPageSizeChange }: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2 text-[12.5px] text-muted">
      <span className="num">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-2 max-sm:hidden">
            Rows
            <Select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="w-18">
              {[25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </label>
        )}
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-md border border-line p-1 hover:bg-hover disabled:opacity-40">
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="min-w-16 text-center num">
            {page} / {pages}
          </span>
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-md border border-line p-1 hover:bg-hover disabled:opacity-40">
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
