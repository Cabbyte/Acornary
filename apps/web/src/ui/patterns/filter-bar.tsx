import { X, ListFilter } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../components/utils';
import './fields.css';

export interface ActiveFilter {
  id: string;
  label: string;
  valueLabel: string;
  removable?: boolean;
}
export interface FilterBarProps {
  filters: readonly ActiveFilter[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onOpenFilters?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  scopeLabel?: string;
  className?: string;
}
export function FilterBar({
  filters,
  onRemove,
  onClear,
  onOpenFilters,
  disabled,
  readOnly,
  loading,
  error,
  scopeLabel,
  className,
}: FilterBarProps) {
  const removable = filters.some((filter) => filter.removable !== false);
  return (
    <section
      aria-label="当前筛选条件"
      aria-busy={loading || undefined}
      className={cn('vn-filter-bar', className)}
    >
      <div className="vn-filter-controls">
        {onOpenFilters && (
          <Button
            variant="secondary"
            disabled={disabled || readOnly || loading}
            onClick={onOpenFilters}
          >
            <ListFilter size={16} aria-hidden="true" />
            筛选{filters.length > 0 ? `（${filters.length}）` : ''}
          </Button>
        )}
        {filters.length > 0 && (
          <ul className="vn-filter-list">
            {filters.map((filter) => (
              <li key={filter.id}>
                {filter.removable !== false && !readOnly ? (
                  <Button
                    variant="secondary"
                    disabled={disabled || loading}
                    onClick={() => onRemove(filter.id)}
                    aria-label={`移除筛选：${filter.label}，${filter.valueLabel}`}
                  >
                    <span>
                      {filter.label}：{filter.valueLabel}
                    </span>
                    <X size={14} aria-hidden="true" />
                  </Button>
                ) : (
                  <span className="vn-filter-fixed">
                    {filter.label}：{filter.valueLabel}
                    {filter.removable === false && <span className="vn-muted">（固定）</span>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {removable && (
          <Button
            variant="quiet"
            disabled={disabled || readOnly || loading}
            onClick={onClear}
            aria-label="清除可移除的筛选条件"
          >
            清除筛选
          </Button>
        )}
      </div>
      {scopeLabel && <span className="vn-filter-scope vn-muted">范围：{scopeLabel}</span>}
      {loading && (
        <span className="vn-muted" role="status">
          正在筛选…
        </span>
      )}
      {error && (
        <span className="vn-field-error" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
