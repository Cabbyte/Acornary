import { useId } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { LoadingState } from './loading-state';
import { EmptyState } from './empty-state';
import { FactDetails } from './fact-details';
import { cn } from '../components/utils';
import './lists.css';

export interface AttentionCategory {
  kind: 'date' | 'quantity' | 'tasks';
  label: string;
  count: number | null;
  coverage: 'live' | 'cached-subset' | 'none';
  description?: string;
}
export interface AttentionSummaryProps {
  categories: readonly AttentionCategory[];
  stale?: boolean;
  loading?: boolean;
  error?: string;
  onOpenCategory: (kind: AttentionCategory['kind']) => void;
  disabled?: boolean;
  className?: string;
}

export function AttentionSummary({
  categories,
  stale = false,
  loading = false,
  error,
  onOpenCategory,
  disabled = false,
  className,
}: AttentionSummaryProps) {
  const headingId = useId();
  if (loading) return <LoadingState label="正在加载需要关注的事实" layout="card" />;
  if (error) return <EmptyState reason="error" context={error} />;
  if (!categories.length) return <EmptyState reason="unknown" title="尚未提供关注类别" />;
  return (
    <section
      className={cn('vn-attention-summary vn-list-panel', className)}
      aria-labelledby={headingId}
    >
      <div className="vn-list-heading">
        <h2 id={headingId}>需要关注</h2>
        {categories.every((category) => category.coverage === 'live') && (
          <Badge variant="neutral">当前范围</Badge>
        )}
      </div>
      {stale && (
        <InlineNotice tone="warning" title="数据可能已变化" announce={false}>
          请以刷新后的事实为准。
        </InlineNotice>
      )}
      <ul className="vn-attention-categories">
        {categories.map((category) => (
          <li key={category.kind}>
            <div>
              <h3>{category.label}</h3>
              {category.description && (
                <FactDetails label="说明">{category.description}</FactDetails>
              )}
              {category.coverage !== 'live' && (
                <Badge variant="warning">
                  {category.coverage === 'cached-subset' ? '缓存子集' : '范围未知'}
                </Badge>
              )}
            </div>
            <span className="vn-attention-count">
              {category.count === null ? '未知' : category.count}
            </span>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => onOpenCategory(category.kind)}
              aria-label={`查看${category.label}`}
            >
              查看
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
