import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog';
import { X } from 'lucide-react';
import { cn } from '../utils';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// https://base-ui.com/react/components/alert-dialog
// The caller supplies the explicit confirm action; rendering never confirms anything.
export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  trigger?: ReactElement;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  closeBlockedReason?: string;
  onCloseBlocked?: (reason: string) => void;
  closeLabel?: string;
  className?: string;
  initialFocus?: ComponentProps<typeof BaseAlertDialog.Popup>['initialFocus'];
  finalFocus?: ComponentProps<typeof BaseAlertDialog.Popup>['finalFocus'];
}

export function AlertDialog({
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
  closeLabel = '取消并关闭',
  className,
  initialFocus,
  finalFocus,
}: AlertDialogProps) {
  const { portalContainer } = useAcornaryTheme();
  const blockedReason =
    closeBlockedReason || (busy ? '正在处理中，请等待当前步骤完成后再关闭。' : undefined);
  return (
    <BaseAlertDialog.Root
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
      {trigger && <BaseAlertDialog.Trigger render={trigger} />}
      {portalContainer && (
        <BaseAlertDialog.Portal container={portalContainer}>
          <BaseAlertDialog.Backdrop className="vn-overlay-backdrop" />
          <BaseAlertDialog.Viewport className="vn-overlay-viewport">
            <BaseAlertDialog.Popup
              className={cn('vn-dialog', 'vn-alert-dialog', className)}
              aria-busy={busy || undefined}
              initialFocus={initialFocus}
              finalFocus={finalFocus}
            >
              <header className="vn-overlay-header">
                <div className="vn-overlay-heading">
                  <BaseAlertDialog.Title className="vn-overlay-title">
                    {title}
                  </BaseAlertDialog.Title>
                  <BaseAlertDialog.Description className="vn-overlay-description">
                    {description}
                  </BaseAlertDialog.Description>
                </div>
                <BaseAlertDialog.Close
                  type="button"
                  className="vn-overlay-close"
                  aria-label={closeLabel}
                  aria-disabled={!!blockedReason}
                >
                  <X size={18} aria-hidden="true" />
                </BaseAlertDialog.Close>
              </header>
              {(blockedReason || children) && (
                <div className="vn-overlay-body">
                  {blockedReason && (
                    <p className="vn-overlay-guard" role="status">
                      {blockedReason}
                    </p>
                  )}
                  {children}
                </div>
              )}
              {footer && <footer className="vn-overlay-footer">{footer}</footer>}
            </BaseAlertDialog.Popup>
          </BaseAlertDialog.Viewport>
        </BaseAlertDialog.Portal>
      )}
    </BaseAlertDialog.Root>
  );
}

export function AlertDialogClose(props: ComponentProps<typeof BaseAlertDialog.Close>) {
  return <BaseAlertDialog.Close type="button" {...props} />;
}
