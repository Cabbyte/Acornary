import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { useId, type ReactNode } from 'react';
import { cn } from '../utils';
import './controls.css';

// Roving keyboard focus and native radio inputs: https://base-ui.com/react/components/radio-group
export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}
export interface RadioGroupProps {
  value: string | null;
  onValueChange: (value: string) => void;
  options: readonly RadioOption[];
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;
  name?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}
export function RadioGroup({
  value,
  onValueChange,
  options,
  label,
  description,
  disabled,
  readOnly,
  required,
  invalid,
  name,
  orientation = 'vertical',
  className,
}: RadioGroupProps) {
  const id = useId();
  return (
    <div className={cn('vn-form-field', className)}>
      <span id={`${id}-label`} className="vn-field-label">
        {label}
        {required && <span className="vn-field-required">（必填）</span>}
        {readOnly && <span className="vn-choice-state">只读</span>}
      </span>
      <RadioGroupPrimitive
        value={value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
        name={name}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-invalid={invalid || undefined}
        aria-orientation={orientation}
        className={cn(
          'vn-radio-group',
          orientation === 'horizontal' && 'vn-radio-group--horizontal',
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className="vn-choice"
            data-disabled={disabled || option.disabled || undefined}
          >
            <Radio.Root value={option.value} disabled={option.disabled} className="vn-radio">
              <Radio.Indicator className="vn-radio-indicator" />
            </Radio.Root>
            <span className="vn-choice-copy">
              <span>{option.label}</span>
              {option.description && <span className="vn-field-hint">{option.description}</span>}
            </span>
          </label>
        ))}
      </RadioGroupPrimitive>
      {description && (
        <span id={`${id}-description`} className={cn('vn-field-hint', invalid && 'vn-field-error')}>
          {description}
        </span>
      )}
    </div>
  );
}
