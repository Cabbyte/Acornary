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
  /** Human-readable labels for known targets; IDs remain the action identity. */
  objectLabels?: Readonly<Record<string, string>>;
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
  objectLabels,
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
  const labelCounts = new Map<string, number>();
  result.affected_objects.forEach((object) => {
    const label = objectLabels?.[object.id];
    if (label) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  });
  return (
    <section className="vn-operation-card vn-stack" aria-label="操作回执">
      <div className="vn-operation-heading">
        <h3 className="vn-section-title">操作回执</h3>
        <Badge variant={result.changed ? 'success' : 'info'}>
          {result.changed ? '变更已确认' : '无新增变更'}
        </Badge>
      </div>
      <p className="vn-operation-summary">{result.summary}</p>
      <p className="vn-operation-reference">
        回执列出 {result.affected_objects.length} 个受影响对象
      </p>
      {result.affected_objects.length > 0 && (
        <ul className="vn-operation-object-list">
          {result.affected_objects.map((object) => (
            <li key={`${object.kind}:${object.id}`}>
              <div>
                <div className="vn-operation-object-heading">
                  <Badge>{object.kind === 'ITEM' ? '物品' : '目录'}</Badge>
                  {objectLabels?.[object.id] ? (
                    <span className="vn-operation-object-name">{objectLabels[object.id]}</span>
                  ) : (
                    <code>{object.id}</code>
                  )}
                </div>
                {objectLabels?.[object.id] &&
                  (labelCounts.get(objectLabels[object.id]) ?? 0) > 1 && (
                    <code className="vn-operation-id">{object.id}</code>
                  )}
                <details className="vn-operation-details">
                  <summary>对象详情</summary>
                  {objectLabels?.[object.id] && (
                    <code className="vn-operation-id">{object.id}</code>
                  )}
                  <p className="vn-operation-reference">
                    {object.before_revision === 0 ? '新建' : `版本 ${object.before_revision}`} →
                    版本 {object.after_revision}
                  </p>
                </details>
              </div>
              <Button variant="quiet" onClick={() => onOpenAffected(object.id, object.kind)}>
                查看对象
              </Button>
            </li>
          ))}
        </ul>
      )}
      {refreshState === 'error' ? (
        <InlineNotice tone="warning" title="回执已取得，列表刷新失败">
          请刷新列表，原操作不会重新发送。
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
          刷新列表
        </Button>
        {onDone && <Button onClick={onDone}>完成</Button>}
      </div>
      <details className="vn-operation-details">
        <summary>回执详情</summary>
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
            <dt>关联事件</dt>
            <dd>
              {result.event_ids.length ? (
                <ul className="vn-operation-list">
                  {result.event_ids.map((id) => (
                    <li key={id}>
                      <code>{id}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                '未列出'
              )}
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
