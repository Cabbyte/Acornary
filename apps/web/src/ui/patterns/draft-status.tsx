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
          {durable ? '可恢复草稿' : '尚不可发送'}
        </Badge>
      </div>
      <dl className="vn-operation-facts">
        <div>
          <dt>所属范围</dt>
          <dd>{scopeLabel}</dd>
        </div>
        <div>
          <dt>任务引用</dt>
          <dd>
            <code>{taskId}</code>
          </dd>
        </div>
        <div>
          <dt>保存时间</dt>
          <dd>{durable ? savedAtLabel || '未提供' : '尚未确认可靠保存'}</dd>
        </div>
      </dl>
      {!durable ? (
        <InlineNotice
          tone={state === 'persistFailed' ? 'danger' : 'warning'}
          title="当前不能发送业务操作"
        >
          {reason ||
            (state === 'inMemory'
              ? '可继续编辑临时草稿；离开或刷新可能丢失内容，先可靠保存后再提交。'
              : state === 'saving'
                ? '请等待草稿保存结果。'
                : '输入仍保留在页面内；请先解决保存问题，不会自动发送。')}
        </InlineNotice>
      ) : (
        <p className="vn-muted">草稿保存与业务提交是两个步骤；提交前还需核对当前范围与版本。</p>
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
    </section>
  );
}
