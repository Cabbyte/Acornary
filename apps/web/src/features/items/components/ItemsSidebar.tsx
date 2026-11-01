import { Link, useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useInventory } from '../../../lib/inventory.js';
import { useInventoryView } from '../../inventory/view.js';
import { isContainer } from '../../../../../../packages/contracts/src/web.js';
import { attentionFor, physicalItems, todayFor } from '../selectors/items.js';
import styles from './ItemsSidebar.module.css';

export function ItemsSidebar({ show }: { show: boolean }) {
  const location = useLocation();
  const { data } = useInventory();
  const view = useInventoryView();
  const params = new URLSearchParams(location.searchStr);
  const attentionOnly = params.get('view') === 'attention';

  const containerIds = useMemo(
    () => new Set(data.items.filter(isContainer).map((item) => item.id)),
    [data.items],
  );
  const items = useMemo(() => physicalItems(view.items, containerIds), [view.items, containerIds]);
  const today = todayFor(data.household.timezone ?? 'Asia/Shanghai');
  const attentionCount = items.filter((item) => attentionFor(item, today)).length;
  const locations = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const item of items) {
      const id = item.location.id;
      if (!id) continue;
      const current = counts.get(id) ?? { label: item.location.label, count: 0 };
      current.count += 1;
      counts.set(id, current);
    }
    return [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  }, [items]);

  if (!show) return null;

  return (
    <div className={styles.side}>
      <div className={styles.section}>
        <p className={styles.label}>视图</p>
        <Link
          to="/items"
          search={{ ui: 'next' }}
          className={styles.view}
          data-active={!attentionOnly ? 'true' : undefined}
        >
          <span>全部物品</span>
          <b>{items.length}</b>
        </Link>
        <Link
          to="/items"
          search={{ ui: 'next', view: 'attention' }}
          className={styles.view}
          data-active={attentionOnly ? 'true' : undefined}
        >
          <span>需留意</span>
          <b>{attentionCount}</b>
        </Link>
      </div>
      <div className={styles.section}>
        <p className={styles.label}>位置</p>
        <Link
          to="/items"
          search={{ ui: 'next' }}
          className={styles.view}
          data-active={location.pathname === '/items' ? 'true' : undefined}
        >
          <span>全部位置</span>
          <b>{items.length}</b>
        </Link>
        {locations.map(([key, entry]) => (
          <Link
            key={key}
            to={`/places/${key}`}
            search={{ ui: 'next' }}
            className={styles.view}
            data-active={
              location.pathname === `/places/${key}` || location.pathname === `/places/${key}/`
                ? 'true'
                : undefined
            }
            title={entry.label}
          >
            <span className={styles.truncate}>{entry.label}</span>
            <b>{entry.count}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}
