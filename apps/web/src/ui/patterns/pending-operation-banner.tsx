import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import type { ActionAvailability } from './types';
import './operations.css';

export interface PendingOperationBannerProps {
  taskId: string;
  title: string;
  scopeLabel: string;
  state: 'networkUnknown' | 'recovering' | 'retained';
  originalAttemptAvailable: boolean;
  recoveryAvailability: ActionAvailability;
  onInspectOriginal: (taskId: string) => void;
  onRetryOriginal?: (taskId: string) => void;
  onRetainAndLeave: (taskId: string) => void;
}
export function PendingOperationBanner({
  taskId,
  title,
  scopeLabel,
  state,
  originalAttemptAvailable,
  recoveryAvailability,
  onInspectOriginal,
  onRetryOriginal,
  onRetainAndLeave,
}: PendingOperationBannerProps) {
  const busy = state === 'recovering';
  const blocked = !originalAttemptAvailable || recoveryAvailability.kind !== 'available';
  return (
    <InlineNotice
      tone="warning"
      title={
        busy
          ? '正在核对原请求'
          : state === 'retained'
            ? '有保留的待确认任务'
            : '结果待确认，可能已经保存'
      }
    >
      <div className="vn-stack">
        <p className="vn-operation-summary">
          {title} · {scopeLabel}
        </p>
        <p className="vn-operation-reference">
          任务引用：<code>{taskId}</code>
        </p>
        <p className="vn-operation-summary">
          继续核对同一次请求，不编辑已发送内容，也不将离开视作取消。
        </p>
        {blocked && (
          <p>
            {!originalAttemptAvailable
              ? '原请求资料不可用，不能重构或发送替代请求。'
              : recoveryAvailability.kind !== 'available'
                ? recoveryAvailability.reason
                : null}
          </p>
        )}
        <div className="vn-operation-actions">
          <Button
            variant="secondary"
            busy={busy}
            disabled={blocked}
            onClick={() => onInspectOriginal(taskId)}
          >
            核对原请求结果
          </Button>
          {onRetryOriginal && (
            <Button
              variant="quiet"
              disabled={blocked || busy}
              onClick={() => onRetryOriginal(taskId)}
            >
              重试同一次请求
            </Button>
          )}
          <Button variant="quiet" disabled={busy} onClick={() => onRetainAndLeave(taskId)}>
            保留任务并离开
          </Button>
        </div>
      </div>
    </InlineNotice>
  );
}
