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
      title={online ? '连接已恢复，仍需重新读取' : '离线只读'}
    >
      <div className="vn-stack">
        <p className="vn-operation-summary">
          {scopeLabel} ·{' '}
          {coverage === 'none'
            ? '没有可用缓存，当前内容不可读；不代表库存为空。'
            : coverage === 'cached-subset'
              ? '仅能查看已缓存的部分记录，无法据此确认完整库存。'
              : '可查看此范围的缓存快照，不代表最新情况。'}
        </p>
        <dl className="vn-operation-facts">
          <div>
            <dt>缓存时间</dt>
            <dd>{coverage === 'none' ? '无缓存' : (cachedAtLabel ?? '未知')}</dd>
          </div>
          <div>
            <dt>快照边界</dt>
            <dd>
              <code>{coverage === 'none' ? '无缓存边界' : (asOfChangeId ?? '未提供')}</code>
            </dd>
          </div>
        </dl>
        {pendingTaskId && (
          <p className="vn-operation-summary">
            还有结果未知的原任务，恢复连接不会将其视为失败或自动重发。
          </p>
        )}
        <div className="vn-operation-actions">
          <Button variant="secondary" busy={reconnecting} onClick={onReconnect}>
            {online ? '重新读取当前范围' : '重新连接'}
          </Button>
          {pendingTaskId && onViewRecovery && (
            <Button variant="quiet" onClick={() => onViewRecovery(pendingTaskId)}>
              查看待确认任务
            </Button>
          )}
        </div>
      </div>
    </InlineNotice>
  );
}
