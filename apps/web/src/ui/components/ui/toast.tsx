import { useEffect, useId, type ReactElement, type ReactNode } from 'react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { X } from 'lucide-react';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// https://base-ui.com/react/components/toast
// Base UI supplies announcements and focus management. The owner controls lifetime;
// automatic dismissal and swipe dismissal are disabled to keep open authoritative.
export interface ToastProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  action?: ReactElement;
  closeLabel?: string;
}
export function Toast(props: ToastProps) {
  return (
    <BaseToast.Provider timeout={0} limit={1}>
      <ControlledToast {...props} />
    </BaseToast.Provider>
  );
}

function ControlledToast({
  open,
  onOpenChange,
  title,
  description,
  tone = 'info',
  action,
  closeLabel = '关闭通知',
}: ToastProps) {
  const { portalContainer } = useAcornaryTheme();
  const id = useId();
  const { toasts, add, close } = BaseToast.useToastManager();
  useEffect(() => {
    if (open)
      add({
        id,
        title,
        description,
        type: tone,
        priority: tone === 'danger' ? 'high' : 'low',
        timeout: 0,
      });
    else close(id);
  }, [open, id, title, description, tone, add, close]);
  return (
    portalContainer && (
      <BaseToast.Portal container={portalContainer}>
        <BaseToast.Viewport className="vn-toast-viewport" aria-label="辅助通知">
          {toasts.map((toast) => (
            <BaseToast.Root
              key={toast.id}
              toast={toast}
              className="vn-toast"
              data-tone={tone}
              swipeDirection={[]}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventBaseUIHandler();
                  onOpenChange(false);
                }
              }}
            >
              <BaseToast.Content className="vn-toast-content">
                <div className="vn-toast-copy">
                  <BaseToast.Title className="vn-toast-title" />
                  {description && <BaseToast.Description className="vn-toast-description" />}
                  {action && <BaseToast.Action render={action} />}
                </div>
                <BaseToast.Close
                  type="button"
                  className="vn-overlay-close"
                  aria-label={closeLabel}
                  onClick={(event) => {
                    event.preventBaseUIHandler();
                    onOpenChange(false);
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </BaseToast.Close>
              </BaseToast.Content>
            </BaseToast.Root>
          ))}
        </BaseToast.Viewport>
      </BaseToast.Portal>
    )
  );
}
