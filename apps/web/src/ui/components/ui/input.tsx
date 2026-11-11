import { Input as InputPrimitive } from '@base-ui/react/input';
import type { ComponentProps } from 'react';
import { cn } from '../utils';
import './controls.css';

// Source pattern: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/input.tsx
export type InputProps = ComponentProps<'input'> & { invalid?: boolean };

export function Input({ className, invalid, type = 'text', ...props }: InputProps) {
  return (
    <InputPrimitive
      {...props}
      type={type}
      data-slot="input"
      aria-invalid={invalid || props['aria-invalid']}
      className={cn('vn-control vn-input', className)}
    />
  );
}
