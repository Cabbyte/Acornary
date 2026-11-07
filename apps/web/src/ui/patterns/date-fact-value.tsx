import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Popover } from '../components/ui/popover';
import type { DateFactPresentation, FactPresentation } from './types';
import { FactDetails } from './fact-details';
import { cn } from '../components/utils';
import './facts.css';

export interface DateFactValueProps {
  fact: DateFactPresentation;
  redacted?: boolean;
  loading?: boolean;
  presentation?: FactPresentation;
  compact?: boolean;
  /** The date opens full metadata without repeating labels in an item row. */
  dateOnly?: boolean;
  className?: string;
}

const kindLabels = {
  EXPIRY: '有效期限',
  WARRANTY_END: '保修结束',
  SERVICE_DUE: '保养日期',
  RETURN_BY: '归还期限',
  RENEWAL: '续期日期',
  REORDER_BY: '补货日期',
} as const;
const dateKindLabels = {
  BEST_BEFORE: '最佳食用期',
  USE_BY: '限用日期',
  ESTIMATED: '估计日期',
} as const;
const stateLabels = {
  UPCOMING: '未到期',
  DUE: '已到期',
  OVERDUE: '已逾期',
  COMPLETED: '已完成',
  UNKNOWN: '状态未知',
} as const;

// Validate a calendar date without constructing Date or shifting through UTC.
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function DateFactValue({
  fact,
  redacted = false,
  loading = false,
  presentation = 'summary',
  className,
  compact = false,
  dateOnly = false,
}: DateFactValueProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const kindLabel = kindLabels[fact.kind];
  const dateLabel = fact.dateKind ? dateKindLabels[fact.dateKind] : null;
  const tone =
    fact.state === 'OVERDUE'
      ? 'danger'
      : fact.state === 'DUE'
        ? 'warning'
        : fact.state === 'COMPLETED'
          ? 'success'
          : 'muted';
  const metadata = (
    <>
      <span className="vn-fact-meta">日期用途：{kindLabel}</span>
      <span className="vn-fact-meta">依据：{fact.basis || '未记录'}</span>
      <span className="vn-fact-meta">
        来源：
        {fact.source === 'LIFECYCLE'
          ? '生命周期事实'
          : fact.source === 'DEADLINE'
            ? '期限记录'
            : '未记录'}
      </span>
      {fact.state === 'COMPLETED' && fact.completedOn && isCalendarDate(fact.completedOn) && (
        <span className="vn-fact-meta">
          完成日期：<time dateTime={fact.completedOn}>{fact.completedOn}</time>
        </span>
      )}
    </>
  );
  const dateContent = (
    <>
      {fact.dueOn === null || fact.dueOn === '' ? (
        <span className="vn-fact-meta">日期未记录</span>
      ) : isCalendarDate(fact.dueOn) ? (
        <time dateTime={fact.dueOn}>
          {dateOnly && fact.dateKind === 'ESTIMATED' ? '约 ' : ''}
          {fact.dueOn}
        </time>
      ) : (
        <span className="vn-fact-error">日期格式有误</span>
      )}
      {(!compact ||
        fact.state === 'DUE' ||
        fact.state === 'OVERDUE' ||
        fact.state === 'COMPLETED') && (
        <span className="vn-fact-badge" data-tone={tone}>
          {stateLabels[fact.state]}
        </span>
      )}
    </>
  );
  if (dateOnly && presentation === 'summary' && !loading && !redacted) {
    return (
      <div className={cn('vn-date-fact', className)} data-presentation={presentation}>
        <Popover
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          title={dateLabel || kindLabel}
          trigger={
            <Button
              variant="quiet"
              className="vn-date-trigger"
              title={`${dateLabel || kindLabel} · 查看日期资料`}
              aria-label={`${dateLabel || kindLabel} ${fact.dueOn || '未记录'}，查看日期资料`}
            >
              <CalendarDays size={16} aria-hidden="true" />
              {dateContent}
            </Button>
          }
        >
          <div className="vn-stack">
            {fact.label && fact.label !== dateLabel && fact.label !== kindLabel && (
              <span>{fact.label}</span>
            )}
            <span className="vn-fact-meta">日期状态：{stateLabels[fact.state]}</span>
            {metadata}
            {fact.state === 'COMPLETED' &&
              fact.completedOn &&
              !isCalendarDate(fact.completedOn) && (
                <span className="vn-fact-error">完成日期格式有误</span>
              )}
          </div>
        </Popover>
      </div>
    );
  }
  return (
    <div className={cn('vn-date-fact', className)} data-presentation={presentation}>
      <div className="vn-date-fact-main vn-fact-primary">
        {loading ? (
          <span role="status" className="vn-fact-meta">
            正在加载日期…
          </span>
        ) : redacted ? (
          <span className="vn-fact-meta">日期不可见</span>
        ) : (
          <>{dateContent}</>
        )}
      </div>
      {compact ? (
        <span className="vn-fact-label">{dateLabel || kindLabel}</span>
      ) : presentation === 'summary' && !loading && !redacted ? (
        <FactDetails
          label={
            <span className="vn-date-fact-summary">
              <span className="vn-fact-label">{dateLabel || kindLabel}</span>
              <span>依据与来源</span>
            </span>
          }
        >
          {metadata}
        </FactDetails>
      ) : (
        <span className="vn-fact-label">
          {presentation === 'summary' ? dateLabel || kindLabel : kindLabel}
          {presentation === 'detail' && dateLabel && (
            <span className="vn-fact-meta"> · {dateLabel}</span>
          )}
        </span>
      )}
      {!loading && !redacted && (
        <>
          {!compact && fact.label && fact.label !== kindLabel && fact.label !== dateLabel && (
            <span className="vn-fact-meta">{fact.label}</span>
          )}
          {presentation === 'detail' && metadata}
          {fact.state === 'COMPLETED' && fact.completedOn && !isCalendarDate(fact.completedOn) && (
            <span className="vn-fact-error">完成日期格式有误</span>
          )}
        </>
      )}
    </div>
  );
}
