import { Field } from '@base-ui/react/field';
import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
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
  hint?: ReactNode;
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
  hint,
  error,
  required,
  disabled,
  name,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const childProps = typeof children === 'function' ? undefined : children.props;
  const controlId = id ?? childProps?.id ?? generatedId;
  const describedBy =
    [
      childProps?.['aria-describedby'],
      hint ? `${controlId}-hint` : undefined,
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
      <Field.Label htmlFor={controlId} className="vn-field-label">
        {label}
        {required && <span className="vn-field-required">（必填）</span>}
      </Field.Label>
      {typeof children === 'function' ? children(props) : cloneElement(children, props)}
      {hint && (
        <Field.Description id={`${controlId}-hint`} className="vn-field-hint">
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
