import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import './operations.css';

export interface DraftStatusProps {
  taskId: string;
  scopeLabel: string;
  state: 'saved' | 'inMemory' | 'persistFailed' | 'saving';
  savedAtLabel?: string;
  reason?: string;
  onRetryPersist?: (taskId: string) => void;
}
export function DraftStatus({
  taskId,
  scopeLabel,
  state,
  savedAtLabel,
  reason,
  onRetryPersist,
}: DraftStatusProps) {
  const durable = state === 'saved';
  const labels = {
    saved: '草稿已保存',
    inMemory: '草稿仅保留在当前页面',
    persistFailed: '草稿保存失败',
    saving: '正在保存草稿',
  } as const;
  return (
    <section className="vn-operation-card vn-stack" aria-label="草稿保存状态">
      <div className="vn-operation-heading">
        <h3 className="vn-section-title">{labels[state]}</h3>
        <Badge variant={durable ? 'success' : state === 'persistFailed' ? 'danger' : 'warning'}>
          {durable ? '可恢复' : '不可提交'}
        </Badge>
      </div>
      <p className="vn-operation-summary">{scopeLabel}</p>
      {durable && savedAtLabel && <p className="vn-operation-reference">保存于 {savedAtLabel}</p>}
      {!durable && (
        <InlineNotice
          tone={state === 'persistFailed' ? 'danger' : 'warning'}
          title="保存草稿后才能提交"
        >
          {reason ||
            (state === 'inMemory'
              ? '可继续编辑；离开或刷新可能丢失内容。'
              : state === 'saving'
                ? '请等待草稿保存结果。'
                : '输入仍在当前页面，请重新保存草稿。')}
        </InlineNotice>
      )}
      {!durable && onRetryPersist && (
        <div className="vn-operation-actions">
          <Button
            variant="secondary"
            busy={state === 'saving'}
            onClick={() => onRetryPersist(taskId)}
          >
            重新保存草稿
          </Button>
        </div>
      )}
      <details className="vn-operation-details">
        <summary>草稿详情</summary>
        <p className="vn-operation-reference">
          任务引用：<code>{taskId}</code>
        </p>
        {durable && !savedAtLabel && <p className="vn-operation-reference">保存时间未提供</p>}
      </details>
    </section>
  );
}
