import { useRef, useState } from 'react';
import { Search, ScanLine, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { IconButton } from '../components/ui/icon-button';
import { Popover } from '../components/ui/popover';
import { FormField } from '../components/ui/form-field';
import { cn } from '../components/utils';
import './fields.css';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  entity?: 'items' | 'catalog' | 'locations';
  label?: string;
  labelVisibility?: 'visible' | 'sr-only';
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  error?: string;
  scanCapability?: { available: true } | { available: false; reason: string };
  onScan?: () => void;
  className?: string;
}
export function SearchBar({
  value,
  onChange,
  onSearch,
  entity = 'items',
  label,
  labelVisibility = 'sr-only',
  placeholder,
  loading,
  disabled,
  readOnly,
  error,
  scanCapability,
  onScan,
  className,
}: SearchBarProps) {
  const composing = useRef(false);
  const [scanHelpOpen, setScanHelpOpen] = useState(false);
  const entityLabel =
    entity === 'items' ? '物品' : entity === 'catalog' ? '分类和商品' : '位置候选';
  const scanReason =
    scanCapability?.available === false
      ? scanCapability.reason || '当前设备暂不支持扫码。'
      : scanCapability?.available && !onScan
        ? '当前入口尚未提供扫描能力。'
        : undefined;
  return (
    <form
      role="search"
      className={cn('vn-search-bar', className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!composing.current && !disabled && !readOnly && !loading) onSearch(value);
      }}
    >
      <FormField
        label={label ?? `搜索${entityLabel}`}
        labelVisibility={labelVisibility}
        error={error}
      >
        {(props) => (
          <div className="vn-field-inline">
            <Input
              {...props}
              type="search"
              value={value}
              disabled={disabled}
              readOnly={readOnly}
              aria-busy={loading || undefined}
              placeholder={placeholder ?? `输入${entityLabel}名称`}
              onChange={(event) => onChange(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  (composing.current ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229)
                )
                  event.preventDefault();
              }}
            />
            {value && (
              <IconButton
                label="清除搜索"
                disabled={disabled || readOnly}
                onClick={() => onChange('')}
              >
                <X />
              </IconButton>
            )}
            {scanCapability &&
              (scanReason ? (
                <Popover
                  open={scanHelpOpen}
                  onOpenChange={setScanHelpOpen}
                  title="扫码暂不可用"
                  trigger={
                    <IconButton label="扫码暂不可用，查看原因">
                      <ScanLine />
                    </IconButton>
                  }
                >
                  <p className="vn-muted">{scanReason}</p>
                </Popover>
              ) : (
                <IconButton
                  label="扫描编码"
                  disabled={disabled || readOnly || loading}
                  onClick={onScan}
                >
                  <ScanLine />
                </IconButton>
              ))}
            <Button type="submit" aria-label="搜索" busy={loading} disabled={disabled || readOnly}>
              <Search size={16} aria-hidden="true" />
              <span className="vn-search-submit-label">搜索</span>
            </Button>
          </div>
        )}
      </FormField>
      {loading && (
        <span className="vn-muted" role="status">
          正在搜索…
        </span>
      )}
    </form>
  );
}
