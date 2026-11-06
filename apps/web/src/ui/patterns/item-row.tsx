import { useId } from 'react';
import type {
  ActionAvailability,
  DateFactPresentation,
  ItemView,
  QuantityPresentation,
} from './types';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { ItemIdentity } from './item-identity';
import { ItemStatus } from './item-status';
import { QuantityValue } from './quantity-value';
import { DateFactValue } from './date-fact-value';
import { LocationPath } from './location-path';
import { FactSource } from './fact-source';
import { LoadingState } from './loading-state';
import { InlineNotice } from '../components/ui/inline-notice';
import { cn } from '../components/utils';
import './lists.css';

export interface ItemAction {
  kind: string;
  label: string;
  availability: ActionAvailability;
  destructive?: boolean;
}
export interface ItemRowProps {
  item: ItemView;
  quantity?: QuantityPresentation;
  date?: DateFactPresentation;
  selected?: boolean;
  onSelect?: (id: ItemView['id'], selected: boolean) => void;
  selectionAvailability?: ActionAvailability;
  onOpen: (id: ItemView['id']) => void;
  actions?: readonly ItemAction[];
  onAction?: (kind: string, id: ItemView['id']) => void;
  onOpenLocation?: (id: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  className?: string;
}

export function ItemRow({
  item,
  quantity,
  date,
  selected = false,
  onSelect,
  selectionAvailability = { kind: 'available' },
  onOpen,
  actions = [],
  onAction,
  onOpenLocation,
  readOnly = false,
  disabled = false,
  loading = false,
  error,
  className,
}: ItemRowProps) {
  const headingId = useId();
  const nameHidden = item.redactedPaths.some((path) => path === 'display_name' || path === 'name');
  const locationUnknown = item.location.id === null && item.location.path.length === 0;
  return (
    <article
      className={cn('vn-item-row', className)}
      data-selected={selected || undefined}
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
    >
      {onSelect && (
        <div className="vn-item-row-selection">
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelect(item.id, value)}
            label={
              <span className="vn-list-sr-only">
                选择{nameHidden ? '此物品' : item.name}，{item.id}
              </span>
            }
            readOnly={readOnly}
            disabled={disabled || loading || selectionAvailability.kind !== 'available'}
            description={
              selectionAvailability.kind !== 'available' ? selectionAvailability.reason : undefined
            }
          />
        </div>
      )}
      <div className="vn-item-row-content">
        <div id={headingId}>
          <ItemIdentity
            item={item}
            onOpen={onOpen}
            disabled={disabled || loading}
            redacted={nameHidden}
          />
        </div>
        <ItemStatus status={item.status} recordState={item.recordState} />
        {loading ? (
          <LoadingState layout="compact" label="正在刷新物品事实" />
        ) : (
          <>
            <LocationPath
              location={item.location}
              state={locationUnknown ? 'unknown' : 'known'}
              onOpen={onOpenLocation}
              disabled={disabled}
            />
            {quantity && <QuantityValue quantity={quantity} />}
            {date && <DateFactValue fact={date} />}
            {item.facts
              .filter(
                (fact) =>
                  !(quantity && fact.kind === 'remaining') &&
                  !(date && fact.kind === 'expiry' && date.kind === 'EXPIRY'),
              )
              .map((fact) => (
                <div
                  className="vn-item-extra-fact"
                  key={`${fact.kind}:${fact.label}:${fact.source?.path ?? ''}`}
                >
                  <span className="vn-list-meta">{fact.label}</span>
                  <span>{fact.value}</span>
                  {fact.source && <FactSource source={fact.source} />}
                </div>
              ))}
          </>
        )}
        {error && (
          <InlineNotice tone="warning" title="物品事实刷新失败">
            {error}
          </InlineNotice>
        )}
        {readOnly && <p className="vn-list-meta">只读：可查看事实，不能选择或发起变更。</p>}
        {actions.length > 0 && !onAction && <p className="vn-list-meta">当前无法发起物品操作。</p>}
      </div>
      {actions.length > 0 && (
        <div className="vn-item-row-actions">
          {actions.map((action) => (
            <div key={action.kind} className="vn-list-action">
              <Button
                variant={action.destructive ? 'danger' : 'secondary'}
                disabled={
                  disabled ||
                  loading ||
                  readOnly ||
                  !onAction ||
                  action.availability.kind !== 'available'
                }
                onClick={() => onAction?.(action.kind, item.id)}
              >
                {action.label}
              </Button>
              {action.availability.kind !== 'available' && (
                <span className="vn-list-meta">{action.availability.reason}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
