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
          <p className="vn-list-meta vn-product-counts-inline">
            <span>{count === null ? '件数未知' : `${count} 件物品`}</span>
            <span>{group.locations} 处位置</span>
            <span>{group.currentCount} 件有效记录</span>
          </p>
        </div>
        {coverage !== 'live' && (
          <Badge variant="warning" compact="never">
            {coverage === 'cached-subset' ? '缓存子集' : '范围未知'}
          </Badge>
        )}
      </div>
      <div className="vn-product-facts">
        <div className="vn-product-quantities">
          <span className="vn-fact-label">
            {group.unknownQuantity > 0 ? '已记录合计' : '数量合计'}
          </span>
          {group.totals.length ? (
            group.totals.map((total) => (
              <QuantityValue
                key={total.unit}
                label="已记录数量合计"
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
            ))
          ) : (
            <p className="vn-list-meta">数量未记录</p>
          )}
        </div>
        {displayedDate ? (
          <DateFactValue fact={displayedDate} compact />
        ) : (
          <p className="vn-list-meta">日期未记录</p>
        )}
      </div>
      <FactDetails label="更多资料">
        <span className="vn-list-meta">商品 ID：{group.id}</span>
        {group.unknownQuantity > 0 && (
          <p className="vn-list-meta">{group.unknownQuantity} 件数量未记录，未计入合计。</p>
        )}
        {group.totals.some((total) => total.estimated && total.unknownAccuracy) && (
          <p className="vn-list-meta">合计包含估计值与精度未记录的数量。</p>
        )}
        {displayedDate && <DateFactValue fact={displayedDate} presentation="detail" />}
        <p className="vn-list-meta">
          已开封 {group.opened} 件 · 未开封 {group.sealed} 件
          {group.unknownOpening > 0 && ` · ${group.unknownOpening} 件开封状态未记录`}
          {group.unknownLifecycle > 0 && ` · ${group.unknownLifecycle} 件生命周期未记录`}
        </p>
        <p className="vn-list-meta">
          逾期：{group.overdueCount === null ? '未知' : `${group.overdueCount} 件`} · 低库存：
          {group.lowStock === null ? '未知' : group.lowStock ? '已达到提醒条件' : '未达到提醒条件'}
        </p>
      </FactDetails>
      {coverage !== 'live' && (
        <InlineNotice announce={false} tone="warning" title="汇总范围有限">
          {coverage === 'cached-subset'
            ? '以上数据仅表示已提供的缓存范围，不能解释为全家庭完整库存。'
            : '读取覆盖范围尚未确认，不能解释为完整库存。'}
        </InlineNotice>
      )}
      <div className="vn-row">
        <Button variant="secondary" onClick={() => onOpenItems(group.id)}>
          查看物品
        </Button>
        {onIntake && (
          <Button
            disabled={intakeAvailability.kind !== 'available'}
            onClick={() => onIntake(group.id)}
          >
            入库
          </Button>
        )}
      </div>
      {onIntake && intakeAvailability.kind !== 'available' && (
        <p className="vn-list-meta">{intakeAvailability.reason}</p>
      )}
    </section>
  );
}
