import { Button as BaseButton } from '@base-ui/react/button';
import type { FactSourceView } from './types';
import { cn } from '../components/utils';
import './facts.css';

export interface FactSourceProps {
  source: FactSourceView | null;
  templateName?: string;
  redacted?: boolean;
  unavailableReason?: string;
  loading?: boolean;
  disabled?: boolean;
  onInspect?: (source: FactSourceView) => void;
  className?: string;
}

export function FactSource({
  source,
  templateName,
  redacted = false,
  unavailableReason,
  loading = false,
  disabled = false,
  onInspect,
  className,
}: FactSourceProps) {
  return (
    <div className={cn('vn-fact-source', className)}>
      <span className="vn-fact-label">事实来源</span>
      {loading ? (
        <span role="status" className="vn-fact-meta">
          正在加载来源…
        </span>
      ) : redacted ? (
        <span className="vn-fact-meta">来源不可见</span>
      ) : !source ? (
        <span className="vn-fact-meta">来源未记录</span>
      ) : (
        <>
          <span className="vn-fact-source-heading">
            {templateName || '属性模板'}
            <span className="vn-fact-badge" data-tone="muted">
              版本 {source.version}
            </span>
          </span>
          <span className="vn-fact-meta">
            模板 ID：<code>{source.templateId}</code>
          </span>
          <span className="vn-fact-meta">
            字段路径：<code>{source.path}</code>
          </span>
          {unavailableReason && <span className="vn-fact-meta">{unavailableReason}</span>}
          {onInspect && (
            <BaseButton
              type="button"
              className="vn-fact-button"
              disabled={disabled || Boolean(unavailableReason)}
              onClick={() => onInspect(source)}
            >
              查看来源
            </BaseButton>
          )}
        </>
      )}
    </div>
  );
}
