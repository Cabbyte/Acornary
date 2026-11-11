import { useId, useState } from 'react';
import { MoreHorizontal, PackageMinus } from 'lucide-react';
import type {
  ActionAvailability,
  DateFactPresentation,
  ItemView,
  QuantityPresentation,
} from './types';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';
import { Checkbox } from '../components/ui/checkbox';
import { DropdownMenu } from '../components/ui/dropdown-menu';
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
  const [moreOpen, setMoreOpen] = useState(false);
  const nameHidden = item.redactedPaths.some((path) => path === 'display_name' || path === 'name');
  const locationUnknown = item.location.id === null && item.location.path.length === 0;
  const [primaryAction, ...moreActions] = actions;
  const actionsDisabled = disabled || loading || readOnly || !onAction;
  const blockedActions = actions.filter((action) => action.availability.kind !== 'available');
  const extraFacts = item.facts.filter(
    (fact) =>
      !(quantity && fact.kind === 'remaining') &&
      !(date && fact.kind === 'expiry' && date.kind === 'EXPIRY'),
  );
  return (
    <article
      className={cn('vn-item-row', className)}
      data-selected={selected || undefined}
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
    >
      <div className="vn-item-row-content" data-selectable={Boolean(onSelect)}>
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
                selectionAvailability.kind !== 'available'
                  ? selectionAvailability.reason
                  : undefined
              }
            />
          </div>
        )}
        <div className="vn-item-row-identity">
          <div id={headingId}>
            <ItemIdentity
              item={item}
              onOpen={onOpen}
              disabled={disabled || loading}
              redacted={nameHidden}
              status={<ItemStatus status={item.status} recordState={item.recordState} />}
            />
          </div>
        </div>
        {!loading && (
          <>
            <div className="vn-item-row-location">
              <LocationPath
                location={item.location}
                state={locationUnknown ? 'unknown' : 'known'}
                onOpen={onOpenLocation}
                disabled={disabled}
              />
            </div>
            <div className="vn-item-row-facts">
              {quantity && (
                <div className="vn-item-row-quantity">
                  <QuantityValue quantity={quantity} />
                </div>
              )}
              {date && (
                <div className="vn-item-row-date">
                  <DateFactValue fact={date} compact dateOnly />
                </div>
              )}
            </div>
            {extraFacts.length > 0 && (
              <div className="vn-item-row-extra">
                {extraFacts.map((fact) => (
                  <div
                    className="vn-item-extra-fact"
                    data-tone={fact.tone}
                    key={`${fact.kind}:${fact.label}:${fact.source?.path ?? ''}`}
                  >
                    <span className="vn-list-meta">{fact.label}</span>
                    <span>{fact.value}</span>
                    {fact.source && <FactSource source={fact.source} />}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {primaryAction && (
          <div className="vn-item-row-actions">
            {primaryAction.kind === 'consume' ? (
              <IconButton
                label={`使用${nameHidden ? '此物品' : item.name}`}
                variant={primaryAction.destructive ? 'danger' : 'secondary'}
                disabled={actionsDisabled || primaryAction.availability.kind !== 'available'}
                onClick={() => onAction?.(primaryAction.kind, item.id)}
              >
                <PackageMinus size={18} />
              </IconButton>
            ) : (
              <Button
                variant={primaryAction.destructive ? 'danger' : 'secondary'}
                disabled={actionsDisabled || primaryAction.availability.kind !== 'available'}
                onClick={() => onAction?.(primaryAction.kind, item.id)}
              >
                {primaryAction.label}
              </Button>
            )}
            {moreActions.length > 0 && (
              <DropdownMenu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                trigger={
                  <IconButton
                    variant="quiet"
                    label={`${nameHidden ? '此物品' : item.name}的更多操作`}
                  >
                    <MoreHorizontal size={18} aria-hidden="true" />
                  </IconButton>
                }
                disabled={disabled || loading}
                items={moreActions.map((action) => ({
                  id: action.kind,
                  label: action.label,
                  tone: action.destructive ? 'danger' : 'default',
                  disabled: actionsDisabled,
                  disabledReason:
                    action.availability.kind !== 'available'
                      ? action.availability.reason
                      : undefined,
                }))}
                onSelect={(kind) => onAction?.(kind, item.id)}
              />
            )}
          </div>
        )}
        {(loading ||
          error ||
          readOnly ||
          blockedActions.length > 0 ||
          (actions.length > 0 && !onAction)) && (
          <div className="vn-item-row-feedback">
            {loading && <LoadingState layout="compact" label="正在刷新物品事实" />}
            {error && (
              <InlineNotice tone="warning" title="物品事实刷新失败">
                {error}
              </InlineNotice>
            )}
            {readOnly && <p className="vn-list-meta">只读，无法选择或修改。</p>}
            {actions.length > 0 && !onAction && (
              <p className="vn-list-meta">当前无法发起物品操作。</p>
            )}
            {blockedActions.map(
              (action) =>
                action.availability.kind !== 'available' && (
                  <p className="vn-list-meta" key={action.kind}>
                    {action.label}：{action.availability.reason}
                  </p>
                ),
            )}
          </div>
        )}
      </div>
    </article>
  );
}
