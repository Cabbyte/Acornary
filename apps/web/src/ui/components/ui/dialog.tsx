import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../utils';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// Composition adapted from the official Base UI/shadcn patterns:
// https://base-ui.com/react/components/dialog
// https://ui.shadcn.com/docs/components/base/dialog
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  trigger?: ReactElement;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  closeBlockedReason?: string;
  onCloseBlocked?: (reason: string) => void;
  closeLabel?: string;
  className?: string;
  /** Sheet uses the same mounted dialog and form across viewport sizes. */
  placement?: 'center' | 'edge';
  wide?: boolean;
  initialFocus?: ComponentProps<typeof BaseDialog.Popup>['initialFocus'];
  finalFocus?: ComponentProps<typeof BaseDialog.Popup>['finalFocus'];
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children,
  footer,
  busy = false,
  closeBlockedReason,
  onCloseBlocked,
  closeLabel = '关闭对话框',
  className,
  placement = 'center',
  wide = false,
  initialFocus,
  finalFocus,
}: DialogProps) {
  const { portalContainer } = useAcornaryTheme();
  const blockedReason =
    closeBlockedReason || (busy ? '正在处理中，请等待当前步骤完成后再关闭。' : undefined);
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && blockedReason) {
          details.cancel();
          onCloseBlocked?.(blockedReason);
          return;
        }
        onOpenChange(next);
      }}
    >
      {trigger && <BaseDialog.Trigger render={trigger} />}
      {portalContainer && (
        <BaseDialog.Portal container={portalContainer}>
          <BaseDialog.Backdrop className="vn-overlay-backdrop" />
          <BaseDialog.Viewport
            className={cn(
              'vn-overlay-viewport',
              placement === 'edge' && 'vn-overlay-viewport--sheet',
            )}
          >
            <BaseDialog.Popup
              className={cn(
                'vn-dialog',
                placement === 'edge' && 'vn-sheet',
                wide && 'vn-dialog--wide',
                className,
              )}
              initialFocus={initialFocus}
              finalFocus={finalFocus}
              aria-busy={busy || undefined}
            >
              <header className="vn-overlay-header">
                <div className="vn-overlay-heading">
                  <BaseDialog.Title className="vn-overlay-title">{title}</BaseDialog.Title>
                  {description && (
                    <BaseDialog.Description className="vn-overlay-description">
                      {description}
                    </BaseDialog.Description>
                  )}
                </div>
                <BaseDialog.Close
                  type="button"
                  className="vn-overlay-close"
                  aria-label={closeLabel}
                  aria-disabled={!!blockedReason}
                >
                  <X size={18} aria-hidden="true" />
                </BaseDialog.Close>
              </header>
              <div className="vn-overlay-body">
                {blockedReason && (
                  <p role="status" className="vn-overlay-guard">
                    {blockedReason}
                  </p>
                )}
                {children}
              </div>
              {footer && <footer className="vn-overlay-footer">{footer}</footer>}
            </BaseDialog.Popup>
          </BaseDialog.Viewport>
        </BaseDialog.Portal>
      )}
    </BaseDialog.Root>
  );
}

/** A close intent inside Dialog/Sheet; it passes through the root's close guard. */
export function DialogClose(props: ComponentProps<typeof BaseDialog.Close>) {
  return <BaseDialog.Close type="button" {...props} />;
}
