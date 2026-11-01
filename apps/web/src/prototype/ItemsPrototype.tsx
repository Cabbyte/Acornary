import { useMemo, useState, type ReactNode } from 'react';
import { useInventory } from '../lib/inventory.js';
import { useInventoryView } from '../features/inventory/view.js';
import { isContainer } from '../../../../packages/contracts/src/web.js';
import styles from './ItemsPrototype.module.css';

type Tone = 'danger' | 'warning' | 'neutral';
type Attention = { label: string; tone: Tone; days?: number } | null;
type Item = ReturnType<typeof useInventoryView>['items'][number];

const CATEGORY_TINTS: Record<string, string> = {
  食品: 'amber',
  饮料: 'amber',
  衣物: 'rose',
  设备: 'blue',
  电子: 'blue',
  日用: 'sage',
  清洁: 'sage',
  其他: 'sand',
};

const catTone = (category: string) =>
  Object.entries(CATEGORY_TINTS).find(([key]) => category.includes(key))?.[1] ?? 'sand';

type IconName =
  | 'apple'
  | 'milk'
  | 'wheat'
  | 'bowl'
  | 'cup'
  | 'shirt'
  | 'plug'
  | 'spray'
  | 'file'
  | 'wrench'
  | 'pill'
  | 'paw'
  | 'package'
  | 'library'
  | 'activity'
  | 'settings'
  | 'plus';

