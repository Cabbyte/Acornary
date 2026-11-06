import type { HistoryEventV2 } from '../../../../../packages/contracts/src/read-v2';
import { Badge } from '../components/ui/badge';
import { InlineNotice } from '../components/ui/inline-notice';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import { FactSource } from './fact-source';
import { cn } from '../components/utils';
import './content.css';

export interface HistoryValuePresentation {
  state: 'unknown' | 'redacted' | 'mixed';
  reason?: string;
}
export interface HistoryChangePresentation {
  label?: string;
  before?: HistoryValuePresentation;
  after?: HistoryValuePresentation;
}
export interface HistoryChangesProps {
  changes: HistoryEventV2['changes'];
  presentations?: Readonly<Record<string, HistoryChangePresentation>>;
  state?: 'ready' | 'loading' | 'error' | 'unknown';
  error?: string;
  className?: string;
}
function valueLabel(
  present: boolean,
  value: unknown,
  presentation?: HistoryValuePresentation,
): string {
  if (presentation)
    return ({ unknown: '值未知', redacted: '内容不可见', mixed: '多个值' } as const)[
      presentation.state
    ];
  if (!present) return '未记录';
  if (value === undefined) return '值未知';
  if (value === null) return '已记录为空';
  if (value === '') return '空文本';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? '值未知';
}
/** Presence comes from HistoryEventV2. Redaction is an explicit, separate presentation input. */
export function HistoryChanges({
  changes,
  presentations = {},
  state = 'ready',
  error,
  className,
}: HistoryChangesProps) {
  if (state === 'loading')
    return <LoadingState layout="compact" label="正在读取变更内容" className={className} />;
  if (state === 'error' || state === 'unknown')
    return (
      <InlineNotice
        tone={state === 'error' ? 'danger' : 'warning'}
        title={state === 'error' ? '变更内容读取失败' : '变更内容未知'}
        className={className}
      >
        {error || '尚未取得完整的前后值，不能判断哪些内容发生了变化。'}
      </InlineNotice>
    );
  if (!changes.length)
    return (
      <EmptyState
        reason="empty"
        title="没有字段变更"
        context="此事件没有提供字段前后值。"
        className={className}
      />
    );
  return (
    <ol className={cn('vn-history-changes', className)} aria-label="变更前后对比">
      {changes.map((change) => {
        const presentation = presentations[change.path];
        return (
          <li
            className="vn-history-change"
            key={`${change.template_id ?? ''}:${change.template_version ?? ''}:${change.path}`}
          >
            <div className="vn-row">
              <h4 className="vn-section-title">{presentation?.label || change.path}</h4>
              {change.template_version !== undefined && (
                <Badge>版本 {change.template_version}</Badge>
              )}
            </div>
            <div className="vn-history-comparison">
              <div className="vn-history-before">
                <span className="vn-content-meta">变更前</span>
                <div className="vn-content-value">
                  {valueLabel(change.before_present, change.before, presentation?.before)}
                </div>
                {presentation?.before?.reason && (
                  <p className="vn-content-meta">{presentation.before.reason}</p>
                )}
              </div>
              <div className="vn-history-after">
                <span className="vn-content-meta">变更后</span>
                <div className="vn-content-value">
                  {valueLabel(change.after_present, change.after, presentation?.after)}
                </div>
                {presentation?.after?.reason && (
                  <p className="vn-content-meta">{presentation.after.reason}</p>
                )}
              </div>
            </div>
            <details className="vn-content-details">
              <summary>查看字段来源</summary>
              {change.template_id && change.template_version !== undefined ? (
                <FactSource
                  source={{
                    templateId: change.template_id,
                    version: change.template_version,
                    path: change.path,
                  }}
                />
              ) : (
                <p className="vn-content-meta">字段路径：{change.path} · 属性版本未提供</p>
              )}
            </details>
          </li>
        );
      })}
    </ol>
  );
}
