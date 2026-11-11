import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import './operations.css';

export interface OfflineBannerProps {
  online: boolean;
  scopeLabel: string;
  coverage: 'cached-scope' | 'cached-subset' | 'none';
  cachedAtLabel: string | null;
  asOfChangeId: string | null;
  pendingTaskId?: string;
  reconnecting?: boolean;
  onReconnect: () => void;
  onViewRecovery?: (taskId: string) => void;
}
export function OfflineBanner({
  online,
  scopeLabel,
  coverage,
  cachedAtLabel,
  asOfChangeId,
  pendingTaskId,
  reconnecting = false,
  onReconnect,
  onViewRecovery,
}: OfflineBannerProps) {
  return (
    <InlineNotice
      tone={online ? 'info' : 'warning'}
      title={online ? '连接已恢复，待刷新' : '离线只读'}
    >
      <div className="vn-stack">
        <p className="vn-operation-summary">
          {scopeLabel} ·{' '}
          {coverage === 'none'
            ? '没有可用缓存，不代表库存为空。'
            : coverage === 'cached-subset'
              ? '仅显示部分缓存，无法确认完整库存。'
              : '显示此范围的缓存快照，可能不是最新情况。'}
        </p>
        {coverage !== 'none' && (
          <p className="vn-operation-reference">缓存时间：{cachedAtLabel ?? '未知'}</p>
        )}
        {pendingTaskId && (
          <p className="vn-operation-summary">原任务结果仍未知，恢复连接后不会自动重发。</p>
        )}
        <div className="vn-operation-actions">
          <Button variant="secondary" busy={reconnecting} onClick={onReconnect}>
            {online ? '刷新当前范围' : '重新连接'}
          </Button>
          {pendingTaskId && onViewRecovery && (
            <Button variant="quiet" onClick={() => onViewRecovery(pendingTaskId)}>
              查看原任务
            </Button>
          )}
        </div>
        {coverage !== 'none' && (
          <details className="vn-operation-details">
            <summary>缓存详情</summary>
            <p className="vn-operation-reference">
              快照边界：<code>{asOfChangeId ?? '未提供'}</code>
            </p>
          </details>
        )}
      </div>
    </InlineNotice>
  );
}
