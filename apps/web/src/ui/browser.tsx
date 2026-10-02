import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import {
  ancestors,
  attr,
  isContainer,
  isTerminal,
  itemName,
  type ItemRecord,
} from '../../../../packages/contracts/src/web';
import { useInventory } from '../lib/inventory';
import { useSession } from '../lib/session';
import {
  categoryPath,
  fullPath,
  PAGE_SIZE,
  physicalItems,
  searchInventory,
  specification,
  visibleProducts,
} from '../lib/browse';
import { remaining } from '../lib/presentation';
import { Button, Empty } from './components';
import type { Action } from './forms';

type BrowseState = {
  query: string;
  scope: string;
  state: string;
  category: string;
  limit: number;
  scroll: number;
};
const views = new Map<string, BrowseState>();
export function useBrowseState(view: string, scope = '') {
  const { session } = useSession();
  const key = `${session.cache_key}:${view}`;
  const defaults = (): BrowseState =>
    views.get(key) ?? {
      query: '',
      scope,
      state: 'current',
      category: '',
      limit: PAGE_SIZE,
      scroll: 0,
    };
  const [state, setState] = useState(defaults);
  const current = useRef(state);
  current.current = state;
  useLayoutEffect(() => {
    const saved = defaults();
    setState(saved);
    const frame = requestAnimationFrame(() => window.scrollTo(0, saved.scroll));
    const scroll = () => {
      current.current = { ...current.current, scroll: window.scrollY };
      views.set(key, current.current);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      views.set(key, current.current);
    };
  }, [key]);
  const update = (patch: Partial<BrowseState>) =>
    setState((old) => {
      const next = { ...old, limit: PAGE_SIZE, ...patch };
      views.set(key, next);
      return next;
    });
  return [state, update] as const;
}
export function SearchField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="soft-search">
      <img src="/design/soft-search.svg" alt="" width="20" height="20" />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" aria-label="清除搜索" onClick={() => onChange('')}>
          <img src="/design/soft-clear.svg" alt="" width="16" height="16" />
        </button>
      )}
    </div>
  );
}
export function LocationPath({ id }: { id: string | null }) {
  const { data } = useInventory();
  return (
    <nav className="location-path" aria-label="完整位置路径">
      <Link to="/items">全部位置</Link>
      {ancestors(id, data.items).map((p) => (
        <span key={p.id}>
          <span aria-hidden="true"> / </span>
          <Link to={`/places/${p.id}`}>{itemName(p, data)}</Link>
        </span>
      ))}
    </nav>
  );
}
export function PageEnd({
  shown,
  total,
  onMore,
  unit = '条',
}: {
  shown: number;
  total: number;
  onMore: () => void;
  unit?: string;
}) {
  return (
    <footer className="page-end">
      <span role="status">{total ? `显示 1–${shown} / ${total} ${unit}` : `0 ${unit}`}</span>
      {shown < total && (
        <Button variant="secondary" onClick={onMore}>
          加载更多
        </Button>
      )}
    </footer>
  );
}
export function PhysicalRow({ item, path = false }: { item: ItemRecord; path?: boolean }) {
  const { data } = useInventory();
  const location = useLocation();
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  const container = isContainer(item);
  return (
    <Link
      className="soft-row"
      to={container ? `/places/${item.id}` : `/items/${item.id}/details`}
      search={{ returnTo: location.pathname + location.searchStr }}
    >
      <span className="soft-row-copy">
        <strong>{itemName(item, data)}</strong>
        <span>{container ? '位置' : specification(sku) || '规格未记录'}</span>
        {path && <span>{item.parent_id ? fullPath(item.parent_id, data) : '位置未记录'}</span>}
        <small className="item-identity">{container ? '' : `实物 ${item.id}`}</small>
      </span>
      <span className="soft-row-detail">
        {container
          ? `${physicalItems(data.items.filter((i) => i.parent_id === item.id && !isTerminal(i))).length} 件实物`
          : isTerminal(item)
            ? '历史记录'
            : path
              ? remaining(item)
              : '1 件'}
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
function LocationTree({ id }: { id?: string }) {
  const { data } = useInventory();
  const [query, setQuery] = useState('');
  const active = ancestors(id ?? null, data.items).map((p) => p.id);
  const [expanded, setExpanded] = useState<string[]>([]);
  const locations = data.items.filter(isContainer);
  const matches = query
    ? locations.filter((p) =>
        fullPath(p.id, data).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
    : locations.filter((p) =>
        ancestors(p.parent_id, data.items).every(
          (a) => active.includes(a.id) || expanded.includes(a.id),
        ),
      );
  return (
    <aside className="location-tree soft-panel">
      <SearchField value={query} onChange={setQuery} label="搜索位置" />
      <Link className="tree-root" to="/items">
        全部位置
      </Link>
      {matches.map((p) => (
        <div
          className={`tree-node ${p.id === id ? 'selected' : ''}`}
          key={p.id}
          style={{
            paddingInlineStart: query
              ? 0
              : Math.min(ancestors(p.id, data.items).length - 1, 4) * 12,
          }}
        >
          <button
            type="button"
            aria-label={`${expanded.includes(p.id) ? '收起' : '展开'} ${itemName(p, data)}`}
            aria-expanded={expanded.includes(p.id) || active.includes(p.id)}
            onClick={() =>
              setExpanded((old) =>
                old.includes(p.id) ? old.filter((v) => v !== p.id) : [...old, p.id],
              )
            }
          >
            {expanded.includes(p.id) || active.includes(p.id) ? '⌄' : '›'}
          </button>
          <Link to={`/places/${p.id}`} aria-current={p.id === id ? 'page' : undefined}>
            {query ? fullPath(p.id, data) : itemName(p, data)}
          </Link>
        </div>
      ))}
    </aside>
  );
}
export function InventoryBrowser({ id, open }: { id?: string; open: (action: Action) => void }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const [view, update] = useBrowseState(`locations:${id ?? ''}`, id);
  const place = data.items.find((i) => i.id === id && isContainer(i));
  if (id && !place) return <Empty title="位置不可用">请返回全部位置。</Empty>;
  const children = data.items.filter((i) => i.parent_id === (id ?? null) && !isTerminal(i));
  const results = view.query.trim() ? searchInventory(data, view.query, id) : children;
  const shown = results.slice(0, view.limit);
  return (
    <div className="soft-page">
      <header className="soft-heading">
        <h1>我的物品</h1>
        {!id && (
          <p>
            {physicalItems(data.items.filter((i) => !isTerminal(i))).length} 件实物 ·{' '}
            {visibleProducts(data).length} 款商品
          </p>
        )}
      </header>
      <LocationPath id={id ?? null} />
      <div className={id ? 'browse-columns' : ''}>
        {id && <LocationTree id={id} />}
        <section className="soft-panel browse-results">
          <h2>{place ? itemName(place, data) : '全部位置'}</h2>
          <p className="caption">
            {physicalItems(results).length} 件实物{!view.query && id ? ' · 仅当前层' : ''}
          </p>
          <SearchField
            value={view.query}
            onChange={(query) => update({ query })}
            label={id ? '搜索此位置及下级位置' : '搜索物品或位置'}
          />
          {shown.map((item) => (
            <PhysicalRow key={item.id} item={item} path={!!view.query} />
          ))}
          {!results.length && (
            <Empty title={view.query ? '没有找到匹配结果' : '这里还是空的'}>
              {view.query ? '试试商品名称、规格或其他位置。' : '可创建下级位置，或将物品移入这里。'}
            </Empty>
          )}
          <PageEnd
            shown={shown.length}
            total={results.length}
            onMore={() => update({ limit: view.limit + PAGE_SIZE })}
          />
        </section>
      </div>
      <div className="soft-actions">
        <Button
          variant="secondary"
          disabled={!online || stale}
          onClick={() => open({ kind: 'intake', parent: id })}
        >
          入库
        </Button>
        <Button
          variant="secondary"
          disabled={!online || stale}
          onClick={() => open({ kind: 'place', parent: id })}
        >
          新建{place ? '下级' : ''}位置
        </Button>
        {place && (
          <>
            <Button
              variant="secondary"
              disabled={!online || stale}
              onClick={() => open({ kind: 'rename', target: id })}
            >
              修改名称
            </Button>
            <Button
              variant="secondary"
              disabled={!online || stale}
              onClick={() => open({ kind: 'move', target: id })}
            >
              移动位置
            </Button>
          </>
        )}
        <Link className="button secondary" to="/catalog">
          商品目录
        </Link>
      </div>
    </div>
  );
}
export function InventorySearch() {
  const { data } = useInventory();
  const [view, update] = useBrowseState('search');
  const results = searchInventory(data, view.query, view.scope, view.state, view.category);
  const shown = results.slice(0, view.limit);
  return (
    <div className="soft-page">
      <header className="soft-heading">
        <h1>搜索</h1>
      </header>
      <SearchField
        value={view.query}
        onChange={(query) => update({ query })}
        label="搜索物品、规格或位置"
      />
      <div className="search-filters">
        <label>
          搜索范围
          <select value={view.scope} onChange={(e) => update({ scope: e.target.value })}>
            <option value="">全家庭</option>
            {data.items.filter(isContainer).map((i) => (
              <option key={i.id} value={i.id}>
                {fullPath(i.id, data)}及下级位置
              </option>
            ))}
          </select>
        </label>
        <label>
          库存状态
          <select value={view.state} onChange={(e) => update({ state: e.target.value })}>
            {[
              ['current', '当前库存'],
              ['all', '全部记录'],
              ['OPENED', '已开封'],
              ['SEALED', '未开封'],
              ['unknown', '开封未记录'],
              ['terminal', '历史物品'],
            ].map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          商品分类
          <select value={view.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">全部分类</option>
            {data.catalog
              .filter((c) => c.kind === 'GROUP')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {[categoryPath(c, data), c.name].join(' / ')}
                </option>
              ))}
          </select>
        </label>
      </div>
      <section className="soft-panel">
        <h2>搜索结果</h2>
        <p className="caption">
          {physicalItems(results).length} 件实物 · {results.filter(isContainer).length} 个位置
        </p>
        {shown.map((item) => (
          <PhysicalRow key={item.id} item={item} path />
        ))}
        {!results.length && <Empty title="没有找到匹配结果">清除关键词或扩大搜索范围。</Empty>}
        <PageEnd
          shown={shown.length}
          total={results.length}
          onMore={() => update({ limit: view.limit + PAGE_SIZE })}
        />
      </section>
    </div>
  );
}
export function ProductCatalog() {
  const { data } = useInventory();
  const location = useLocation();
  const [view, update] = useBrowseState('catalog');
  const products = visibleProducts(data).filter((c) =>
    `${c.name} ${specification(c)}`
      .toLocaleLowerCase()
      .includes(view.query.trim().toLocaleLowerCase()),
  );
  const shown = products.slice(0, view.limit);
  return (
    <div className="soft-page">
      <header className="soft-heading">
        <h1>商品目录</h1>
        <p>{products.length} 款商品</p>
      </header>
      <SearchField
        value={view.query}
        onChange={(query) => update({ query })}
        label="搜索商品名称或规格"
      />
      <section className="soft-panel">
        {shown.map((sku) => (
          <Link
            key={sku.id}
            className="soft-row"
            to={`/items/group/${sku.id}`}
            search={{ returnTo: location.pathname }}
          >
            <span className="soft-row-copy">
              <strong>{sku.name}</strong>
              <span>{specification(sku) || '规格未记录'}</span>
              <small>{categoryPath(sku, data)}</small>
            </span>
            <span className="soft-row-detail">
              {
                physicalItems(
                  data.items.filter((i) => i.catalog_node_id === sku.id && !isTerminal(i)),
                ).length
              }{' '}
              件实物
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
        {!products.length && <Empty title="没有找到商品" />}
        <PageEnd
          shown={shown.length}
          total={products.length}
          unit="款商品"
          onMore={() => update({ limit: view.limit + PAGE_SIZE })}
        />
      </section>
      <Link to="/catalog/manage" className="button secondary">
        管理商品资料
      </Link>
    </div>
  );
}
export function MovePicker({
  item,
  value,
  onChange,
}: {
  item: ItemRecord;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useInventory();
  const [parent, setParent] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const allowed = data.items.filter(
    (i) =>
      isContainer(i) &&
      !isTerminal(i) &&
      !ancestors(i.id, data.items).some((p) => p.id === item.id),
  );
  const results = allowed.filter((i) =>
    query
      ? fullPath(i.id, data).toLocaleLowerCase().includes(query.toLocaleLowerCase())
      : i.parent_id === parent,
  );
  useEffect(() => setLimit(PAGE_SIZE), [query, parent]);
  return (
    <section className="move-picker">
      <h3>选择目标位置</h3>
      <p className="caption">当前位置：{fullPath(item.parent_id, data)}</p>
      <SearchField label="搜索目标位置" value={query} onChange={setQuery} />
      <nav className="location-path" aria-label="目标位置路径">
        <button type="button" onClick={() => setParent(null)}>
          全部位置
        </button>
        {ancestors(parent, data.items).map((p) => (
          <button type="button" key={p.id} onClick={() => setParent(p.id)}>
            {' '}
            / {itemName(p, data)}
          </button>
        ))}
      </nav>
      {parent && (
        <Button
          type="button"
          variant="secondary"
          disabled={parent === item.parent_id || !allowed.some((i) => i.id === parent)}
          onClick={() => onChange(parent)}
        >
          选择当前位置
        </Button>
      )}
      {results.slice(0, limit).map((p) => (
        <div className={`move-option ${value === p.id ? 'selected' : ''}`} key={p.id}>
          <button
            type="button"
            className="move-enter"
            onClick={() => {
              setParent(p.id);
              setQuery('');
            }}
          >
            <strong>{itemName(p, data)}</strong>
            <small>{query ? fullPath(p.id, data) : '进入下级位置'} ›</small>
          </button>
          <Button
            type="button"
            variant="secondary"
            disabled={p.id === item.parent_id}
            onClick={() => onChange(p.id)}
          >
            {p.id === item.parent_id ? '当前位置' : value === p.id ? '已选择' : '选择'}
          </Button>
        </div>
      ))}
      {!results.length && <p>这里没有可进入的下级位置。</p>}
      {results.length > limit && (
        <Button type="button" variant="secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>
          加载更多位置
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={!item.parent_id}
        onClick={() => onChange('')}
      >
        {!item.parent_id
          ? '当前未指定位置'
          : value === ''
            ? '已选择：未指定位置'
            : '移至未指定位置'}
      </Button>
    </section>
  );
}
