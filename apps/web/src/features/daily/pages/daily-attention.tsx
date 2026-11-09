import { PageHeader } from '../../../ui/patterns/page-header';
import { ProductSummary } from '../../../ui/patterns/product-summary';
import type { GroupView } from '../../../ui/patterns/types';
import { ItemRow } from '../../../ui/patterns/item-row';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { Select } from '../../../ui/components/ui/select';
import { PaginationControls } from '../../../ui/components/ui/pagination-controls';
import { ReadContent } from './read-content';
import type { DailyItemFacts, DailyPagination, DailyReadProps } from './models';
import './daily-pages.css';

export type AttentionCategory = 'date' | 'stock' | 'loan' | 'repair';
export interface AttentionTask {
  id: string;
  category: AttentionCategory;
  facts: DailyItemFacts;
  reason: string;
  basis: string;
}
export interface DailyAttentionProps extends DailyReadProps {
  tasks: readonly AttentionTask[];
  stocks: readonly { group: GroupView; basis: string }[];
  onOpenProduct: (id: string) => void;
  dateRange: string;
  onDateRangeChange: (value: string) => void;
  category: AttentionCategory;
  onCategoryChange: (value: AttentionCategory) => void;
  pagination: DailyPagination;
  familyTimezone: string | null;
  asOf: string;
  onOpenItem: (id: string) => void;
}
/** Tasks and their factual basis come from the read adapter; the page infers no alerts. */
export function DailyAttention(props: DailyAttentionProps) {
  return (
    <section className="vn-daily-page">
      <PageHeader title="需要留意" />
      <div className="vn-daily-feed-toolbar">
        <Select
          label="留意类型"
          value={props.category}
          onValueChange={(value) => props.onCategoryChange(value as AttentionCategory)}
          options={[
            { value: 'date', label: '日期' },
            { value: 'stock', label: '补货' },
            { value: 'loan', label: '借出' },
            { value: 'repair', label: '维护' },
          ]}
        />
        {props.category === 'date' && (
          <Select
            label="日期范围"
            value={props.dateRange}
            onValueChange={(v) => props.onDateRangeChange(v || 'upcoming')}
            options={[
              { value: 'past', label: '已过记录日' },
              { value: 'today', label: '今天' },
              { value: 'upcoming', label: '未来 7 天' },
            ]}
          />
        )}
        <span className="vn-muted">
          {props.familyTimezone
            ? `${props.asOf} · ${props.familyTimezone}`
            : '家庭时区未提供 · 日期提醒待核对'}
        </span>
      </div>
      <ReadContent state={props.state} onRetry={props.onRetry} loadingLabel="正在读取留意事项">
        {props.category === 'stock' && props.stocks.length ? (
          <div className="vn-daily-products">
            {props.stocks.map((stock) => (
              <div key={stock.group.id}>
                <ProductSummary
                  group={stock.group}
                  coverage={props.state === 'offline-partial' ? 'cached-subset' : 'live'}
                  onOpenItems={props.onOpenProduct}
                />
                <p className="vn-muted">{stock.basis}</p>
              </div>
            ))}
          </div>
        ) : props.tasks.length ? (
          <div className="vn-daily-attention-list">
            {props.tasks.map((task) => (
              <article key={task.id}>
                <div className="vn-daily-attention-reason">
                  <h2>{task.reason}</h2>
                  <details>
                    <summary>提醒依据</summary>
                    <p>{task.basis}</p>
                  </details>
                </div>
                <ItemRow
                  item={task.facts.item}
                  quantity={task.facts.quantity}
                  date={task.facts.date}
                  onOpen={props.onOpenItem}
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            reason="empty"
            title={props.state === 'offline-partial' ? '缓存中没有这类事项' : '没有这类留意事项'}
            context="仅根据已记录的事实判断；未记录不代表无需留意。"
          />
        )}
        <PaginationControls {...props.pagination} />
      </ReadContent>
    </section>
  );
}
