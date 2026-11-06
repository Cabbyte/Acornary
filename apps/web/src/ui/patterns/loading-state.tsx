import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../components/utils';
import { InlineNotice } from '../components/ui/inline-notice';
import { Skeleton } from '../components/ui/skeleton';
import '../components/ui/overlays.css';

export interface LoadingStateProps {
  state?: 'loading' | 'delayed' | 'error' | 'unknown';
  label?: string;
  context?: ReactNode;
  layout?: 'list' | 'card' | 'compact';
  recoveryAction?: ReactNode;
  className?: string;
}
export function LoadingState({
  state = 'loading',
  label,
  context,
  layout = 'list',
  recoveryAction,
  className,
}: LoadingStateProps) {
  const loading = state === 'loading' || state === 'delayed';
  const text =
    label ||
    (
      {
        loading: '正在读取记录',
        delayed: '读取时间比平时更长',
        error: '读取失败',
        unknown: '读取结果未知',
      } as const
    )[state];
  return (
    <div className={cn('vn-loading-state', className)} data-layout={layout}>
      {loading ? (
        <>
          <div className="vn-loading-label" role="status">
            <LoaderCircle size={18} aria-hidden="true" className="vn-loading-spinner" />
            <span>{text}</span>
          </div>
          {context && <div className="vn-state-context">{context}</div>}
          {layout !== 'compact' && (
            <div aria-busy="true" aria-label="内容正在读取" className="vn-loading-placeholders">
              <Skeleton variant={layout === 'card' ? 'card' : 'row'} />
              {layout === 'list' && <Skeleton variant="row" lines={2} />}
            </div>
          )}
          {recoveryAction && <div className="vn-state-actions">{recoveryAction}</div>}
        </>
      ) : (
        <InlineNotice
          tone={state === 'error' ? 'danger' : 'warning'}
          title={text}
          action={recoveryAction}
        >
          {context || '尚未取得可用结果；不会将未知情况显示为零库存。'}
        </InlineNotice>
      )}
    </div>
  );
}
