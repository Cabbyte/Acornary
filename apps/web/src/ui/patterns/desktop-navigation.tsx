import {
  Bell,
  Boxes,
  FolderTree,
  History,
  MapPin,
  Plus,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { cn } from '../components/utils';
import type { UIMode } from '../theme/provider';
import { ModeSwitcher, modeLabels } from './mode-switcher';
import './navigation.css';

export type NavigationId =
  'items' | 'attention' | 'catalog' | 'locations' | 'activity' | 'settings';
export interface NavigationLink {
  id: NavigationId;
  label: string;
  href: string;
  disabled?: boolean;
  disabledReason?: string;
}
export interface NavigationProps {
  mode: UIMode;
  links: readonly NavigationLink[];
  activePath: string;
  onNavigate: (href: string, link: NavigationLink) => void;
  onAdd?: () => void;
  addDisabled?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}
export interface DesktopNavigationProps extends NavigationProps {
  onModeChange: (mode: UIMode) => void;
  modeBlockedReason?: string;
  header?: ReactNode;
}
const icons: Record<NavigationId, LucideIcon> = {
  items: Boxes,
  attention: Bell,
  catalog: FolderTree,
  locations: MapPin,
  activity: History,
  settings: Settings,
};
const modeNavigationIds: Record<UIMode, readonly NavigationId[]> = {
  daily: ['items', 'attention', 'activity', 'settings'],
  management: ['items', 'catalog', 'locations', 'activity', 'settings'],
};
export function linksForMode(mode: UIMode, links: readonly NavigationLink[]): NavigationLink[] {
  return modeNavigationIds[mode].flatMap((id) => {
    const link = links.find((candidate) => candidate.id === id);
    return link ? [link] : [];
  });
}

export function NavigationLinkView({
  link,
  activePath,
  onNavigate,
  disabled,
  mode,
}: Pick<NavigationProps, 'activePath' | 'onNavigate' | 'disabled' | 'mode'> & {
  link: NavigationLink;
}) {
  const Icon = icons[link.id];
  const unavailable = disabled || link.disabled;
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(link.href, link);
  }
  return (
    <a
      href={unavailable ? undefined : link.href}
      onClick={navigate}
      aria-current={activePath === link.href ? 'page' : undefined}
      aria-disabled={unavailable || undefined}
      aria-label={link.id === 'settings' ? `${link.label}（${modeLabels[mode]}模式）` : undefined}
      tabIndex={unavailable ? -1 : undefined}
      title={unavailable ? link.disabledReason : undefined}
      className="vn-navigation-link"
    >
      <Icon size={18} aria-hidden="true" />
      <span className="vn-navigation-link__copy">
        <span>{link.label}</span>
        {link.disabled && link.disabledReason && (
          <span className="vn-navigation-link__reason">{link.disabledReason}</span>
        )}
      </span>
    </a>
  );
}

export function DesktopNavigation({
  mode,
  links,
  activePath,
  onNavigate,
  onModeChange,
  modeBlockedReason,
  onAdd,
  addDisabled,
  disabled,
  loading,
  header,
  className,
}: DesktopNavigationProps) {
  const visible = linksForMode(mode, links);
  const settings = visible.find((link) => link.id === 'settings');
  const common = { mode, activePath, onNavigate, disabled: disabled || loading };
  return (
    <nav
      className={cn('vn-desktop-navigation', className)}
      aria-label={`${modeLabels[mode]}模式主导航`}
      aria-busy={loading || undefined}
    >
      <div className="vn-desktop-navigation__top">
        {header || <span className="vn-navigation-brand">Acornary</span>}
        <p className="vn-navigation-context">{modeLabels[mode]}模式</p>
        {onAdd && (
          <Button onClick={onAdd} disabled={disabled || loading || addDisabled}>
            <Plus size={18} aria-hidden="true" />
            添加物品
          </Button>
        )}
      </div>
      <div className="vn-desktop-navigation__links">
        {visible
          .filter((link) => link.id !== 'settings')
          .map((link) => (
            <NavigationLinkView key={link.id} link={link} {...common} />
          ))}
        {visible.length === 0 && (
          <p className="vn-navigation-reason">{loading ? '正在读取导航…' : '暂无可用导航'}</p>
        )}
      </div>
      <div className="vn-desktop-navigation__bottom">
        {settings && <NavigationLinkView link={settings} {...common} />}
        <ModeSwitcher
          value={mode}
          onValueChange={onModeChange}
          blockedReason={modeBlockedReason}
          disabled={disabled || loading}
        />
      </div>
    </nav>
  );
}
