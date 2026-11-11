import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../utils';
import './controls.css';

// Wrapping label + indicator source pattern: https://base-ui.com/react/components/checkbox
export interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
}
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  readOnly,
  invalid,
  required,
  id,
  name,
  className,
}: CheckboxProps) {
  const generatedId = useId();
  const descriptionId = `${id ?? generatedId}-description`;
  return (
    <label
      className={cn('vn-choice', className)}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
    >
      <CheckboxPrimitive.Root
        id={id}
        name={name}
        checked={checked === true}
        indeterminate={checked === 'indeterminate'}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={description ? descriptionId : undefined}
        className="vn-checkbox"
      >
        <CheckboxPrimitive.Indicator className="vn-choice-indicator">
          {checked === 'indeterminate' ? (
            <Minus size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="vn-choice-copy">
        <span>
          {label}
          {readOnly && <span className="vn-choice-state">只读</span>}
        </span>
        {description && (
          <span id={descriptionId} className={cn('vn-field-hint', invalid && 'vn-field-error')}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
