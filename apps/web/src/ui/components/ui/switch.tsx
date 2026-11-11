import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { useId, type ReactNode } from 'react';
import { cn } from '../utils';
import './controls.css';

// Accessible controlled switch and thumb: https://base-ui.com/react/components/switch
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  className?: string;
}
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  readOnly,
  name,
  id,
  className,
}: SwitchProps) {
  const generatedId = useId();
  const descriptionId = `${id ?? generatedId}-description`;
  return (
    <label
      className={cn('vn-choice', className)}
      data-disabled={disabled || undefined}
      data-readonly={readOnly || undefined}
    >
      <SwitchPrimitive.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        readOnly={readOnly}
        name={name}
        aria-describedby={description ? descriptionId : undefined}
        className="vn-switch"
      >
        <SwitchPrimitive.Thumb className="vn-switch-thumb" />
      </SwitchPrimitive.Root>
      <span className="vn-choice-copy">
        <span>
          {label}
          {readOnly && <span className="vn-choice-state">只读</span>}
        </span>
        {description && (
          <span id={descriptionId} className="vn-field-hint">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
