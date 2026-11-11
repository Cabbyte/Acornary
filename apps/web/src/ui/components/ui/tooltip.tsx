import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// https://base-ui.com/react/components/tooltip
// Supplementary, non-interactive content only. Essential facts belong in the page.
export interface TooltipProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  disabled?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
}
export function Tooltip({
  open,
  onOpenChange,
  trigger,
  children,
  disabled = false,
  side = 'top',
}: TooltipProps) {
  const { portalContainer } = useAcornaryTheme();
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root open={open && !disabled} onOpenChange={onOpenChange} disabled={disabled}>
        <BaseTooltip.Trigger render={trigger} />
        {portalContainer && (
          <BaseTooltip.Portal container={portalContainer}>
            <BaseTooltip.Positioner side={side} sideOffset={8} className="vn-overlay-positioner">
              <BaseTooltip.Popup className="vn-tooltip">{children}</BaseTooltip.Popup>
            </BaseTooltip.Positioner>
          </BaseTooltip.Portal>
        )}
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
