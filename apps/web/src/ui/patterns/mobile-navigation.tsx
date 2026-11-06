import { Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../components/utils';
import { NavigationLinkView, linksForMode, type NavigationProps } from './desktop-navigation';
import { modeLabels } from './mode-switcher';
import './navigation.css';

export type MobileNavigationProps = NavigationProps;

export function MobileNavigation({
  mode,
  links,
  activePath,
  onNavigate,
  onAdd,
  addDisabled,
  disabled,
  loading,
  className,
}: MobileNavigationProps) {
  const visible = linksForMode(mode, links);
  return (
    <div className={cn('vn-mobile-navigation', className)}>
      {onAdd && (
        <div className="vn-mobile-navigation__action">
          <Button onClick={onAdd} disabled={disabled || loading || addDisabled}>
            <Plus size={18} aria-hidden="true" />
            添加物品
          </Button>
        </div>
      )}
      <nav
        className="vn-mobile-navigation__links"
        aria-label={`${modeLabels[mode]}模式主导航`}
        aria-busy={loading || undefined}
      >
        {visible.map((link) => (
          <NavigationLinkView
            key={link.id}
            link={link}
            mode={mode}
            activePath={activePath}
            onNavigate={onNavigate}
            disabled={disabled || loading}
          />
        ))}
        {visible.length === 0 && (
          <p className="vn-navigation-reason">{loading ? '正在读取导航…' : '暂无可用导航'}</p>
        )}
      </nav>
    </div>
  );
}