const ICONS: Record<IconName, ReactNode> = {
  apple: (
    <>
      <path d="M12 8c-1.6-1.5-3.4-1.5-5 0-2 2-1.6 6 .8 8.2 1.5 1.4 2.8 1.1 4.2.5 1.4.6 2.7.9 4.2-.5 2.4-2.2 2.8-6.2.8-8.2-1.6-1.5-3.4-1.5-5 0Z" />
      <path d="M12 8c0-2 .8-3.4 2.5-4" />
    </>
  ),
  milk: (
    <>
      <path d="M9 3h6v3l2 3v11H7V9l2-3V3Z" />
      <path d="M7 9h10M10 13h4" />
    </>
  ),
  bowl: (
    <>
      <path d="M4 12h16a8 8 0 0 1-16 0Z" />
      <path d="M9 8c0-1 .5-2 1-3M13 8c0-1 .5-2 1-3" />
    </>
  ),
  wheat: (
    <>
      <path d="M12 20V8" />
      <path d="M12 10c-2 0-3-1-3-3 2 0 3 1 3 3ZM12 10c2 0 3-1 3-3-2 0-3 1-3 3ZM12 15c-2 0-3-1-3-3 2 0 3 1 3 3ZM12 15c2 0 3-1 3-3-2 0-3 1-3 3Z" />
    </>
  ),
  cup: (
    <>
      <path d="M7 5h9l-1 9H8L7 5Z" />
      <path d="m9 14-1 6h8l-1-6M9 9h6" />
    </>
  ),
  shirt: <path d="M8 4 4 5.5 3 9l3 1.5V20h12v-9.5L21 9l-1-3.5L16 4l-4 3-4-3Z" />,
  plug: (
    <>
      <path d="M9 3v6M15 3v6M7 9h10v3a5 5 0 0 1-10 0V9ZM12 17v4" />
    </>
  ),
  spray: (
    <>
      <path d="M8 9h7v11H8z" />
      <path d="M9 9V6h5v3M17 6h2M17 9h2" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  wrench: <path d="M14 4a4 4 0 0 0-4 5L4 15a2 2 0 0 0 3 3l6-6a4 4 0 0 0 5-4l-3 3-3-3 3-3Z" />,
  pill: (
    <>
      <rect x="4" y="9" width="16" height="6" rx="3" />
      <path d="M12 9v6" />
    </>
  ),
  paw: (
    <>
      <circle cx="7" cy="8" r="1.5" />
      <circle cx="12" cy="5.5" r="1.5" />
      <circle cx="17" cy="8" r="1.5" />
      <path d="M7.5 16c0-2.2 2-4 4.5-4s4.5 1.8 4.5 4c0 1.5-1.3 2.3-2.7 2.3-1 0-1.3-.4-1.8-.4s-.8.4-1.8.4C8.8 18.3 7.5 17.5 7.5 16Z" />
    </>
  ),
  package: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="M4 7v10l8 4 8-4V7M12 11v10" />
    </>
  ),
  library: (
    <>
      <path d="M5 4h4v16H5zM11 4h4v16h-4zM17 5l3 1-3 14-3-1z" />
    </>
  ),
  activity: <path d="M4 12h4l2-6 4 12 2-6h4" />,
  settings: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, IconName> = {
  食品: 'apple',
  饮料: 'cup',
  衣物: 'shirt',
  设备: 'plug',
  电子: 'plug',
  日用: 'spray',
  清洁: 'spray',
  文件: 'file',
  工具: 'wrench',
  药品: 'pill',
  宠物: 'paw',
  其他: 'package',
};

function iconFor(name: string, product: string, category: string): IconName {
  const text = `${name} ${product}`;
  if (/奶|牛奶|乳/.test(text)) return 'milk';
  if (/米|大米|粮|面/.test(text)) return 'bowl';
  if (/咖啡|茶|饮料|果汁/.test(text)) return 'cup';
  if (/洗|清洁|洗衣|消毒/.test(text)) return 'spray';
  if (/衣|T恤|裤|裙|袜|帽/.test(text)) return 'shirt';
  if (/USB|线|扩展坞|电脑|相机|耳机|充电/.test(text)) return 'plug';
  if (/药|胶囊|片剂/.test(text)) return 'pill';
  if (/文件|证件|票据|合同/.test(text)) return 'file';
  if (/工具|螺丝|锤|钳/.test(text)) return 'wrench';
  if (/猫|狗|宠物/.test(text)) return 'paw';
  return CATEGORY_ICONS[category] ?? 'package';
}

const dateParts = (value: string | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

function todayFor(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function attentionFor(item: Item, today: string): Attention {
  if (item.recordState === 'VOID') return { label: '已作废', tone: 'danger' };
  const expiry = item.facts.find((fact) => fact.kind === 'expiry')?.value;
  const due = dateParts(expiry);
  const now = dateParts(today);
  if (due !== null && now !== null) {
    const days = Math.round((due - now) / 86_400_000);
    if (days < 0) return { label: `已过期 ${Math.abs(days)} 天`, tone: 'danger', days };
    if (days <= 7)
      return { label: days === 0 ? '今天到期' : `临期 ${days} 天`, tone: 'warning', days };
  }
  if (item.status.label !== '在库' && item.status.label !== '可用') {
    const tone: Tone =
      item.status.tone === 'danger' || item.status.tone === 'warning'
        ? item.status.tone
        : 'neutral';
    return { label: item.status.label, tone };
  }
  return null;
}

function categoryPath(
  item: Item,
  catalog: Map<string, { id: string; parentId: string | null; name: string }>,
) {
  const names: string[] = [];
  const seen = new Set<string>();
  let cursor = catalog.get(item.skuId)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = catalog.get(cursor);
    if (!node) break;
    names.unshift(node.name);
    cursor = node.parentId;
  }
  return names.length ? names : ['其他'];
}

const monthDay = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value);

export default function ItemsPrototype() {
  const { data } = useInventory();
  const view = useInventoryView();
  const [query, setQuery] = useState('');
  const [viewFilter, setViewFilter] = useState<'all' | 'attention'>('all');
  const [location, setLocation] = useState<string | null>(null);
  const [sort, setSort] = useState<'attention' | 'name'>('attention');

  const today = todayFor(data.household.timezone ?? 'Asia/Shanghai');
  const catalog = useMemo(
    () => new Map(view.catalog.map((node) => [node.id, node])),
    [view.catalog],
  );
  const excluded = useMemo(
    () => new Set(data.items.filter(isContainer).map((item) => item.id)),
    [data.items],
  );
  const items = useMemo(
    () => view.items.filter((item) => !excluded.has(item.id)),
    [view.items, excluded],
  );
  const enriched = useMemo(
    () =>
      items.map((item) => {
        const category = categoryPath(item, catalog)[0] ?? '其他';
        const attention = attentionFor(item, today);
        const product = catalog.get(item.skuId)?.name ?? item.name;
        const remaining = item.facts.find((fact) => fact.kind === 'remaining')?.value;
        const expiry = item.facts.find((fact) => fact.kind === 'expiry')?.value;
        return { item, category, attention, product, remaining, expiry };
      }),
    [items, catalog, today],
  );
  const positions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of enriched) {
      const label = entry.item.location.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [enriched]);

  const attentionCount = enriched.filter((entry) => entry.attention).length;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN');
    return enriched
      .filter((entry) => (viewFilter === 'attention' ? !!entry.attention : true))
      .filter((entry) => (location ? entry.item.location.label === location : true))
      .filter((entry) =>
        needle
          ? [entry.item.name, entry.product, entry.item.location.label, entry.category]
              .join(' ')
              .toLocaleLowerCase('zh-CN')
              .includes(needle)
          : true,
      )
      .sort((a, b) => {
        if (sort === 'attention') {
          const rank = (x: Attention) => (x?.tone === 'danger' ? 0 : x?.tone === 'warning' ? 1 : 2);
          const diff = rank(a.attention) - rank(b.attention);
          if (diff) return diff;
          if (a.attention?.days !== undefined && b.attention?.days !== undefined) {
            const days = a.attention.days - b.attention.days;
            if (days) return days;
          }
        }
        return a.item.name.localeCompare(b.item.name, 'zh-CN');
      });
  }, [enriched, query, viewFilter, location, sort]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const entry of filtered)
      map.set(entry.category, [...(map.get(entry.category) ?? []), entry]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const productCount = new Set(items.map((item) => item.skuId)).size;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <strong>松仓</strong>
          <span>Acornary</span>
        </div>
        <nav className={styles.nav} aria-label="主导航">
          <span className={styles.navActive}>
            <Icon name="package" size={16} />
            我的物品
          </span>
          <span>
            <Icon name="library" size={16} />
            商品目录
          </span>
          <span>
            <Icon name="activity" size={16} />
            动态
          </span>
        </nav>
        <div className={styles.sideSection}>
          <p className={styles.eyebrow}>视图</p>
          <button
            className={styles.viewButton}
            data-active={viewFilter === 'all'}
            onClick={() => setViewFilter('all')}
          >
            <span>全部物品</span>
            <b>{items.length}</b>
          </button>
          <button
            className={styles.viewButton}
            data-active={viewFilter === 'attention'}
            onClick={() => setViewFilter('attention')}
          >
            <span>需留意</span>
            <b>{attentionCount}</b>
          </button>
        </div>
        <div className={styles.sideSection}>
          <p className={styles.eyebrow}>位置</p>
          <button
            className={styles.viewButton}
            data-active={!location}
            onClick={() => setLocation(null)}
          >
            <span>全部位置</span>
            <b>{items.length}</b>
          </button>
          {positions.map(([label, count]) => (
            <button
              key={label}
              className={styles.viewButton}
              data-active={location === label}
              onClick={() => setLocation(location === label ? null : label)}
              title={label}
            >
              <span className={styles.truncate}>{label}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>
        <div className={styles.sideBottom}>
          <Icon name="settings" size={16} />
          设置
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1>我的物品</h1>
            <p>
              {filtered.length} 件 · {productCount} 种商品
              {attentionCount > 0 && (
                <>
                  {' · '}
                  <span className={styles.attention}>{attentionCount} 件需留意</span>
                </>
              )}
            </p>
          </div>
          <button className={styles.add} type="button">
            <Icon name="plus" size={15} />
            添加物品
          </button>
        </header>

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="9" cy="9" r="5.5" />
              <path d="m13.2 13.2 3.3 3.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索物品、品牌或规格"
              aria-label="搜索物品"
            />
          </label>
          <button
            className={styles.filter}
            type="button"
            data-active={viewFilter === 'attention'}
            onClick={() =>
              setViewFilter((current) => (current === 'attention' ? 'all' : 'attention'))
            }
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M3 5h14M6 10h8M8 15h4" />
            </svg>
            需留意
            {attentionCount > 0 && <b>{attentionCount}</b>}
          </button>
          <button
            className={styles.filter}
            type="button"
            onClick={() => setSort((current) => (current === 'attention' ? 'name' : 'attention'))}
          >
            {sort === 'attention' ? '按关注度' : '按名称'}
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m6 8 4-4 4 4M6 12l4 4 4-4" />
            </svg>
          </button>
        </div>

        <div className={styles.ledger}>
          <div className={styles.columns} aria-hidden="true">
            <span />
            <span>物品</span>
            <span>位置</span>
            <span>关键信息</span>
            <span>状态</span>
            <span />
          </div>
          {groups.length === 0 ? (
            <div className={styles.empty}>
              <strong>没有匹配的物品</strong>
              <p>清除筛选，或换一个关键词。</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setViewFilter('all');
                  setLocation(null);
                }}
              >
                清除筛选
              </button>
            </div>
          ) : (
            groups.map(([category, entries]) => (
              <section key={category} className={styles.section}>
                <div className={styles.sectionHead}>
                  <span>{category}</span>
                  <span>{entries.length} 件</span>
                </div>
                {entries.map(({ item, attention, product, remaining, expiry }) => (
                  <div className={styles.row} key={item.id}>
                    <span className={styles.glyph} data-tint={catTone(category)}>
                      <Icon name={iconFor(item.name, product, category)} size={18} />
                    </span>
                    <span className={styles.itemName}>
                      <strong>{item.name}</strong>
                      {product && product !== item.name && <small>{product}</small>}
                    </span>
                    <span className={styles.location}>{item.location.label}</span>
                    <span className={styles.facts}>
                      {expiry && (
                        <span>
                          {attention?.tone === 'danger' ? '到期' : '到期'} {monthDay(expiry)}
                        </span>
                      )}
                      {remaining && <span>{remaining}</span>}
                      {!expiry && !remaining && <span className={styles.muted}>—</span>}
                    </span>
                    <span className={styles.status}>
                      {attention ? (
                        <span className={styles.badge} data-tone={attention.tone}>
                          <i aria-hidden="true" />
                          {attention.label}
                        </span>
                      ) : (
                        <span className={styles.quietStatus}>在库</span>
                      )}
                    </span>
                    <button
                      className={styles.more}
                      type="button"
                      aria-label={`${item.name} 的更多操作`}
                    >
                      ⋯
                    </button>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>

        <footer className={styles.footer}>
          <span>共 {items.length} 件 · 演示数据</span>
          <span>家庭时区 {data.household.timezone ?? 'Asia/Shanghai'}</span>
        </footer>
      </main>
    </div>
  );
}
