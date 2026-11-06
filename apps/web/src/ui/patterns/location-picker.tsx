import { Combobox } from '../components/ui/combobox';
import { Button } from '../components/ui/button';
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
  return (
    <div className={cn('vn-domain-field', className)}>
      <Combobox
        label="存放位置"
        value={value.kind === 'item' ? value.itemId : null}
        selectedLabel={value.kind === 'item' ? value.name : undefined}
        query={query}
        onQueryChange={onQueryChange}
        clearable={false}
        onValueChange={(id) => {
          const candidate = candidates.find((entry) => entry.itemId === id);
          if (candidate && !unavailableReason(candidate))
            onValueChange({
              kind: 'item',
              itemId: candidate.itemId,
              name: candidate.name,
              path: candidate.path,
            });
        }}
        options={candidates.map((candidate) => ({
          value: candidate.itemId,
          label: candidate.name,
          description: `位置物品 · ${candidate.path.join(' / ') || '完整路径未提供'} · 来源：${candidate.source}${unavailableReason(candidate) ? ` · 不可选：${unavailableReason(candidate)}` : ' · 可容纳物品'}`,
          disabled: Boolean(unavailableReason(candidate)),
        }))}
        loading={loading}
        error={error}
        disabled={disabled}
        readOnly={readOnly}
        hint="仅可选择可容纳物品的位置；请核对完整存放路径。"
        emptyMessage="当前候选页没有可匹配的位置物品"
      />
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
      <div className="vn-row">
        <Button
          variant="secondary"
          disabled={disabled || readOnly || loading || !rootPolicy.allowed}
          onClick={() => {
            onValueChange({ kind: 'root' });
            onQueryChange('');
          }}
        >
          放在家庭根位置
        </Button>
        <Button
          variant="quiet"
          disabled={disabled || readOnly || loading || !unknownPolicy.allowed}
          onClick={() => {
            onValueChange({ kind: 'unknown' });
            onQueryChange('');
          }}
        >
          标记位置未知
        </Button>
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
