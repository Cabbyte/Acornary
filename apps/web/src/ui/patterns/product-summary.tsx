import { useId } from 'react';
import type { ActionAvailability, DateFactPresentation, GroupView } from './types';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { InlineNotice } from '../components/ui/inline-notice';
import { QuantityValue } from './quantity-value';
import { DateFactValue } from './date-fact-value';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import { FactDetails } from './fact-details';
import { cn } from '../components/utils';
import './lists.css';

export interface ProductSummaryProps {
  group: GroupView | null;
  coverage: 'live' | 'cached-subset' | 'none';
  /** Use null when the exact server count is unavailable; omission uses GroupView.count. */
  knownItemCount?: number | null;
  nextDate?: DateFactPresentation | null;
  loading?: boolean;
  error?: string;
  onOpenItems: (catalogId: GroupView['id']) => void;
  onIntake?: (catalogId: GroupView['id']) => void;
  intakeAvailability?: ActionAvailability;
  className?: string;
}

export function ProductSummary({
  group,
  coverage,
  knownItemCount,
  nextDate,
  loading = false,
  error,
  onOpenItems,
  onIntake,
  intakeAvailability = { kind: 'available' },
  className,
}: ProductSummaryProps) {
  const headingId = useId();
  if (loading) return <LoadingState label="正在加载商品汇总" layout="card" />;
  if (error) return <EmptyState reason="error" context={error} />;
  if (!group) return <EmptyState reason="unknown" title="商品汇总尚未取得" />;
  const count = knownItemCount === undefined ? group.count : knownItemCount;
  const displayedDate =
    nextDate === undefined && group.nextDate ? { ...group.nextDate, dateKind: null } : nextDate;
  return (
    <section
      className={cn('vn-product-summary vn-list-panel', className)}
      aria-labelledby={headingId}
    >
      <div className="vn-list-heading">
        <div>
          <h2 id={headingId}>{group.name}</h2>
          <FactDetails label="商品详情">
            <span className="vn-list-meta">商品 ID：{group.id}</span>
          </FactDetails>
        </div>
        <Badge variant={coverage === 'live' ? 'neutral' : 'warning'}>
          {coverage === 'live'
            ? '当前范围'
            : coverage === 'cached-subset'
              ? '缓存子集'
              : '范围未知'}
        </Badge>
      </div>
      <dl className="vn-product-counts">
        <div>
          <dt>具体物品</dt>
          <dd>{count === null ? '数量未知' : `${count} 件`}</dd>
        </div>
        <div>
          <dt>存放位置</dt>
          <dd>{group.locations} 处</dd>
        </div>
        <div>
          <dt>当前有效记录</dt>
          <dd>{group.currentCount} 件</dd>
        </div>
      </dl>
      <div className="vn-product-facts">
        <div className="vn-product-quantities">
          <h3 className="vn-section-title">已知数量合计</h3>
          {group.totals.length ? (
            group.totals.map((total) => (
              <div key={total.unit}>
                <QuantityValue
                  label="合计"
                  quantity={{
                    value: total.value,
                    unit: total.unit,
                    accuracy: total.estimated
                      ? 'estimated'
                      : total.unknownAccuracy
                        ? 'unknown'
                        : 'measured',
                  }}
                />
                {total.estimated && total.unknownAccuracy && (
                  <p className="vn-list-meta">此合计还包含精度未记录的数量。</p>
                )}
              </div>
            ))
          ) : (
            <p className="vn-list-meta">没有可展示的已知数量合计</p>
          )}
          {group.unknownQuantity > 0 && (
            <p className="vn-list-meta">
              另有 {group.unknownQuantity} 件数量未记录，不包含在以上合计中。
            </p>
          )}
        </div>
        {displayedDate ? (
          <DateFactValue fact={displayedDate} />
        ) : (
          <p className="vn-list-meta">下一日期未记录</p>
        )}
      </div>
      <p className="vn-list-meta">
        已开封 {group.opened} 件 · 未开封 {group.sealed} 件
        {group.unknownOpening > 0 && ` · ${group.unknownOpening} 件开封状态未记录`}
        {group.unknownLifecycle > 0 && ` · ${group.unknownLifecycle} 件生命周期未记录`}
      </p>
      <p className="vn-list-meta">
        逾期：{group.overdueCount === null ? '未知' : `${group.overdueCount} 件`} · 低库存：
        {group.lowStock === null ? '未知' : group.lowStock ? '已达到提醒条件' : '未达到提醒条件'}
      </p>
      {coverage !== 'live' && (
        <InlineNotice announce={false} tone="warning" title="汇总范围有限">
          {coverage === 'cached-subset'
            ? '以上数据仅表示已提供的缓存范围，不能解释为全家庭完整库存。'
            : '读取覆盖范围尚未确认，不能解释为完整库存。'}
        </InlineNotice>
      )}
      <div className="vn-row">
        <Button variant="secondary" onClick={() => onOpenItems(group.id)}>
          查看具体物品
        </Button>
        {onIntake && (
          <Button
            disabled={intakeAvailability.kind !== 'available'}
            onClick={() => onIntake(group.id)}
          >
            入库此商品
          </Button>
        )}
      </div>
      {onIntake && intakeAvailability.kind !== 'available' && (
        <p className="vn-list-meta">{intakeAvailability.reason}</p>
      )}
    </section>
  );
}
