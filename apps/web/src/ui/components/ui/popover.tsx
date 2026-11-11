import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Popover as BasePopover } from '@base-ui/react/popover';
import { X } from 'lucide-react';
import { cn } from '../utils';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// https://base-ui.com/react/components/popover
export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  side?: ComponentProps<typeof BasePopover.Positioner>['side'];
  align?: ComponentProps<typeof BasePopover.Positioner>['align'];
}
export function Popover({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  disabled = false,
  className,
  side = 'bottom',
  align = 'start',
}: PopoverProps) {
  const { portalContainer } = useAcornaryTheme();
  return (
    <BasePopover.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} disabled={disabled} />
      {portalContainer && (
        <BasePopover.Portal container={portalContainer}>
          <BasePopover.Positioner
            side={side}
            align={align}
            sideOffset={8}
            className="vn-overlay-positioner"
          >
            <BasePopover.Popup className={cn('vn-popover', className)}>
              <header className="vn-overlay-header">
                <div className="vn-overlay-heading">
                  <BasePopover.Title className="vn-popover-title">{title}</BasePopover.Title>
                  {description && (
                    <BasePopover.Description className="vn-overlay-description">
                      {description}
                    </BasePopover.Description>
                  )}
                </div>
                <BasePopover.Close
                  type="button"
                  className="vn-overlay-close"
                  aria-label="关闭补充说明"
                >
                  <X size={16} aria-hidden="true" />
                </BasePopover.Close>
              </header>
              {children && <div className="vn-overlay-body">{children}</div>}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      )}
    </BasePopover.Root>
  );
}
