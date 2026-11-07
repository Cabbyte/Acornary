import { Palette, Plus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { IconButton } from '../components/ui/icon-button';
import { Popover } from '../components/ui/popover';
import { cn } from '../components/utils';
import type { AppearancePreset, UIMode } from '../theme/provider';
import { AppearancePicker } from './appearance-picker';
import { DesktopNavigation, type NavigationLink } from './desktop-navigation';
import { HouseholdSwitcher, type HouseholdOption } from './household-switcher';
import { MobileNavigation } from './mobile-navigation';
import { ModeSwitcher } from './mode-switcher';
import './navigation.css';

export interface AppShellProps {
  mode: UIMode;
  onModeChange: (mode: UIMode) => void;
  preset: AppearancePreset;
  onPresetChange: (preset: AppearancePreset) => void;
  links: readonly NavigationLink[];
  activePath: string;
  onNavigate: (href: string, link: NavigationLink) => void;
  householdId: string | null;
  households: readonly HouseholdOption[];
  onHouseholdSwitchIntent: (householdId: string) => void;
  children: ReactNode;
  title?: string;
  headerActions?: ReactNode;
  recoveredTask?: ReactNode;
  onAdd?: () => void;
  addDisabled?: boolean;
  disabled?: boolean;
  loading?: boolean;
  modeBlockedReason?: string;
  householdBlockedReason?: string;
  householdLoading?: boolean;
  householdError?: string;
  className?: string;
}

/** Theme and all domain state belong to the caller. CSS changes regions, never the child tree. */
export function AppShell({
  mode,
  onModeChange,
  preset,
  onPresetChange,
  links,
  activePath,
  onNavigate,
  householdId,
  households,
  onHouseholdSwitchIntent,
  children,
  title = '家庭物品',
  headerActions,
  recoveredTask,
  onAdd,
  addDisabled,
  disabled,
  loading,
  modeBlockedReason,
  householdBlockedReason,
  householdLoading,
  householdError,
  className,
}: AppShellProps) {
  const mainId = useId();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const navigation = { mode, links, activePath, onNavigate, onAdd, addDisabled, disabled, loading };
  return (
    <div className={cn('vn-app-shell', className)}>
      <a className="vn-app-shell__skip" href={`#${mainId}`}>
        跳到主要内容
      </a>
      <div className="vn-app-shell__layout">
        <aside className="vn-app-shell__sidebar" aria-label="侧边导航">
          <DesktopNavigation
            {...navigation}
            onModeChange={onModeChange}
            modeBlockedReason={modeBlockedReason}
          />
        </aside>
        <header className="vn-app-shell__header">
          <div className="vn-app-shell__compact-mode">
            <ModeSwitcher
              value={mode}
              onValueChange={onModeChange}
              layout="compact"
              disabled={disabled || loading}
              blockedReason={modeBlockedReason}
            />
          </div>
          <HouseholdSwitcher
            value={householdId}
            options={households}
            onSwitchIntent={onHouseholdSwitchIntent}
            disabled={disabled}
            loading={householdLoading}
            error={householdError}
            blockedReason={householdBlockedReason}
          />
          <div className="vn-app-shell__header-actions">
            {headerActions}
            {onAdd && (
              <Button
                className="vn-app-shell__compact-add"
                aria-label="添加物品"
                title="添加物品"
                onClick={onAdd}
                disabled={disabled || loading || addDisabled}
              >
                <Plus size={18} aria-hidden="true" />
                <span className="vn-app-shell__add-label">添加物品</span>
              </Button>
            )}
            <Popover
              open={appearanceOpen}
              onOpenChange={setAppearanceOpen}
              title="界面配色"
              align="end"
              disabled={disabled}
              trigger={
                <IconButton label="选择配色" variant="quiet">
                  <Palette size={18} aria-hidden="true" />
                </IconButton>
              }
            >
              <AppearancePicker
                value={preset}
                mode={mode}
                onValueChange={onPresetChange}
                disabled={disabled}
              />
            </Popover>
          </div>
        </header>
        <main
          id={mainId}
          tabIndex={-1}
          className="vn-app-shell__main"
          aria-label={title}
          aria-busy={loading || undefined}
        >
          {recoveredTask && <div className="vn-app-shell__recovery">{recoveredTask}</div>}
          <div className="vn-app-shell__content">{children}</div>
        </main>
        <div className="vn-app-shell__mobile-navigation">
          <MobileNavigation {...navigation} onAdd={undefined} />
        </div>
      </div>
    </div>
  );
}
