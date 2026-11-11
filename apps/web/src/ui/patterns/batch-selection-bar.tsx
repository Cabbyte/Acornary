import { useId } from 'react';
import type { ActionAvailability, SelectionSnapshot } from './types';
import { Button } from '../components/ui/button';
import { InlineNotice } from '../components/ui/inline-notice';
import { cn } from '../components/utils';
import './lists.css';

export interface BatchSelectionBarProps {
  selection: SelectionSnapshot;
  /** Human-readable scope; selection.scope remains the full operation identity. */
  scopeLabel?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onReview: (selection: SelectionSnapshot) => void;
  onStartAction: (selection: SelectionSnapshot) => void;
  actionLabel?: string;
  availability?: ActionAvailability;
  readOnly?: boolean;
  busy?: boolean;
  className?: string;
}

export function BatchSelectionBar({
  selection,
  scopeLabel,
  expanded,
  onExpandedChange,
  onRemove,
  onClear,
  onReview,
  onStartAction,
  actionLabel = '处理已选',
  availability = { kind: 'available' },
  readOnly = false,
  busy = false,
  className,
}: BatchSelectionBarProps) {
  const listId = useId();
  const ids = [...new Set(selection.ids)];
  const visibleIds = new Set(selection.visibleIds);
  const unavailable = new Set(selection.unavailableIds ?? []);
  const hiddenCount = ids.filter((id) => !visibleIds.has(id)).length;
  const unavailableCount = ids.filter((id) => unavailable.has(id)).length;
  const limit = Math.min(selection.limit ?? 100, 100);
  const exceeded = ids.length > limit;
  const invalidIdentity = ids.some(
    (id) => !/^item_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  );
  const duplicateIdentity = ids.length !== selection.ids.length;
  const blocked =
    ids.length === 0 ||
    exceeded ||
    unavailableCount > 0 ||
    invalidIdentity ||
    duplicateIdentity ||
    readOnly ||
    busy ||
    availability.kind !== 'available';
  // No selection means no batch task; the table still provides selection controls.
  if (ids.length === 0) return null;
  return (
    <section
      className={cn('vn-batch-selection vn-list-panel', className)}
      aria-label="已选具体物品"
    >
      <div className="vn-list-heading">
        <div>
          <strong>已选 {ids.length} 件</strong>
          <p className="vn-list-meta">
            {scopeLabel && `${scopeLabel} · `}
            {hiddenCount > 0 ? `其中 ${hiddenCount} 件不在当前视图` : '均在当前视图'}
            {unavailableCount > 0 && ` · ${unavailableCount} 件不可用`}
          </p>
        </div>
        <Button
          variant="quiet"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          aria-controls={listId}
        >
          {expanded ? '收起清单' : '查看清单'}
        </Button>
      </div>
      {exceeded && (
        <InlineNotice tone="danger" title={`超过单次 ${limit} 件上限`}>
          请移除多余物品；不会自动拆分执行。
        </InlineNotice>
      )}
      {invalidIdentity && (
        <InlineNotice tone="danger" title="包含非具体物品身份">
          商品汇总或分类不能直接作为批量操作对象，请先选择具体物品。
        </InlineNotice>
      )}
      {duplicateIdentity && (
        <InlineNotice tone="danger" title="选择中存在重复身份">
          请重新核对具体物品后继续。
        </InlineNotice>
      )}
      {unavailableCount > 0 && (
        <InlineNotice tone="warning" title="部分选择目前不可用">
          请核对或移除不可用的具体物品后继续。
        </InlineNotice>
      )}
      {availability.kind !== 'available' && <p className="vn-list-meta">{availability.reason}</p>}
      {readOnly && <p className="vn-list-meta">当前为只读，无法修改选择或发起批量操作。</p>}
      <div id={listId} hidden={!expanded}>
        <p className="vn-list-meta">
          {scopeLabel ? '范围 ID' : '范围'}：{selection.scope} · 单次上限 {limit} 件
        </p>
        {ids.length > 0 ? (
          <ul className="vn-batch-ids">
            {ids.map((id) => (
              <li key={id}>
                <div>
                  <code>{id}</code>
                  <span className="vn-list-meta">
                    {visibleIds.has(id) ? '当前可见' : '当前隐藏'}
                    {unavailable.has(id) ? ' · 不可用' : ''}
                    {selection.revisions?.[id] !== undefined
                      ? ` · 捕获版本 ${selection.revisions[id]}`
                      : ' · 捕获版本未提供'}
                  </span>
                </div>
                <Button
                  variant="quiet"
                  disabled={readOnly || busy}
                  onClick={() => onRemove(id)}
                  aria-label={`移除 ${id}`}
                >
                  移除
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vn-list-meta">尚未选择具体物品</p>
        )}
      </div>
      <div className="vn-split-actions">
        <Button disabled={blocked} busy={busy} onClick={() => onStartAction(selection)}>
          {actionLabel}
        </Button>
        <div className="vn-split-actions-secondary">
          <Button
            variant="secondary"
            disabled={ids.length === 0 || busy}
            onClick={() => onReview(selection)}
          >
            核对
          </Button>
          <Button variant="quiet" disabled={ids.length === 0 || readOnly || busy} onClick={onClear}>
            清空
          </Button>
        </div>
      </div>
    </section>
  );
}
