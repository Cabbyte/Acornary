import { Button as BaseButton } from '@base-ui/react/button';
import type { ReactNode } from 'react';
import type { FactPresentation, ItemView } from './types';
import { FactDetails } from './fact-details';
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
  presentation?: FactPresentation;
  /** A static label distinguishes rows whose surrounding details expose the full ID. */
  showId?: boolean | 'label';
  /** Optional status beside the name; the supplied status also owns the record state. */
  status?: ReactNode;
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
  presentation = 'summary',
  showId = true,
  status,
  className,
}: ItemIdentityProps) {
  if (loading)
    return (
      <span className={cn('vn-item-identity vn-fact-meta', className)} role="status">
        正在加载物品身份…
      </span>
    );
  const name = redacted ? '名称不可见' : item.name || '未命名物品';
  const identity = (
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
  );
  return (
    <div className={cn('vn-item-identity', className)} data-presentation={presentation}>
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
        {!status && item.recordState === 'VOID' && (
          <span className="vn-fact-badge" data-tone="muted">
            已作废
          </span>
        )}
        {status}
      </div>
      {(showId || (!redacted && item.subtitle)) && (
        <div className="vn-item-identity-meta">
          {!redacted && item.subtitle && <span className="vn-fact-meta">{item.subtitle}</span>}
          {showId &&
            (presentation === 'summary' && showId === 'label' ? (
              <span className="vn-fact-meta">编号 …{item.id.slice(-8)}</span>
            ) : presentation === 'summary' ? (
              <FactDetails label={`编号 …${item.id.slice(-8)}`}>{identity}</FactDetails>
            ) : (
              identity
            ))}
        </div>
      )}
    </div>
  );
}
