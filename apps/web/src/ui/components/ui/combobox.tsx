import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { useId } from 'react';
import { useAcornaryTheme } from '../../theme/provider';
import { cn } from '../utils';
import type { SelectOption, SelectProps } from './select';
import './controls.css';

// Controlled input + external candidate set: https://base-ui.com/react/components/combobox#async-search-single
// Compound wrapper pattern: https://ui.shadcn.com/docs/components/base/combobox
export interface ComboboxProps extends Omit<SelectProps, 'options'> {
  options: readonly SelectOption[];
  query: string;
  onQueryChange: (query: string) => void;
  clearable?: boolean;
}

/** `options` is the caller's current candidate page; this component never expands or filters that scope. */
export function Combobox({
  value,
  onValueChange,
  options,
  label,
  query,
  onQueryChange,
  placeholder = '输入以搜索候选',
  selectedLabel,
  disabled,
  readOnly,
  required,
  loading,
  error,
  hint,
  emptyMessage = '未找到匹配候选',
  clearable = true,
  id,
  name,
  className,
}: ComboboxProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const { portalContainer } = useAcornaryTheme();
  const status = error || (loading ? '正在加载候选…' : hint);
  const getLabel = (candidateValue: string) =>
    options.find((option) => option.value === candidateValue)?.label ??
    (candidateValue === value ? selectedLabel : undefined) ??
    '已选值暂不可用';
  return (
    <div className={cn('vn-form-field', className)}>
      <ComboboxPrimitive.Root<string>
        value={value}
        onValueChange={onValueChange}
        inputValue={query}
        onInputValueChange={onQueryChange}
        items={options.map((option) => option.value)}
        filter={null}
        itemToStringLabel={getLabel}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        name={name}
      >
        <label htmlFor={controlId} className="vn-field-label">
          {label}
          {required && (
            <span className="vn-field-required" aria-label="必填">
              *
            </span>
          )}
          {readOnly && <span className="vn-choice-state">只读</span>}
        </label>
        <ComboboxPrimitive.InputGroup
          className="vn-combobox-group"
          data-invalid={Boolean(error) || undefined}
          data-disabled={disabled || undefined}
        >
          <ComboboxPrimitive.Input
            id={controlId}
            placeholder={placeholder}
            className="vn-control vn-input vn-combobox-input"
            aria-invalid={Boolean(error) || undefined}
            aria-busy={loading || undefined}
            aria-describedby={status ? `${controlId}-status` : undefined}
          />
          {clearable && !readOnly && (value !== null || query !== '') && (
            <ComboboxPrimitive.Clear
              className="vn-control vn-combobox-action"
              aria-label={`清除${label}`}
              disabled={disabled}
            >
              <X size={16} aria-hidden="true" />
            </ComboboxPrimitive.Clear>
          )}
          <ComboboxPrimitive.Trigger
            className="vn-control vn-combobox-action"
            aria-label={`展开${label}候选`}
            disabled={disabled || readOnly}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </ComboboxPrimitive.Trigger>
        </ComboboxPrimitive.InputGroup>
        {portalContainer && (
          <ComboboxPrimitive.Portal container={portalContainer}>
            <ComboboxPrimitive.Positioner sideOffset={4} className="vn-control-positioner">
              <ComboboxPrimitive.Popup className="vn-control-popup">
                <ComboboxPrimitive.Empty className="vn-control-empty">
                  {error || (loading ? '正在加载候选…' : emptyMessage)}
                </ComboboxPrimitive.Empty>
                <ComboboxPrimitive.List className="vn-control-list">
                  {(candidateValue: string) => {
                    const option = options.find((candidate) => candidate.value === candidateValue);
                    if (!option) return null;
                    return (
                      <ComboboxPrimitive.Item
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled || loading || Boolean(error)}
                        className="vn-control-option"
                      >
                        <ComboboxPrimitive.ItemIndicator className="vn-option-indicator">
                          <Check size={16} aria-hidden="true" />
                        </ComboboxPrimitive.ItemIndicator>
                        <span className="vn-option-copy">
                          <span>{option.label}</span>
                          {option.description && (
                            <span className="vn-field-hint">{option.description}</span>
                          )}
                        </span>
                      </ComboboxPrimitive.Item>
                    );
                  }}
                </ComboboxPrimitive.List>
              </ComboboxPrimitive.Popup>
            </ComboboxPrimitive.Positioner>
          </ComboboxPrimitive.Portal>
        )}
      </ComboboxPrimitive.Root>
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
