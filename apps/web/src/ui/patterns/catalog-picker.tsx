import { Combobox } from '../components/ui/combobox';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import type { CatalogView } from './types';
import { cn } from '../components/utils';
import './fields.css';

export interface CatalogCandidate {
  id: CatalogView['id'];
  kind: CatalogView['kind'];
  name: string;
  path: readonly string[];
  ruleSummary?: string;
  disabledReason?: string;
}
export type CatalogSelection = Pick<CatalogCandidate, 'id' | 'kind' | 'name' | 'path'> | null;
export interface CatalogPickerProps {
  value: CatalogSelection;
  onValueChange: (value: CatalogSelection) => void;
  candidates: readonly CatalogCandidate[];
  allowedKinds: readonly CatalogView['kind'][];
  query: string;
  onQueryChange: (query: string) => void;
  onRequestCreate?: (kind: CatalogView['kind'], query: string) => void;
  createUnavailableReason?: string;
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}
export function CatalogPicker({
  value,
  onValueChange,
  candidates,
  allowedKinds,
  query,
  onQueryChange,
  onRequestCreate,
  createUnavailableReason,
  loading,
  error,
  disabled,
  readOnly,
  className,
}: CatalogPickerProps) {
  const unavailableReason = (candidate: CatalogCandidate) =>
    candidate.disabledReason ||
    (!/^catalog_node_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidate.id)
      ? '候选信息不完整，暂不可选。'
      : !candidate.path.length
        ? '分类路径不完整，暂不可选。'
        : !allowedKinds.includes(candidate.kind)
          ? `当前仅允许${allowedKinds.map((kind) => (kind === 'GROUP' ? '分类' : '商品')).join('、')}。`
          : undefined);
  return (
    <div className={cn('vn-domain-field', className)}>
      <Combobox
        label="分类或商品"
        value={value?.id ?? null}
        selectedLabel={value?.name}
        onValueChange={(id) => {
          if (id === null) {
            onValueChange(null);
            return;
          }
          const candidate = candidates.find((entry) => entry.id === id);
          if (candidate && !unavailableReason(candidate))
            onValueChange({
              id: candidate.id,
              kind: candidate.kind,
              name: candidate.name,
              path: candidate.path,
            });
        }}
        query={query}
        onQueryChange={onQueryChange}
        options={candidates.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
          description: `${candidate.kind === 'GROUP' ? '分类 GROUP' : '商品 SKU'} · ${candidate.path.join(' / ') || '目录路径未提供'}${candidate.ruleSummary ? ` · ${candidate.ruleSummary}` : ''}${unavailableReason(candidate) ? ` · ${unavailableReason(candidate)}` : ''}`,
          disabled: Boolean(unavailableReason(candidate)),
        }))}
        loading={loading}
        error={error}
        disabled={disabled}
        readOnly={readOnly}
        hint="同名条目请核对完整分类路径；分类不表示存放位置。"
        emptyMessage="当前候选页没有匹配的分类或商品"
      />
      <div className="vn-fields-selection" aria-live="polite">
        {value ? (
          <>
            <Badge variant="accent">{value.kind === 'GROUP' ? '分类' : '商品 SKU'}</Badge>
            <span>{value.path.join(' / ') || value.name}</span>
          </>
        ) : (
          <span className="vn-muted">尚未选择目录节点</span>
        )}
      </div>
      {onRequestCreate && (
        <div className="vn-row">
          {allowedKinds.map((kind) => (
            <Button
              key={kind}
              variant="quiet"
              disabled={disabled || readOnly || loading || Boolean(createUnavailableReason)}
              onClick={() => onRequestCreate(kind, query)}
            >
              申请新建{kind === 'GROUP' ? '分类' : '商品'}
            </Button>
          ))}
        </div>
      )}
      {createUnavailableReason && <span className="vn-muted">{createUnavailableReason}</span>}
    </div>
  );
}
