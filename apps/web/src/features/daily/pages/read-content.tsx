import type { ReactNode } from 'react';
import { Button } from '../../../ui/components/ui/button';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { LoadingState } from '../../../ui/patterns/loading-state';
import type { DailyReadProps } from './models';

export function ReadContent({
  state,
  onRetry,
  children,
}: DailyReadProps & { children: ReactNode }) {
  if (state === 'loading') return <LoadingState label="正在读取物品" layout="list" />;
  if (state === 'error')
    return (
      <EmptyState
        reason="error"
        recoveryAction={
          <Button variant="secondary" onClick={onRetry}>
            重试
          </Button>
        }
      />
    );
  if (state === 'forbidden') return <EmptyState reason="permission" />;
  if (state === 'not-found')
    return (
      <EmptyState
        reason="unknown"
        title="无法找到这条记录"
        context="记录可能已变更，或不在当前家庭的可见范围内。"
      />
    );
  if (state === 'offline-empty') return <EmptyState reason="offline" />;
  if (state === 'session-changed')
    return (
      <EmptyState
        reason="unknown"
        title="家庭或登录身份已变化"
        context="请在当前家庭重新打开记录。"
        recoveryAction={
          <Button variant="secondary" onClick={onRetry}>
            重新读取
          </Button>
        }
      />
    );
  return (
    <>
      {state === 'offline-partial' && (
        <InlineNotice tone="warning" title="离线 · 部分缓存">
          仅显示已缓存的记录，数量不代表完整库存。
        </InlineNotice>
      )}
      {children}
    </>
  );
}
