import type { ComponentProps } from 'react';
import { cn } from '../utils';
import './controls.css';

// Native textarea source pattern: https://ui.shadcn.com/docs/components/base/textarea
export type TextareaProps = ComponentProps<'textarea'> & { invalid?: boolean };

export function Textarea({ className, invalid, rows = 4, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      rows={rows}
      data-slot="textarea"
      aria-invalid={invalid || props['aria-invalid']}
      className={cn('vn-control vn-input vn-textarea', className)}
    />
  );
}
