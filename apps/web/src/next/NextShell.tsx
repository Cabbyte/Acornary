import { PreviewNotice } from '../ui/preview-notice';
import { useSession } from '../lib/session';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useInventory } from '../lib/inventory';
import { Icon, type IconName } from '../ui/icons/Icon';
import { ItemsSidebar } from '../features/items/components/ItemsSidebar';
import styles from './NextShell.module.css';

const nav: Array<{ key: string; label: string; to: string; icon: IconName }> = [
  { key: 'items', label: '我的物品', to: '/items', icon: 'archive' },
  { key: 'catalog', label: '商品目录', to: '/catalog', icon: 'library' },
  { key: 'activity', label: '动态', to: '/activity', icon: 'activity' },
  { key: 'settings', label: '设置', to: '/settings', icon: 'settings' },
];

const nextSearch = { ui: 'next' };

export function NextShell({ section, children }: { section: string; children: ReactNode }) {
  const { data } = useInventory();
  const { session } = useSession();
  const active = section === 'places' || section === 'search' ? 'items' : section;
  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        跳到内容
      </a>
      <aside className={styles.sidebar} aria-label="主导航">
        <Link to="/items" search={nextSearch} className={styles.brand}>
          <strong>松仓</strong>
          <small>Acornary</small>
        </Link>
        {session.host === 'mcp' ? (
          <span className={styles.household}>{data.household.name}</span>
        ) : (
          <Link to="/settings/households" search={nextSearch} className={styles.household}>
            {data.household.name}
          </Link>
        )}
        <nav className={styles.nav}>
          {nav.slice(0, 3).map((item) => (
            <Link
              key={item.key}
              to={item.to}
              search={nextSearch}
              className={styles.navItem}
              aria-current={active === item.key ? 'page' : undefined}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </nav>
        <ItemsSidebar show={active === 'items'} />
        <div className={styles.settings}>
          <Link
            to="/settings"
            search={nextSearch}
            className={styles.navItem}
            aria-current={active === 'settings' ? 'page' : undefined}
          >
            <Icon name="settings" size={16} />
            设置
          </Link>
        </div>
      </aside>
      <main id="main" className={styles.main}>
        <PreviewNotice />
        {children}
      </main>
      <nav className={styles.bottomNav} aria-label="底部导航">
        {nav.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            search={nextSearch}
            className={styles.bottomItem}
            aria-current={active === item.key ? 'page' : undefined}
          >
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
