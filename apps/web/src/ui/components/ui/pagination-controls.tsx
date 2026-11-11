import { Button } from './button';
import { cn } from '../utils';
import '../../patterns/lists.css';

export interface PaginationControlsProps {
  pageIndex: number;
  pageSize: number;
  loadedCount: number;
  /** Server count for this exact query scope; null means unknown. */
  knownTotal: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPageChange: (pageIndex: number) => void;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

// Navigation follows https://ui.shadcn.com/docs/components/base/pagination.
// Cursor availability comes from the caller, never from loaded row count.
export function PaginationControls({
  pageIndex,
  pageSize,
  loadedCount,
  knownTotal,
  hasPrevious,
  hasNext,
  onPageChange,
  loading = false,
  disabled = false,
  className,
}: PaginationControlsProps) {
  return (
    <nav
      aria-label={`列表分页，每页最多 ${pageSize} 条`}
      className={cn('vn-pagination', className)}
    >
      <p className="vn-list-meta" role="status">
        第 {pageIndex + 1} 页 · 本页 {loadedCount} 条 ·{' '}
        {knownTotal === null ? '总数未知' : `共 ${knownTotal} 条`}
      </p>
      <div className="vn-row">
        <Button
          variant="secondary"
          disabled={disabled || loading || !hasPrevious || pageIndex <= 0}
          onClick={() => onPageChange(pageIndex - 1)}
        >
          上一页
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || loading || !hasNext}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          下一页
        </Button>
      </div>
    </nav>
  );
}
