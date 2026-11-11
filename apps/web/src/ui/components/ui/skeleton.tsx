import { cn } from '../utils';
import './overlays.css';

// Decorative loading placeholders: https://ui.shadcn.com/docs/components/base/skeleton
// Skeleton has no data meaning and never represents an unknown value as zero.
export interface SkeletonProps {
  variant?: 'text' | 'row' | 'card';
  lines?: number;
  className?: string;
}
export function Skeleton({ variant = 'text', lines = 3, className }: SkeletonProps) {
  const count = Number.isFinite(lines) ? Math.max(1, Math.min(8, Math.floor(lines))) : 3;
  return (
    <div className={cn('vn-skeleton', `vn-skeleton--${variant}`, className)} aria-hidden="true">
      {variant !== 'text' && <span className="vn-skeleton-shape" />}
      <div className="vn-skeleton-lines">
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className="vn-skeleton-line" />
        ))}
      </div>
    </div>
  );
}
