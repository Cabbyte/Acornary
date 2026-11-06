import { useId, useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  useTable,
  tableFeatures,
  rowSortingFeature,
  rowSelectionFeature,
  rowPaginationFeature,
  functionalUpdate,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/react-table';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './table';
import { Button } from './button';
import { Checkbox } from './checkbox';
import { Input } from './input';
import { PaginationControls, type PaginationControlsProps } from './pagination-controls';
import { EmptyState } from '../../patterns/empty-state';
import { LoadingState } from '../../patterns/loading-state';
import type { ActionAvailability } from '../../patterns/types';
import { cn } from '../utils';
import '../../patterns/lists.css';

const features = tableFeatures({ rowSortingFeature, rowSelectionFeature, rowPaginationFeature });
export type DataTableSorting = SortingState;
export interface DataTableColumn<T extends { id: string }> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** The column ID is passed to the server controller; no local comparator runs. */
  sortable?: boolean;
}
export interface DataTableProps<T extends { id: string }> {
  rows: readonly T[];
  columns: readonly DataTableColumn<T>[];
  caption: string;
  sorting: DataTableSorting;
  onSortingChange: (sorting: DataTableSorting) => void;
  filterValue: string;
  onFilterChange: (value: string) => void;
  filterLabel?: string;
  selectedIds: readonly string[];
  onSelectionChange: (ids: string[]) => void;
  getSelectionAvailability?: (row: T) => ActionAvailability;
  getRowLabel: (row: T) => string;
  onOpen: (id: string) => void;
  pagination: Omit<
    PaginationControlsProps,
    'loadedCount' | 'onPageChange' | 'loading' | 'disabled' | 'className'
  >;
  onPageChange: (pageIndex: number) => void;
  expandedIds?: readonly string[];
  onExpandedChange?: (ids: string[]) => void;
  state?: 'ready' | 'loading' | 'error' | 'unknown';
  error?: string;
  onRetry?: () => void;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
}

