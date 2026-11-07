import { Combobox } from '../components/ui/combobox';
import { LocationPath } from './location-path';
import type { ItemView } from './types';
import { cn } from '../components/utils';
import './fields.css';

export type ContainerEligibility =
  | { kind: 'validContainer' }
  | { kind: 'invalid' | 'cycle' | 'currentParent' | 'unverified'; reason: string };
export interface LocationCandidate {
  itemId: ItemView['id'];
  name: string;
  path: readonly string[];
  eligibility: ContainerEligibility;
  source: string;
}
export type LocationSelection =
  | { kind: 'item'; itemId: ItemView['id']; name: string; path: readonly string[] }
  | { kind: 'root' }
  | { kind: 'unknown' };
export interface LocationPolicy {
  allowed: boolean;
  reason?: string;
}
export interface LocationPickerProps {
  value: LocationSelection;
  onValueChange: (value: LocationSelection) => void;
  candidates: readonly LocationCandidate[];
  query: string;
  onQueryChange: (query: string) => void;
  rootPolicy: LocationPolicy;
  unknownPolicy: LocationPolicy;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}
/** Container validity is an explicit caller assertion, never inferred from the candidate name. */
export function LocationPicker({
  value,
  onValueChange,
  candidates,
  query,
  onQueryChange,
  rootPolicy,
  unknownPolicy,
  loading,
  error,
  disabled,
  readOnly,
  className,
}: LocationPickerProps) {
  const unavailableReason = (candidate: LocationCandidate) =>
    !/^item_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidate.itemId)
      ? '位置信息不完整，暂不可选。'
      : !candidate.path.length
        ? '存放路径不完整，暂不可选。'
        : candidate.eligibility.kind !== 'validContainer'
          ? candidate.eligibility.reason
          : undefined;
  const selectedCandidate =
    value.kind === 'item'
      ? candidates.find((candidate) => candidate.itemId === value.itemId)
      : undefined;
  return (
    <div className={cn('vn-domain-field', className)}>
      <Combobox
        label="存放位置"
        value={value.kind === 'item' ? value.itemId : value.kind === 'root' ? '__root' : null}
        selectedLabel={
          value.kind === 'item' ? value.name : value.kind === 'root' ? '不放入容器' : undefined
        }
        query={query}
        onQueryChange={onQueryChange}
        clearable={false}
        onValueChange={(id) => {
          if (id === '__root' && rootPolicy.allowed) {
            onValueChange({ kind: 'root' });
            onQueryChange('');
            return;
          }
          if (id === '__unknown' && unknownPolicy.allowed) {
            onValueChange({ kind: 'unknown' });
            onQueryChange('');
            return;
          }
          const candidate = candidates.find((entry) => entry.itemId === id);
          if (candidate && !unavailableReason(candidate))
            onValueChange({
              kind: 'item',
              itemId: candidate.itemId,
              name: candidate.name,
              path: candidate.path,
            });
        }}
        options={[
          ...candidates.map((candidate) => ({
            value: candidate.itemId,
            label: candidate.name,
            description: `${candidate.path.join(' / ') || '完整路径未提供'}${candidate.source ? ` · 来源：${candidate.source}` : ''}${unavailableReason(candidate) ? ` · 不可选：${unavailableReason(candidate)}` : ' · 可容纳物品'}`,
            disabled: Boolean(unavailableReason(candidate)),
          })),
          {
            value: '__root',
            label: '不放入容器',
            disabled: !rootPolicy.allowed,
            description: rootPolicy.allowed
              ? '明确放在家庭根位置'
              : rootPolicy.reason || '当前操作不允许此位置',
          },
          {
            value: '__unknown',
            label: '位置未记录',
            disabled: !unknownPolicy.allowed,
            description: unknownPolicy.allowed
              ? undefined
              : unknownPolicy.reason || '当前操作要求明确位置',
          },
        ]}
        loading={loading}
        error={error}
        disabled={disabled}
        readOnly={readOnly}
        placeholder="选择位置或容器"
        emptyMessage="当前候选页没有可匹配的位置物品"
      />
      {value.kind !== 'unknown' && (
        <div className="vn-fields-selection" aria-live="polite">
          <LocationPath
            location={
              value.kind === 'item'
                ? { id: value.itemId, label: value.name, path: [...value.path] }
                : null
            }
            state={value.kind === 'item' ? 'known' : value.kind}
          />
        </div>
      )}
      <div className="vn-fields-actions">
        <details className="vn-field-details">
          <summary>位置说明</summary>
          <div className="vn-field-details__content">
            <p className="vn-muted">仅可选择可容纳物品的位置；同名位置请核对完整存放路径。</p>
            <p className="vn-muted">家庭根位置表示未放入其他容器；未知表示尚未确认存放位置。</p>
            {selectedCandidate?.source && (
              <p className="vn-muted">来源：{selectedCandidate.source}</p>
            )}
          </div>
        </details>
      </div>
      {!rootPolicy.allowed && (
        <span className="vn-muted">
          根位置不可选：{rootPolicy.reason || '当前操作不允许根位置。'}
        </span>
      )}
      {!unknownPolicy.allowed && (
        <span className="vn-muted">
          未知位置不可选：{unknownPolicy.reason || '当前操作要求明确位置。'}
        </span>
      )}
    </div>
  );
}
