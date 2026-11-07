import { cva, type VariantProps } from 'class-variance-authority';
import { Children, type ComponentProps, type ReactNode } from 'react';
import { Tag, Check, CircleCheck, TriangleAlert, CircleAlert, Info } from 'lucide-react';
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
export type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    icon?: ReactNode;
    compact?: 'auto' | 'never';
  };
const icons = {
  neutral: Tag,
  accent: Check,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
};
export function Badge({
  className,
  variant = 'neutral',
  children,
  icon,
  compact = 'auto',
  ...props
}: BadgeProps) {
  const Icon = icons[variant || 'neutral'];
  const label = Children.toArray(children)
    .filter((v) => typeof v === 'string' || typeof v === 'number')
    .join('');
  return (
    <span
      title={label || undefined}
      {...props}
      data-slot="badge"
      data-compact={compact}
      className={cn(badgeVariants({ variant }), className)}
    >
      <span className="vn-badge-icon" aria-hidden="true">
        {icon ?? <Icon size={14} />}
      </span>
      <span className="vn-badge-label">{children}</span>
    </span>
  );
}
