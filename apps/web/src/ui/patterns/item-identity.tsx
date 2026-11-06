import { Button as BaseButton } from '@base-ui/react/button';
import type { ItemView } from './types';
import { cn } from '../components/utils';
import './facts.css';

export interface ItemIdentityProps {
  item: Pick<ItemView, 'id' | 'name' | 'subtitle' | 'recordState'>;
  onOpen?: (id: ItemView['id']) => void;
  /** Emits a copy intention; the host decides clipboard capability and feedback. */
  onCopyId?: (id: ItemView['id']) => void;
  disabled?: boolean;
  readOnly?: boolean;
  redacted?: boolean;
  loading?: boolean;
  className?: string;
}

export function ItemIdentity({
  item,
  onOpen,
  onCopyId,
  disabled = false,
  readOnly = false,
  redacted = false,
  loading = false,
  className,
}: ItemIdentityProps) {
  if (loading)
    return (
      <span className={cn('vn-item-identity vn-fact-meta', className)} role="status">
        正在加载物品身份…
      </span>
    );
  const name = redacted ? '名称不可见' : item.name || '未命名物品';
  return (
    <div className={cn('vn-item-identity', className)}>
      <div className="vn-item-identity-heading">
        {onOpen && !readOnly ? (
          <BaseButton
            type="button"
            className="vn-fact-link vn-item-identity-name"
            disabled={disabled}
            onClick={() => onOpen(item.id)}
            aria-label={`打开${name}`}
          >
            {name}
          </BaseButton>
        ) : (
          <span className="vn-item-identity-name">{name}</span>
        )}
        {item.recordState === 'VOID' && (
          <span className="vn-fact-badge" data-tone="muted">
            已作废
          </span>
        )}
      </div>
      {!redacted && item.subtitle && <span className="vn-fact-meta">{item.subtitle}</span>}
      <div className="vn-item-identity-id">
        <span className="vn-fact-meta">物品 ID</span>
        <code>{item.id}</code>
        {onCopyId && (
          <BaseButton
            type="button"
            className="vn-fact-button"
            disabled={disabled}
            onClick={() => onCopyId(item.id)}
            aria-label={`复制${name}的完整物品 ID`}
          >
            复制 ID
          </BaseButton>
        )}
      </div>
    </div>
  );
}