// TanStack Table 9.3.1 uses useTable/tableFeatures, not the v8 useReactTable API.
// Composition: https://ui.shadcn.com/docs/components/base/data-table
// https://tanstack.com/table/latest/docs/framework/react/guide/table-state
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  caption,
  sorting,
  onSortingChange,
  filterValue,
  onFilterChange,
  filterLabel = '筛选物品',
  selectedIds,
  onSelectionChange,
  getSelectionAvailability,
  getRowLabel,
  onOpen,
  pagination,
  onPageChange,
  expandedIds = [],
  onExpandedChange,
  state = 'ready',
  error,
  onRetry,
  readOnly = false,
  disabled = false,
  className,
}: DataTableProps<T>) {
  const filterId = useId();
  const busy = state === 'loading';
  const definitions = useMemo<ColumnDef<typeof features, T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.label,
        cell: (context) => column.cell(context.row.original),
        enableSorting: column.sortable,
      })),
    [columns],
  );
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries(selectedIds.map((id) => [id, true])),
    [selectedIds],
  );
  const canSelect = (row: T) =>
    !disabled &&
    !readOnly &&
    !busy &&
    (!getSelectionAvailability || getSelectionAvailability(row).kind === 'available');
  const table = useTable({
    features,
    data: rows,
    columns: definitions,
    getRowId: (row) => row.id,
    manualSorting: true,
    manualPagination: true,
    autoResetPageIndex: false,
    enableMultiSort: false,
    enableRowSelection: (row) => canSelect(row.original),
    state: {
      sorting,
      rowSelection,
      pagination: { pageIndex: pagination.pageIndex, pageSize: pagination.pageSize },
    },
    onSortingChange: (updater) => onSortingChange(functionalUpdate(updater, sorting)),
    onRowSelectionChange: (updater) =>
      onSelectionChange(
        Object.entries(functionalUpdate(updater, rowSelection))
          .filter(([, selected]) => selected)
          .map(([id]) => id),
      ),
    onPaginationChange: (updater) =>
      onPageChange(
        functionalUpdate(updater, {
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
        }).pageIndex,
      ),
    pageCount:
      pagination.knownTotal === null ? -1 : Math.ceil(pagination.knownTotal / pagination.pageSize),
    rowCount: pagination.knownTotal ?? undefined,
  });
  const eligibleIds = rows.filter(canSelect).map((row) => row.id);
  const selected = new Set(selectedIds);
  const selectedLoaded = eligibleIds.filter((id) => selected.has(id)).length;
  const allLoaded = eligibleIds.length > 0 && selectedLoaded === eligibleIds.length;
  const selectLoaded = (checked: boolean) => {
    const next = new Set(selectedIds);
    eligibleIds.forEach((id) => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    onSelectionChange([...next]);
  };
  const toggleSort = (id: string) => {
    const current = sorting.find((sort) => sort.id === id);
    table.setSorting(current ? (current.desc ? [] : [{ id, desc: true }]) : [{ id, desc: false }]);
  };
  const currentRows = table.getRowModel().rows;
  return (
    <section className={cn('vn-data-table vn-stack', className)} aria-label={caption}>
      <div className="vn-list-filter">
        <label htmlFor={filterId}>{filterLabel}</label>
        <Input
          id={filterId}
          value={filterValue}
          onChange={(event) => onFilterChange(event.target.value)}
          disabled={disabled}
          aria-busy={busy || undefined}
          placeholder="输入筛选条件"
        />
      </div>
      <div className="vn-data-mobile-tools">
        <Checkbox
          checked={allLoaded ? true : selectedLoaded > 0 ? 'indeterminate' : false}
          onCheckedChange={selectLoaded}
          disabled={eligibleIds.length === 0}
          label="选择本页"
        />
        {columns
          .filter((column) => column.sortable)
          .map((column) => {
            const order = sorting.find((sort) => sort.id === column.id);
            const SortIcon = order ? (order.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
            return (
              <Button
                key={column.id}
                variant="secondary"
                disabled={disabled || busy}
                onClick={() => toggleSort(column.id)}
                aria-label={`${column.label}排序，当前${order ? (order.desc ? '降序' : '升序') : '未排序'}`}
              >
                {column.label}
                <SortIcon size={16} aria-hidden="true" />
              </Button>
            );
          })}
      </div>
      {state !== 'ready' && (
        <LoadingState
          state={state === 'error' ? 'error' : state === 'unknown' ? 'unknown' : 'loading'}
          layout="compact"
          context={error || (rows.length > 0 ? '当前显示上次已加载的记录。' : undefined)}
          recoveryAction={
            onRetry && state === 'error' ? (
              <Button variant="secondary" onClick={onRetry}>
                重试读取
              </Button>
            ) : undefined
          }
        />
      )}
      <div className="vn-data-table-body">
        <Table role="table" aria-busy={busy || undefined}>
          <TableCaption>{caption}</TableCaption>
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead role="columnheader">
                <span className="vn-data-narrow-heading">选择</span>
                <Checkbox
                  checked={allLoaded ? true : selectedLoaded > 0 ? 'indeterminate' : false}
                  onCheckedChange={selectLoaded}
                  disabled={eligibleIds.length === 0}
                  label="选择本页"
                />
              </TableHead>
              {columns.map((column) => {
                const order = sorting.find((sort) => sort.id === column.id);
                const SortIcon = order ? (order.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                return (
                  <TableHead
                    key={column.id}
                    role="columnheader"
                    aria-sort={
                      order
                        ? order.desc
                          ? 'descending'
                          : 'ascending'
                        : column.sortable
                          ? 'none'
                          : undefined
                    }
                  >
                    {column.sortable ? (
                      <>
                        <span className="vn-data-narrow-heading">{column.label}</span>
                        <Button
                          variant="quiet"
                          disabled={disabled || busy}
                          onClick={() => toggleSort(column.id)}
                        >
                          {column.label}
                          <SortIcon size={16} aria-hidden="true" />
                        </Button>
                      </>
                    ) : (
                      column.label
                    )}
                  </TableHead>
                );
              })}
              <TableHead role="columnheader">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {currentRows.length === 0 ? (
              <TableRow role="row">
                <TableCell colSpan={columns.length + 2} role="cell">
                  {state === 'ready' ? (
                    <EmptyState reason={filterValue ? 'no-match' : 'empty'} />
                  ) : (
                    <span className="vn-list-meta">尚无可展示的已加载记录</span>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              currentRows.map((row) => {
                const expanded = !onExpandedChange || expandedIds.includes(row.id);
                const availability = getSelectionAvailability?.(row.original);
                return (
                  <TableRow
                    key={row.id}
                    role="row"
                    className="vn-data-row"
                    data-state={selected.has(row.id) ? 'selected' : undefined}
                    data-expanded={expanded}
                  >
                    <TableCell role="cell" className="vn-data-selection">
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(checked)}
                        label={
                          <span className="vn-list-sr-only">
                            选择{getRowLabel(row.original)}，{row.id}
                          </span>
                        }
                        disabled={!row.getCanSelect()}
                        description={
                          availability && availability.kind !== 'available'
                            ? availability.reason
                            : undefined
                        }
                      />
                    </TableCell>
                    {row.getAllCells().map((cell, index) => (
                      <TableCell
                        key={cell.id}
                        role="cell"
                        className={index === 0 ? 'vn-data-primary' : 'vn-data-secondary'}
                      >
                        <span className="vn-data-cell-label" aria-hidden="true">
                          {columns[index]?.label}
                        </span>
                        <table.FlexRender cell={cell} />
                        {index === 0 && onExpandedChange && (
                          <Button
                            className="vn-data-expand"
                            variant="quiet"
                            aria-expanded={expanded}
                            onClick={() =>
                              onExpandedChange(
                                expanded
                                  ? expandedIds.filter((id) => id !== row.id)
                                  : [...expandedIds, row.id],
                              )
                            }
                          >
                            {expanded ? '收起事实' : '展开事实'}
                          </Button>
                        )}
                      </TableCell>
                    ))}
                    <TableCell role="cell" className="vn-data-actions">
                      <Button
                        variant="secondary"
                        disabled={disabled || busy}
                        onClick={() => onOpen(row.id)}
                      >
                        打开
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <PaginationControls
        {...pagination}
        loadedCount={rows.length}
        onPageChange={(index) => table.setPageIndex(index)}
        loading={busy}
        disabled={disabled}
      />
      <p className="vn-list-meta">
        已选 {selectedIds.length} 件，其中{' '}
        {selectedIds.filter((id) => !rows.some((row) => row.id === id)).length}{' '}
        件不在本页。选择本页仅作用于已加载且可选的具体物品。
      </p>
    </section>
  );
}
