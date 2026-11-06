import Decimal from 'decimal.js';
import { Input } from '../components/ui/input';
import { FormField } from '../components/ui/form-field';
import { Select, type SelectOption } from '../components/ui/select';
import { Button } from '../components/ui/button';
import { QuantityValue } from './quantity-value';
import type { QuantityPresentation } from './types';
import { cn } from '../components/utils';
import './fields.css';

export interface QuantityInputProps {
  value: QuantityPresentation;
  onChange: (value: QuantityPresentation, field: 'value' | 'unit' | 'accuracy' | 'unknown') => void;
  onCommit?: (value: QuantityPresentation) => void;
  units: readonly SelectOption[];
  label?: string;
  minimum?: string;
  maximum?: string;
  mixed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: string;
  className?: string;
}
const decimalPattern = /^\d+(?:\.\d+)?$/;
export function validateQuantityDraft(
  value: QuantityPresentation,
  minimum?: string,
  maximum?: string,
): string | undefined {
  if ((minimum && !decimalPattern.test(minimum)) || (maximum && !decimalPattern.test(maximum)))
    return '数量范围配置无效。';
  if (minimum && maximum && new Decimal(minimum).gt(maximum)) return '数量下限不能大于上限。';
  if (value.value === null || value.value === '')
    return value.accuracy !== 'unknown' ? '数量未记录时，请明确选择“依据未知”。' : undefined;
  if (!decimalPattern.test(value.value))
    return '请输入非负十进制数量；未完成的小数草稿暂不能应用。';
  if (!value.unit) return '请明确选择单位。';
  if (minimum && new Decimal(value.value).lt(minimum)) return `数量不能小于 ${minimum}。`;
  if (maximum && new Decimal(value.value).gt(maximum)) return `数量不能大于 ${maximum}。`;
  return undefined;
}
/** Draft text is preserved verbatim; decimal.js compares bounds without a Number roundtrip. */
export function QuantityInput({
  value,
  onChange,
  onCommit,
  units,
  label = '数量',
  minimum,
  maximum,
  mixed,
  disabled,
  readOnly,
  loading,
  error,
  className,
}: QuantityInputProps) {
  const validation = error || validateQuantityDraft(value, minimum, maximum);
  const unavailable = disabled || loading;
  return (
    <div className={cn('vn-domain-field', className)} aria-busy={loading || undefined}>
      {mixed && <p className="vn-fields-notice">所选物品数量不同。请填写要使用的数量。</p>}
      <div className="vn-fields-columns">
        <FormField
          label={label}
          error={validation}
          hint={mixed ? '数量不同，请明确填写。' : '小数位按输入保留；未记录与 0 不同。'}
        >
          <Input
            type="text"
            inputMode="decimal"
            value={value.value ?? ''}
            disabled={unavailable}
            readOnly={readOnly}
            placeholder={mixed ? '多个值' : '未记录'}
            onChange={(event) => onChange({ ...value, value: event.target.value || null }, 'value')}
          />
        </FormField>
        <Select
          label="单位"
          value={value.unit || null}
          options={units}
          onValueChange={(unit) => onChange({ ...value, unit: unit ?? '' }, 'unit')}
          disabled={unavailable}
          readOnly={readOnly}
          placeholder="单位未记录"
          selectedLabel={value.unit || undefined}
        />
        <Select
          label="数量依据"
          value={value.accuracy}
          options={[
            { value: 'measured', label: '已测量' },
            { value: 'estimated', label: '估计' },
            { value: 'unknown', label: '依据未知' },
          ]}
          onValueChange={(accuracy) => {
            if (accuracy === 'measured' || accuracy === 'estimated' || accuracy === 'unknown')
              onChange({ ...value, accuracy }, 'accuracy');
          }}
          disabled={unavailable}
          readOnly={readOnly}
        />
      </div>
      <div className="vn-row">
        <Button
          variant="quiet"
          disabled={unavailable || readOnly}
          onClick={() => onChange({ ...value, value: null, accuracy: 'unknown' }, 'unknown')}
        >
          标记数量未记录
        </Button>
        {onCommit && (
          <Button
            variant="secondary"
            disabled={unavailable || readOnly || Boolean(validation) || mixed}
            onClick={() => onCommit({ ...value, value: value.value || null })}
          >
            应用数量草稿
          </Button>
        )}
      </div>
      {loading ? (
        <span className="vn-muted" role="status">
          正在读取数量事实…
        </span>
      ) : (
        <QuantityValue quantity={value} label="草稿预览" />
      )}
    </div>
  );
}
