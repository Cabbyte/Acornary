import { useState } from 'react';
import { PageHeader } from '../../../ui/patterns/page-header';
import { HistoryEntry, type HistoryEntryProps } from '../../../ui/patterns/history-entry';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { Select } from '../../../ui/components/ui/select';
import { PaginationControls } from '../../../ui/components/ui/pagination-controls';
import { ReadContent } from './read-content';
import type { DailyPagination, DailyReadProps } from './models';
import './daily-pages.css';
export type ActivityFilter = 'all' | 'quantity' | 'other';
export interface DailyActivityProps extends DailyReadProps {
  entries: readonly (Omit<HistoryEntryProps, 'expanded' | 'onExpandedChange'> & {
    recordedDayLabel: string;
    operationComplete: boolean;
  })[];
  rangeLabel: string;
  days: '7' | '30';
  onDaysChange: (value: '7' | '30') => void;
  filter: ActivityFilter;
  onFilterChange: (value: ActivityFilter) => void;
  pagination: DailyPagination;
  onOpenItemHistory: (id: string) => void;
}
export function DailyActivity(props: DailyActivityProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  return (
    <section className="vn-daily-page">
      <PageHeader title="最近变化" />
      <div className="vn-daily-feed-toolbar">
        <Select
          label="变化类型"
          value={props.filter}
          onValueChange={(value) => props.onFilterChange(value as ActivityFilter)}
          options={[
            { value: 'all', label: '全部变化' },
            { value: 'quantity', label: '余量记录' },
            { value: 'other', label: '其他变化' },
          ]}
        />
        <Select
          label="时间范围"
          value={props.days}
          onValueChange={(v) => props.onDaysChange(v === '30' ? '30' : '7')}
          options={[
            { value: '7', label: '最近 7 天' },
            { value: '30', label: '最近 30 天' },
          ]}
        />
        <span className="vn-muted">{props.rangeLabel} · 按发生时间倒序</span>
      </div>
      <ReadContent state={props.state} onRetry={props.onRetry} loadingLabel="正在读取最近变化">
        {props.entries.length ? (
          <div className="vn-daily-history">
            {props.entries.map((entry, index) => {
              const sameOperation =
                index > 0 &&
                props.entries[index - 1].event?.operation_id === entry.event?.operation_id;
              const operationCount = props.entries.filter(
                (e) => e.event?.operation_id === entry.event?.operation_id,
              ).length;
              const id = entry.event?.id || `unavailable-${index}`;
              return (
                <section key={id} className="vn-daily-activity-operation">
                  {props.entries[index - 1]?.recordedDayLabel !== entry.recordedDayLabel && (
                    <h2>{entry.recordedDayLabel}</h2>
                  )}
                  {!sameOperation && operationCount > 1 && (
                    <p className="vn-muted">同一次操作 · {operationCount} 条已加载记录</p>
                  )}
                  {!entry.operationComplete && <p className="vn-muted">本次操作仅加载部分变化</p>}
                  <HistoryEntry
                    key={id}
                    {...entry}
                    expanded={expanded.has(id)}
                    onExpandedChange={(open) =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        if (open) next.add(id);
                        else next.delete(id);
                        return next;
                      })
                    }
                    onOpenTarget={(target) => {
                      if (target.kind === 'ITEM') props.onOpenItemHistory(target.id);
                    }}
                  />
                </section>
              );
            })}
          </div>
        ) : (
          <EmptyState
            reason="empty"
            title={props.state === 'offline-partial' ? '缓存中没有这类变化' : '还没有这类变化'}
          />
        )}
        <PaginationControls {...props.pagination} />
      </ReadContent>
    </section>
  );
}
