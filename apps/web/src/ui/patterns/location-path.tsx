import { Button as BaseButton } from '@base-ui/react/button';
import { ChevronRight } from 'lucide-react';
import type { FactPresentation, ItemView } from './types';
import { cn } from '../components/utils';
import './facts.css';

export interface LocationPathProps {
  /** An item location path, never a catalog/category path. */
  location: ItemView['location'] | null;
  /** Null location alone does not establish that the item is at the root. */
  state?: 'known' | 'root' | 'unknown' | 'redacted';
  onOpen?: (id: NonNullable<ItemView['location']['id']>) => void;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  presentation?: FactPresentation;
  className?: string;
}

export function LocationPath({
  location,
  state = location ? 'known' : 'unknown',
  onOpen,
  disabled = false,
  readOnly = false,
  loading = false,
  presentation = 'summary',
  className,
}: LocationPathProps) {
  const segments = location?.path.length ? location.path : location?.label ? [location.label] : [];
  const unavailableLabel = loading
    ? '正在加载位置…'
    : state === 'redacted'
      ? '位置不可见'
      : state === 'root'
        ? '家庭根位置（未放入容器）'
        : '位置未记录';
  return (
    <div
      className={cn('vn-location-path vn-fact-primary', className)}
      data-presentation={presentation}
    >
      {presentation === 'detail' && <span className="vn-fact-label">存放位置</span>}
      {loading || state !== 'known' || !segments.length ? (
        <span className="vn-fact-meta" role={loading ? 'status' : undefined}>
          {unavailableLabel}
        </span>
      ) : (
        <ol aria-label="物品存放位置路径" className="vn-location-segments">
          {segments.map((segment, depth) => (
            <li key={JSON.stringify(segments.slice(0, depth + 1))}>
              {depth > 0 && (
                <ChevronRight className="vn-location-divider" size={14} aria-hidden="true" />
              )}
              {depth === segments.length - 1 && location?.id && onOpen && !readOnly ? (
                <BaseButton
                  type="button"
                  className="vn-fact-link"
                  disabled={disabled}
                  onClick={() => onOpen(location.id!)}
                  aria-label={`打开存放位置：${segments.join(' / ')}`}
                >
                  {segment}
                </BaseButton>
              ) : (
                <span>{segment}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
