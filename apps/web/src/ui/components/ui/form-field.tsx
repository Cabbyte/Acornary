import { Field } from '@base-ui/react/field';
import { CircleHelp } from 'lucide-react';
import { cloneElement, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../utils';
import './controls.css';

// Field parts and explicit native-control association: https://base-ui.com/react/components/field
export interface FormFieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
  disabled?: boolean;
}
export interface FormFieldProps {
  id?: string;
  label: ReactNode;
  labelVisibility?: 'visible' | 'sr-only';
  hint?: ReactNode;
  /** Blocking context belongs in an error or an explicitly visible hint. */
  hintMode?: 'disclosure' | 'visible';
  hintLabel?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  name?: string;
  className?: string;
  children: ReactElement<FormFieldControlProps> | ((props: FormFieldControlProps) => ReactNode);
}

export function FormField({
  id,
  label,
  labelVisibility = 'visible',
  hint,
  hintMode = 'disclosure',
  hintLabel,
  error,
  required,
  disabled,
  name,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const [hintOpen, setHintOpen] = useState(false);
  const childProps = typeof children === 'function' ? undefined : children.props;
  const controlId = id ?? childProps?.id ?? generatedId;
  const showHint = hintMode === 'visible' || hintOpen;
  const describedBy =
    [
      childProps?.['aria-describedby'],
      hint && showHint ? `${controlId}-hint` : undefined,
      error ? `${controlId}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const props: FormFieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : childProps?.['aria-invalid'],
    required: required ?? childProps?.required,
    disabled: disabled ?? childProps?.disabled,
  };
  return (
    <Field.Root
      name={name}
      disabled={disabled}
      invalid={Boolean(error)}
      className={cn('vn-form-field', className)}
    >
      <div
        className={cn(
          'vn-field-heading',
          labelVisibility === 'sr-only' &&
            !(hint && hintMode === 'disclosure') &&
            'vn-field-heading--hidden',
        )}
      >
        <Field.Label
          htmlFor={controlId}
          className={cn(
            'vn-field-label',
            labelVisibility === 'sr-only' && 'vn-field-label--hidden',
          )}
        >
          {label}
          {required && <span className="vn-field-required">（必填）</span>}
        </Field.Label>
        {hint && hintMode === 'disclosure' && (
          <button
            type="button"
            className="vn-field-help-toggle"
            aria-label={typeof label === 'string' ? `${label}说明` : '字段说明'}
            aria-expanded={hintOpen}
            aria-controls={`${controlId}-hint`}
            onClick={() => setHintOpen((open) => !open)}
          >
            <CircleHelp size={16} aria-hidden="true" />
            {hintLabel}
          </button>
        )}
      </div>
      {typeof children === 'function' ? children(props) : cloneElement(children, props)}
      {hint && (
        <Field.Description id={`${controlId}-hint`} className="vn-field-hint" hidden={!showHint}>
          {hint}
        </Field.Description>
      )}
      {error && (
        <Field.Error match id={`${controlId}-error`} className="vn-field-error" role="alert">
          {error}
        </Field.Error>
      )}
    </Field.Root>
  );
}
