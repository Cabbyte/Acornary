import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import type { HistoryEventV2 } from '../../../../../packages/contracts/src/read-v2';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { InlineNotice } from '../components/ui/inline-notice';
import { CapabilityNotice } from './capability-notice';
import { LoadingState } from './loading-state';
import { HistoryChanges, type HistoryChangePresentation } from './history-changes';
import type { ActionAvailability } from './types';
import { cn } from '../components/utils';
import './content.css';

export interface HistoryEntryProps {
  event: HistoryEventV2 | null;
  operationLabel: string;
  objectLabel?: string | null;
  actorLabel?: string | null;
  familyTimezone: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  changesPresentation?: Readonly<Record<string, HistoryChangePresentation>>;
  state?: 'ready' | 'loading' | 'error' | 'unknown';
  error?: string;
  onOpenTarget?: (target: { kind: HistoryEventV2['target_kind']; id: string }) => void;
  correctionAvailability?: ActionAvailability;
  onCorrectionIntent?: (event: HistoryEventV2) => void;
  className?: string;
}
function familyTime(value: string, timezone: string | null): string {
  if (!timezone) return `${value || '时间未记录'}（家庭时区未提供）`;
  if (!value || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    return `${value || '时间未记录'}（时间依据不完整）`;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return `${value}（时间无法识别）`;
  try {
    return `${new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date)} · ${timezone}`;
  } catch {
    return `${value}（家庭时区无效：${timezone}）`;
  }
}
/** Event facts stay intact; correction is a policy-gated intent, never an undo mutation. */
export function HistoryEntry({
  event,
  operationLabel,
  objectLabel,
  actorLabel,
  familyTimezone,
  expanded,
  onExpandedChange,
  changesPresentation,
  state = 'ready',
  error,
  onOpenTarget,
  correctionAvailability,
  onCorrectionIntent,
  className,
}: HistoryEntryProps) {
  const detailsId = useId();
  if (state === 'loading') return <LoadingState label="正在读取历史记录" className={className} />;
  if (!event || state === 'error' || state === 'unknown')
    return (
      <InlineNotice
        tone={state === 'error' ? 'danger' : 'warning'}
        title={state === 'error' ? '历史记录读取失败' : '历史记录未知'}
        className={className}
      >
        {error || '尚未取得可用的事件记录。'}
      </InlineNotice>
    );
  return (
    <article
      className={cn('vn-content-panel vn-history-entry vn-stack', className)}
      aria-label={`${operationLabel}历史记录`}
    >
      <div className="vn-content-header">
        <div>
          <div className="vn-history-heading">
            <h3 className="vn-section-title">{operationLabel}</h3>
            <span className="vn-history-target">{objectLabel || event.target_id}</span>
            <Badge>{event.target_kind === 'ITEM' ? '物品' : '商品目录'}</Badge>
          </div>
          <p className="vn-content-meta">
            {actorLabel || '操作人未知'} ·{' '}
            <time dateTime={event.occurred_at}>
              {familyTime(event.occurred_at, familyTimezone)}
            </time>
          </p>
        </div>
        {onOpenTarget && (
          <Button
            variant="quiet"
            onClick={() => onOpenTarget({ kind: event.target_kind, id: event.target_id })}
          >
            查看对象
          </Button>
        )}
      </div>
      {event.reason !== null && (
        <p className="vn-content-value">{event.reason || '原因已记录为空。'}</p>
      )}
      <div className="vn-row">
        <Button
          variant="quiet"
          className="vn-history-toggle"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => onExpandedChange(!expanded)}
        >
          <ChevronDown size={16} aria-hidden="true" />
          变更（{event.changes.length}）
        </Button>
        {onCorrectionIntent && correctionAvailability?.kind === 'available' && (
          <Button variant="quiet" onClick={() => onCorrectionIntent(event)}>
            申请更正
          </Button>
        )}
      </div>
      {correctionAvailability && correctionAvailability.kind !== 'available' && (
        <CapabilityNotice capabilityLabel="更正记录" availability={correctionAvailability} />
      )}
      <div id={detailsId} hidden={!expanded}>
        <HistoryChanges changes={event.changes} presentations={changesPresentation} />
      </div>
      <details className="vn-content-details">
        <summary>记录详情</summary>
        <dl className="vn-content-metadata">
          <dt>对象 ID</dt>
          <dd>{event.target_id}</dd>
          <dt>事件 ID</dt>
          <dd>{event.id}</dd>
          <dt>操作 ID</dt>
          <dd>{event.operation_id}</dd>
          <dt>记录类型</dt>
          <dd>{event.event_type}</dd>
          <dt>操作人 ID</dt>
          <dd>{event.actor_id || '未记录'}</dd>
          <dt>来源</dt>
          <dd>{event.source || '未记录'}</dd>
          <dt>版本变化</dt>
          <dd>
            {event.before_revision} → {event.after_revision}
          </dd>
          <dt>写入时间</dt>
          <dd>{familyTime(event.recorded_at, familyTimezone)}</dd>
        </dl>
      </details>
    </article>
  );
}
