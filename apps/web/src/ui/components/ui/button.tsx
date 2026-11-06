import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../utils';
import './controls.css';

// Source pattern: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/button.tsx
// Behavior: https://base-ui.com/react/components/button (@base-ui/react 1.9.0).
export const buttonVariants = cva('vn-control vn-button', {
  variants: {
    variant: {
      primary: 'vn-button--primary',
      secondary: 'vn-button--secondary',
      quiet: 'vn-button--quiet',
      danger: 'vn-button--danger',
    },
    size: { default: 'vn-button--default', sm: 'vn-button--sm' },
  },
  defaultVariants: { variant: 'primary', size: 'default' },
});

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { busy?: boolean };

export function Button({
  className,
  variant,
  size,
  busy = false,
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {busy && <span className="vn-control-spinner" aria-hidden="true" />}
      {children}
    </ButtonPrimitive>
  );
}
