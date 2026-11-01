import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import styles from './Field.module.css';

interface FieldControlProps {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-label'?: string;
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** A single form control. Field wires id and aria-describedby; it owns no value. */
  children: ReactElement<FieldControlProps>;
  className?: string;
  id?: string;
}

/**
 * Label + hint + error wrapper. It only annotates the child control's id and
 * ARIA attributes; values, validation, and state belong to the caller.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  children,
  className,
  id,
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const controlId = children.props.id ?? fieldId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const existingDescribedBy = children.props['aria-describedby'];
  const control = cloneElement(children, {
    id: controlId,
    ...(typeof label === 'string' ? { 'aria-label': children.props['aria-label'] ?? label } : {}),
    ...(describedBy
      ? {
          'aria-describedby': existingDescribedBy
            ? `${existingDescribedBy} ${describedBy}`
            : describedBy,
        }
      : {}),
    ...(error ? { 'aria-invalid': true } : {}),
    ...(required ? { 'aria-required': true, required: true } : {}),
  });

  return (
    <div
      className={[styles.field, className].filter(Boolean).join(' ')}
      data-invalid={error ? 'true' : undefined}
    >
      <label className={styles.label} htmlFor={controlId}>
        {label}
        {required && (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className={styles.control}>{control}</div>
      {hint && (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
