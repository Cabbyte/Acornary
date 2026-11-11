import { ArrowLeftRight, ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../components/ui/button';
import { Popover } from '../components/ui/popover';
import { RadioGroup } from '../components/ui/radio-group';
import { cn } from '../components/utils';
import type { UIMode } from '../theme/provider';
import './navigation.css';

// Composes the existing Base UI RadioGroup and Popover wrappers:
// https://base-ui.com/react/components/radio-group
// https://base-ui.com/react/components/popover
export interface ModeSwitcherProps {
  value: UIMode;
  onValueChange: (value: UIMode) => void;
  layout?: 'inline' | 'compact';
  disabled?: boolean;
  readOnly?: boolean;
  blockedReason?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export const modeLabels: Record<UIMode, string> = { daily: '日常', management: '管理' };

export function ModeSwitcher({
  value,
  onValueChange,
  layout = 'inline',
  disabled = false,
  readOnly = false,
  blockedReason,
  open,
  onOpenChange,
  className,
}: ModeSwitcherProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const reasonId = useId();
  const isOpen = open ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const unavailable = disabled || readOnly || Boolean(blockedReason);
  const choices = (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        if (unavailable || (next !== 'daily' && next !== 'management') || next === value) return;
        onValueChange(next);
        setOpen(false);
      }}
      label="使用模式"
      description={blockedReason}
      disabled={disabled || Boolean(blockedReason)}
      readOnly={readOnly}
      orientation={layout === 'inline' ? 'horizontal' : 'vertical'}
      options={[
        {
          value: 'daily',
          label: '日常',
          description: layout === 'compact' ? '查看物品、留意提醒与动态' : undefined,
        },
        {
          value: 'management',
          label: '管理',
          description: layout === 'compact' ? '整理物品、目录与位置' : undefined,
        },
      ]}
      className="vn-mode-switcher__choices"
    />
  );
  return (
    <div className={cn('vn-mode-switcher', className)} data-layout={layout}>
      {layout === 'inline' ? (
        <>
          <Button
            variant="quiet"
            className="vn-mode-switcher__direct"
            disabled={unavailable}
            aria-label={`当前${modeLabels[value]}模式，切换到${modeLabels[value === 'daily' ? 'management' : 'daily']}模式`}
            aria-describedby={blockedReason ? reasonId : undefined}
            onClick={() => {
              if (!unavailable) onValueChange(value === 'daily' ? 'management' : 'daily');
            }}
          >
            <ArrowLeftRight size={18} aria-hidden="true" />
            <span>{modeLabels[value]}模式</span>
          </Button>
          {blockedReason && (
            <p id={reasonId} className="vn-navigation-reason">
              {blockedReason}
            </p>
          )}
        </>
      ) : (
        <>
          <Popover
            open={isOpen}
            onOpenChange={setOpen}
            disabled={disabled}
            title="切换模式"
            trigger={
              <Button
                variant="secondary"
                className="vn-mode-switcher__trigger"
                aria-describedby={blockedReason ? reasonId : undefined}
              >
                {modeLabels[value]}模式 <ChevronDown size={16} aria-hidden="true" />
              </Button>
            }
          >
            {choices}
          </Popover>
          {blockedReason && (
            <p id={reasonId} className="vn-navigation-reason">
              {blockedReason}
            </p>
          )}
        </>
      )}
    </div>
  );
}
