import { Button as BaseButton } from '@base-ui/react/button';
import type { FactPresentation, FactSourceView } from './types';
import { FactDetails } from './fact-details';
import { cn } from '../components/utils';
import './facts.css';

export interface FactSourceProps {
  source: FactSourceView | null;
  templateName?: string;
  redacted?: boolean;
  unavailableReason?: string;
  loading?: boolean;
  disabled?: boolean;
  presentation?: FactPresentation;
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
  presentation = 'summary',
  onInspect,
  className,
}: FactSourceProps) {
  const details = source && (
    <>
      <span className="vn-fact-source-heading">
        {templateName || '属性模板'}
        <span className="vn-fact-meta">版本 {source.version}</span>
      </span>
      <span className="vn-fact-meta">
        模板 ID：<code>{source.templateId}</code>
      </span>
      <span className="vn-fact-meta">
        字段路径：<code>{source.path}</code>
      </span>
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
  );
  return (
    <div className={cn('vn-fact-source', className)} data-presentation={presentation}>
      {presentation === 'detail' && <span className="vn-fact-label">事实来源</span>}
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
          {presentation === 'summary' ? (
            <FactDetails label="来源详情">{details}</FactDetails>
          ) : (
            details
          )}
        </>
      )}
      {!loading && unavailableReason && <span className="vn-fact-error">{unavailableReason}</span>}
    </div>
  );
}
