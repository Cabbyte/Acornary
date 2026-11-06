import type { QuantityPresentation } from './types';
import { cn } from '../components/utils';
import './facts.css';

export interface QuantityValueProps {
  quantity: QuantityPresentation;
  label?: string;
  redacted?: boolean;
  loading?: boolean;
  className?: string;
}

/** Decimal text is never converted to a floating-point number or inferred from SKU size. */
export function QuantityValue({
  quantity,
  label = '数量',
  redacted = false,
  loading = false,
  className,
}: QuantityValueProps) {
  const unknown = quantity.value === null || quantity.value === '';
  const invalid = !unknown && !/^\d+(?:\.\d+)?$/.test(quantity.value!);
  const state = loading
    ? 'loading'
    : redacted
      ? 'redacted'
      : invalid
        ? 'invalid'
        : unknown
          ? 'unknown'
          : quantity.accuracy;
  return (
    <span
      className={cn('vn-quantity-value', className)}
      data-state={state}
      aria-label={label}
      role={loading ? 'status' : undefined}
    >
      <span className="vn-fact-label">{label}</span>
      {loading ? (
        <span className="vn-fact-meta">正在加载…</span>
      ) : redacted ? (
        <span className="vn-fact-meta">数量不可见</span>
      ) : invalid ? (
        <span className="vn-fact-error">数量格式有误</span>
      ) : unknown ? (
        <span className="vn-fact-meta">数量未记录</span>
      ) : (
        <>
          {quantity.accuracy === 'estimated' && <span className="vn-fact-meta">约</span>}
          <span className="vn-quantity-number">{quantity.value}</span>
          <span>{quantity.unit || '单位未记录'}</span>
          {quantity.accuracy === 'unknown' && (
            <span className="vn-fact-badge" data-tone="muted">
              精度未记录
            </span>
          )}
        </>
      )}
    </span>
  );
}
