import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useId } from 'react';
import { useAcornaryTheme } from '../../theme/provider';
import { cn } from '../utils';
import './controls.css';

// Parts/keyboard behavior: https://base-ui.com/react/components/select
// Wrapper pattern: https://ui.shadcn.com/docs/components/base/select
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}
export interface SelectProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: readonly SelectOption[];
  label: string;
  placeholder?: string;
  selectedLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  loading?: boolean;
  error?: string;
  hint?: string;
  emptyMessage?: string;
  id?: string;
  name?: string;
  className?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder = '请选择',
  selectedLabel,
  disabled,
  readOnly,
  required,
  loading,
  error,
  hint,
  emptyMessage = '暂无可选项',
  id,
  name,
  className,
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { portalContainer } = useAcornaryTheme();
  const selected = options.find((option) => option.value === value);
  const valueLabel =
    selected?.label ?? selectedLabel ?? (value !== null ? '已选值暂不可用' : undefined);
  const status = error || (loading ? '正在加载候选…' : hint);
  return (
    <div className={cn('vn-form-field', className)}>
      <SelectPrimitive.Root<string>
        id={controlId}
        value={value}
        onValueChange={onValueChange}
        items={options}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        name={name}
      >
        <SelectPrimitive.Label className="vn-field-label">
          {label}
          {required && <span className="vn-field-required">（必填）</span>}
          {readOnly && <span className="vn-choice-state">只读</span>}
        </SelectPrimitive.Label>
        <SelectPrimitive.Trigger
          className="vn-control vn-select-trigger"
          aria-invalid={Boolean(error) || undefined}
          aria-busy={loading || undefined}
          aria-describedby={status ? `${controlId}-status` : undefined}
        >
          <SelectPrimitive.Value placeholder={placeholder} className="vn-select-value">
            {valueLabel}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className="vn-select-icon">
            <ChevronDown size={16} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        {portalContainer && (
          <SelectPrimitive.Portal container={portalContainer}>
            <SelectPrimitive.Positioner
              sideOffset={4}
              alignItemWithTrigger={false}
              className="vn-control-positioner"
            >
              <SelectPrimitive.Popup className="vn-control-popup">
                <SelectPrimitive.ScrollUpArrow className="vn-select-scroll" aria-hidden="true">
                  <ChevronUp size={16} aria-hidden="true" />
                </SelectPrimitive.ScrollUpArrow>
                <SelectPrimitive.List className="vn-control-list">
                  {options.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled || loading || Boolean(error)}
                      className="vn-control-option"
                    >
                      <SelectPrimitive.ItemIndicator className="vn-option-indicator">
                        <Check size={16} aria-hidden="true" />
                      </SelectPrimitive.ItemIndicator>
                      <span className="vn-option-copy">
                        <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                        {option.description && (
                          <span className="vn-field-hint">{option.description}</span>
                        )}
                      </span>
                    </SelectPrimitive.Item>
                  ))}
                  {options.length === 0 && (
                    <div className="vn-control-empty" role="status">
                      {error || (loading ? '正在加载候选…' : emptyMessage)}
                    </div>
                  )}
                </SelectPrimitive.List>
                <SelectPrimitive.ScrollDownArrow className="vn-select-scroll" aria-hidden="true">
                  <ChevronDown size={16} aria-hidden="true" />
                </SelectPrimitive.ScrollDownArrow>
              </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
          </SelectPrimitive.Portal>
        )}
      </SelectPrimitive.Root>
      {status && (
        <span
          id={`${controlId}-status`}
          role={error ? 'alert' : loading ? 'status' : undefined}
          className={cn('vn-field-hint', error && 'vn-field-error')}
        >
          {status}
        </span>
      )}
    </div>
  );
}
