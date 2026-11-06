import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../utils';
import './controls.css';

// CVA and semantic span pattern: https://ui.shadcn.com/docs/components/base/badge
export const badgeVariants = cva('vn-badge', {
  variants: {
    variant: {
      neutral: 'vn-badge--neutral',
      accent: 'vn-badge--accent',
      success: 'vn-badge--success',
      warning: 'vn-badge--warning',
      danger: 'vn-badge--danger',
      info: 'vn-badge--info',
    },
  },
  defaultVariants: { variant: 'neutral' },
});
export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;
export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span {...props} data-slot="badge" className={cn(badgeVariants({ variant }), className)} />
  );
}
