import type { WriteResultV2 } from '../../../../../packages/contracts/src/read-v2';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { LoadingState } from './loading-state';
import './operations.css';

export interface OperationReceiptProps {
  /** Actual result supplied by the write adapter; never inferred from local state. */
  result: WriteResultV2 | null;
  loading?: boolean;
  replay: boolean | null;
  refreshState: 'not-requested' | 'loading' | 'fresh' | 'error';
  unavailableReason?: string;
  onOpenAffected: (id: string, kind: WriteResultV2['affected_objects'][number]['kind']) => void;
  onRefreshReads: () => void;
  onDone?: () => void;
}
export function OperationReceipt({
  result,
  loading = false,
  replay,
  refreshState,
  unavailableReason,
  onOpenAffected,
  onRefreshReads,
  onDone,
}: OperationReceiptProps) {
  if (loading) return <LoadingState label="正在读取操作回执" />;
  if (!result)
    return (
      <InlineNotice tone="warning" title="尚未取得操作回执">
        {unavailableReason || '结果未知，请从原任务核对结果。当前不能确认已保存。'}
      </InlineNotice>
    );
  return (
    <section className="vn-operation-card vn-stack" aria-label="操作回执">
      <div className="vn-operation-heading">
        <h3 className="vn-section-title">操作回执</h3>
        <Badge variant={result.changed ? 'success' : 'info'}>
          {result.changed ? '有已确认变更' : '无新增变更'}
        </Badge>
      </div>
      <p className="vn-operation-summary">{result.summary}</p>
      <dl className="vn-operation-facts">
        <div>
          <dt>操作 ID</dt>
          <dd>
            <code>{result.operation_id}</code>
          </dd>
        </div>
        <div>
          <dt>回放情况</dt>
          <dd>{replay === null ? '未提供' : replay ? '原结果重放' : '非重放结果'}</dd>
        </div>
        <div>
          <dt>受影响对象</dt>
          <dd>{result.affected_objects.length} 个（回执所列）</dd>
        </div>
      </dl>
      {result.affected_objects.length > 0 && (
        <ul className="vn-operation-object-list">
          {result.affected_objects.map((object) => (
            <li key={`${object.kind}:${object.id}`}>
              <div>
                <Badge>{object.kind === 'ITEM' ? '物品' : '目录'}</Badge>
                <code>{object.id}</code>
                <span className="vn-muted">
                  {object.before_revision === 0 ? '新建' : `版本 ${object.before_revision}`} → 版本{' '}
                  {object.after_revision}
                </span>
              </div>
              <Button variant="quiet" onClick={() => onOpenAffected(object.id, object.kind)}>
                查看对象
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <h4 className="vn-operation-subtitle">关联事件</h4>
        {result.event_ids.length ? (
          <ul className="vn-operation-list">
            {result.event_ids.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vn-muted">回执未列出关联事件。</p>
        )}
      </div>
      {refreshState === 'error' ? (
        <InlineNotice tone="warning" title="回执已取得，列表刷新失败">
          可以重新读取列表；这不会重新发送业务操作。
        </InlineNotice>
      ) : (
        <p className="vn-muted" role="status">
          {refreshState === 'fresh'
            ? '列表已更新。'
            : refreshState === 'loading'
              ? '正在刷新列表…'
              : '列表尚未刷新。'}
        </p>
      )}
      <div className="vn-operation-actions">
        <Button variant="secondary" busy={refreshState === 'loading'} onClick={onRefreshReads}>
          刷新读取结果
        </Button>
        {onDone && <Button onClick={onDone}>完成</Button>}
      </div>
    </section>
  );
}
