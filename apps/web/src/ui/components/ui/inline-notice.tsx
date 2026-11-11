import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '../utils';
import './overlays.css';

// Semantic alert composition: https://ui.shadcn.com/docs/components/base/alert
export interface InlineNoticeProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  /** Use false for static explanatory text that should not be announced on mount. */
  announce?: boolean;
}
const noticeIcons = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};
export function InlineNotice({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  dismissLabel = '关闭提示',
  className,
  announce = true,
}: InlineNoticeProps) {
  const Icon = noticeIcons[tone];
  return (
    <div
      className={cn('vn-inline-notice', className)}
      data-tone={tone}
      role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <Icon size={18} aria-hidden="true" className="vn-notice-icon" />
      <div className="vn-notice-copy">
        <p className="vn-notice-title">{title}</p>
        {children && <div className="vn-notice-description">{children}</div>}
        {action && <div className="vn-notice-action">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="vn-overlay-close"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
