import { useId, type ReactElement, type ReactNode } from 'react';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useAcornaryTheme } from '../../theme/provider';
import './overlays.css';

// https://base-ui.com/react/components/menu
export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  tone?: 'default' | 'danger';
  separatorBefore?: boolean;
}
export interface DropdownMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  items: readonly DropdownMenuItem[];
  onSelect: (id: string) => void;
  label?: string;
  disabled?: boolean;
  emptyLabel?: string;
  align?: 'start' | 'center' | 'end';
}
export function DropdownMenu({
  open,
  onOpenChange,
  trigger,
  items,
  onSelect,
  label = '更多操作',
  disabled = false,
  emptyLabel = '当前没有可用操作',
  align = 'end',
}: DropdownMenuProps) {
  const { portalContainer } = useAcornaryTheme();
  const menuId = useId();
  return (
    <BaseMenu.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <BaseMenu.Trigger render={trigger} disabled={disabled} />
      {portalContainer && (
        <BaseMenu.Portal container={portalContainer}>
          <BaseMenu.Positioner sideOffset={8} align={align} className="vn-overlay-positioner">
            <BaseMenu.Popup className="vn-dropdown" aria-label={label}>
              {items.length === 0 && (
                <p className="vn-dropdown-empty" role="status">
                  {emptyLabel}
                </p>
              )}
              {items.map((item) => (
                <div key={item.id} role="presentation">
                  {item.separatorBefore && <BaseMenu.Separator className="vn-dropdown-separator" />}
                  <BaseMenu.Item
                    className="vn-dropdown-item"
                    label={item.label}
                    data-tone={item.tone || 'default'}
                    disabled={item.disabled || !!item.disabledReason}
                    aria-describedby={
                      item.disabledReason || item.description
                        ? `${menuId}-${item.id}-description`
                        : undefined
                    }
                    onClick={() => onSelect(item.id)}
                  >
                    {item.icon && (
                      <span aria-hidden="true" className="vn-dropdown-icon">
                        {item.icon}
                      </span>
                    )}
                    <span className="vn-dropdown-copy">
                      <span>{item.label}</span>
                      {(item.disabledReason || item.description) && (
                        <span
                          id={`${menuId}-${item.id}-description`}
                          className="vn-dropdown-description"
                        >
                          {item.disabledReason || item.description}
                        </span>
                      )}
                    </span>
                  </BaseMenu.Item>
                </div>
              ))}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      )}
    </BaseMenu.Root>
  );
}
