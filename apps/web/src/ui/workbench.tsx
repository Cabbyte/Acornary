import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
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
import { fullPath, specification } from '../lib/browse';
import {
  availabilityOptions,
  itemStatus,
  latestNote,
  moveTargets,
  workbenchItems,
  WORKBENCH_PAGE_SIZE,
  type WorkbenchFilter,
} from '../lib/workbench';
import { history } from '../lib/api';
import { eventNames, remaining, time } from '../lib/presentation';
import { Button, Empty, Notice, Sheet } from './components';
import { LocationPath } from './browser';
import type { Action } from './forms';

export function WorkbenchIcon({ name, size = 18 }: { name: string; size?: number }) {
  const native = name === 'down' ? 12 : name === 'search' ? 20 : 24;
  return (
    <span
      className={`wb-icon wb-icon-${name}`}
      style={{ width: size, height: size, '--icon-scale': size / native } as CSSProperties}
      aria-hidden="true"
    >
      <img src={`/design/workbench/${name}.svg`} alt="" />
    </span>
  );
}
function WorkbenchSearch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="wb-search">
      <WorkbenchIcon name="search" size={20} />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button type="button" aria-label="清除搜索" onClick={() => onChange('')}>
          <WorkbenchIcon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
const navigation = [
  ['items', '我的物品'],
  ['catalog', '商品目录'],
  ['settings', '设置'],
];
export function WorkbenchShell({
  children,
  section,
  place,
  open,
}: {
  children: ReactNode;
  section: string;
  place?: string;
  open: (a: Action) => void;
}) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  useEffect(() => {
    setQuery(new URLSearchParams(location.searchStr).get('q') ?? '');
  }, [location.pathname, location.searchStr]);
  const active = section === 'places' || section === 'search' ? 'items' : section;
  return (
    <div className="app-shell soft-shell workbench-shell">
      <a href="#main" className="skip-link">
        跳到内容
      </a>
      <header className="wb-header">
        <Link to="/items" className="wb-brand">
          <span className="wb-brand-mark">
            <img src="/design/workbench/brand.svg" alt="" />
          </span>
          <span>
            <strong>松仓</strong>
            <small>Acornary</small>
          </span>
        </Link>
        <form
          className="wb-global-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            void navigate({ to: '/items', search: { q: query } });
          }}
        >
          <WorkbenchSearch label="搜索物品、位置、规格…" value={query} onChange={setQuery} />
        </form>
        <Link to="/settings/household" className="wb-household">
          {data.household.name}
          <WorkbenchIcon name="down" size={12} />
        </Link>
      </header>
      <aside className="wb-sidebar">
        <nav aria-label="主导航">
          {navigation.slice(0, 2).map(([key, title]) => (
            <Link to={`/${key}`} key={key} aria-current={active === key ? 'page' : undefined}>
              <WorkbenchIcon name={key} />
              {title}
            </Link>
          ))}
        </nav>
        <div className="wb-location-heading">
          <span>位置</span>
          <button
            aria-label="新建位置"
            disabled={!online || stale}
            onClick={() => open({ kind: 'place', parent: place })}
          >
            <WorkbenchIcon name="plus" size={18} />
          </button>
        </div>
        <LocationTree
          active={place}
          onChoose={(id) => void navigate({ to: id ? `/places/${id}` : '/items' })}
        />
        <Link to="/settings" className="wb-settings">
          <WorkbenchIcon name="settings" />
          设置
        </Link>
      </aside>
      <main id="main" className="app-main">
        {children}
      </main>
      <nav className="wb-bottom-nav" aria-label="底部导航">
        {navigation.map(([key, title]) => (
          <Link to={`/${key}`} key={key} aria-current={active === key ? 'page' : undefined}>
            <WorkbenchIcon name={key} size={20} />
            <span>{key === 'items' ? '物品' : key === 'catalog' ? '目录' : title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
export function LocationTree({
  active,
  selected,
  onChoose,
  moving,
  searchable = false,
}: {
  active?: string;
  selected?: string;
  onChoose: (id: string) => void;
  moving?: ItemRecord[];
  searchable?: boolean;
}) {
  const { data } = useInventory();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestors(active ?? null, data.items).map((i) => i.id)),
  );
  useEffect(
    () =>
      setExpanded(
        (old) => new Set([...old, ...ancestors(active ?? null, data.items).map((i) => i.id)]),
      ),
    [active],
  );
  const locations = moving
    ? moveTargets(data, moving)
    : data.items.filter((i) => isContainer(i) && !isTerminal(i));
  const byParent = new Map<string | null, ItemRecord[]>();
  for (const place of locations)
    byParent.set(place.parent_id, [...(byParent.get(place.parent_id) ?? []), place]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of data.items)
      if (!isContainer(item) && !isTerminal(item))
        for (const parent of ancestors(item.parent_id, data.items))
          result.set(parent.id, (result.get(parent.id) ?? 0) + 1);
    return result;
  }, [data]);
  const row = (p: ItemRecord, depth: number): ReactNode => {
    const children = byParent.get(p.id) ?? [];
    const isOpen = expanded.has(p.id);
    return (
      <div
        key={p.id}
        role="treeitem"
        aria-expanded={children.length ? isOpen : undefined}
        aria-selected={(selected ?? active) === p.id}
      >
        <div
          className={`wb-tree-row ${(selected ?? active) === p.id ? 'is-selected' : ''}`}
          style={{ '--depth': Math.min(depth, 8) } as CSSProperties}
        >
          {children.length && !query ? (
            <button
              className="wb-disclosure"
              type="button"
              aria-label={`${isOpen ? '收起' : '展开'} ${itemName(p, data)}`}
              onClick={() =>
                setExpanded((old) => {
                  const next = new Set(old);
                  next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                  return next;
                })
              }
            >
              <WorkbenchIcon name={isOpen ? 'down' : 'chevron'} size={12} />
            </button>
          ) : (
            <span className="wb-disclosure" />
          )}
          <button
            className="wb-tree-label"
            type="button"
            onClick={() => onChoose(p.id)}
            title={fullPath(p.id, data)}
          >
            <WorkbenchIcon name="folder" size={16} />
            <span>{query ? fullPath(p.id, data) : itemName(p, data)}</span>
            <small>{counts.get(p.id) ?? 0}</small>
          </button>
        </div>
        {!query && isOpen && children.length > 0 && (
          <div role="group">{children.map((child) => row(child, depth + 1))}</div>
        )}
      </div>
    );
  };
  return (
    <div className="wb-location-tree">
      {searchable && (
        <WorkbenchSearch
          value={query}
          onChange={setQuery}
          label={moving ? '搜索目标位置' : '搜索位置'}
        />
      )}
      <button
        className={`wb-tree-root ${!active && !selected ? 'is-selected' : ''}`}
        type="button"
        onClick={() => onChoose('')}
      >
        {moving ? '未指定位置' : '全部物品'}
      </button>
      <div role="tree" aria-label={moving ? '目标位置' : '位置树'}>
        {query
          ? locations
              .filter((p) =>
                fullPath(p.id, data).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
              )
              .map((p) => row(p, 0))
          : locations
              .filter((p) => !p.parent_id || !locations.some((parent) => parent.id === p.parent_id))
              .map((p) => row(p, 0))}
      </div>
      {!locations.length && <p className="caption">还没有位置</p>}
    </div>
  );
}
export function WorkbenchMovePicker({
  items,
  value,
  onChange,
}: {
  items: ItemRecord[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useInventory();
  const sources = [...new Set(items.map((i) => fullPath(i.parent_id, data)))];
  return (
    <div className="wb-move-picker">
      <section className="wb-move-summary">
        <small>已选物品 · {items.length} 件</small>
        {items.map((i) => (
          <p key={i.id}>{itemName(i, data)}</p>
        ))}
        <small>来源</small>
        {sources.map((p) => (
          <small key={p}>{p}</small>
        ))}
      </section>
      {items.some(isContainer) && (
        <Notice>
          移动此容器时，内部所有物品和子容器会一起移动，各自的身份与相对位置保持不变。
        </Notice>
      )}
      <h3>选择目标位置</h3>
      <LocationTree
        moving={items}
        active={items[0]?.parent_id ?? undefined}
        selected={value}
        onChoose={onChange}
        searchable
      />
    </div>
  );
}
type View = WorkbenchFilter & {
  page: number;
  selected: string[];
  selecting: boolean;
  columns: string[];
  scroll: number;
};
const views = new Map<string, View>();
const defaults = (): View => ({
  query: '',
  descendants: false,
  status: '',
  category: '',
  sort: 'name',
  page: 1,
  selected: [],
  selecting: false,
  columns: ['spec', 'status', 'place', 'note'],
  scroll: 0,
});
export function Workbench({
  id,
  detailId,
  open,
  selectionVersion,
}: {
  selectionVersion: number;
  id?: string;
  detailId?: string;
  open: (a: Action) => void;
}) {
  const { data, stale } = useInventory();
  const { session, online } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const key = `${session.cache_key}:workbench:${id ?? ''}`;
  const [view, setView] = useState<View>(() => views.get(key) ?? defaults());
  const [locations, setLocations] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams(location.searchStr);
  const inspectedId = detailId ?? params.get('item');
  const inspected = data.items.find((i) => i.id === inspectedId);
  useLayoutEffect(() => {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    const frame = requestAnimationFrame(() => window.scrollTo(0, inspectedId ? 0 : view.scroll));
    return () => cancelAnimationFrame(frame);
  }, [inspectedId]);
  const patch = (values: Partial<View>) => setView((old) => ({ ...old, page: 1, ...values }));
  useEffect(() => {
    views.set(key, view);
  }, [key, view]);
  const previousSelectionVersion = useRef(selectionVersion);
  useEffect(() => {
    if (previousSelectionVersion.current !== selectionVersion) {
      setView((old) => ({ ...old, selected: [], selecting: false }));
      previousSelectionVersion.current = selectionVersion;
    }
  }, [selectionVersion]);
  const globalQuery = params.get('q');
  useEffect(() => {
    if (globalQuery !== null) patch({ query: globalQuery, descendants: true });
  }, [globalQuery]);
  useEffect(() => {
    if (list.current) list.current.scrollTop = view.scroll;
  }, []);
  const selected = data.items.filter(
    (i) => view.selected.includes(i.id) && !isContainer(i) && !isTerminal(i),
  );
  const results = useMemo(
    () => workbenchItems(data, id, view),
    [data, id, view.query, view.descendants, view.status, view.category, view.sort],
  );
  const pageCount = Math.max(1, Math.ceil(results.length / WORKBENCH_PAGE_SIZE));
  const page = Math.min(view.page, pageCount);
  const shown = results.slice((page - 1) * WORKBENCH_PAGE_SIZE, page * WORKBENCH_PAGE_SIZE);
  const place = data.items.find((i) => i.id === id && isContainer(i));
  const childPlaces = data.items.filter(
    (i) => isContainer(i) && !isTerminal(i) && i.parent_id === (id ?? null),
  );
  const disabled = !online || stale;
  const toggle = (item: ItemRecord) =>
    patch({
      selected: view.selected.includes(item.id)
        ? view.selected.filter((i) => i !== item.id)
        : [...view.selected, item.id],
      selecting: true,
      page,
    });
  const inspect = (item?: ItemRecord) => {
    if (item && window.matchMedia('(max-width: 760px)').matches)
      setView((old) => ({ ...old, scroll: window.scrollY }));
    if (!item && detailId && params.get('returnTo')) {
      const returnPath = params.get('returnTo')!;
      const returnUrl = URL.canParse(returnPath, window.location.origin)
        ? new URL(returnPath, window.location.origin)
        : null;
      if (
        returnUrl &&
        returnUrl.origin === window.location.origin &&
        /^\/(items|places|catalog|search)(\/|$)/.test(returnUrl.pathname)
      ) {
        void navigate({
          to: returnUrl.pathname,
          search: Object.fromEntries(returnUrl.searchParams),
        });
        return;
      }
    }
    const next = Object.fromEntries(params);
    delete next.item;
    if (item) next.item = item.id;
    void navigate({
      to: detailId ? (id ? `/places/${id}` : '/items') : location.pathname,
      search: next,
    });
  };
  if (id && !place)
    return (
      <Empty title="位置不可用">
        <Link to="/items">返回全部物品</Link>
      </Empty>
    );
  const selectAll = () => {
    const ids = shown.filter((i) => !isTerminal(i)).map((i) => i.id);
    patch({
      selecting: true,
      selected: ids.every((i) => view.selected.includes(i))
        ? view.selected.filter((i) => !ids.includes(i))
        : [...new Set([...view.selected, ...ids])],
      page,
    });
  };
  return (
    <div
      className={`wb-workspace ${inspected ? 'has-detail' : ''} ${view.selecting ? 'is-selecting' : ''}`}
    >
      <section className="wb-inventory" aria-label="库存工作台">
        <div className="wb-location-bar">
          <button className="wb-location-trigger" onClick={() => setLocations(true)}>
            位置
          </button>
          <LocationPath id={id ?? null} />
        </div>
        <div className="wb-title">
          <div>
            <h1>{place ? itemName(place, data) : '我的物品'}</h1>
            <span>{results.length} 件物品</span>
          </div>
          <Button disabled={disabled} onClick={() => open({ kind: 'intake', parent: id })}>
            <span aria-hidden="true">＋</span>
            <span className="wb-add-desktop">添加物品</span>
            <span className="wb-add-mobile">添加</span>
          </Button>
        </div>
        {place && (
          <details className="wb-place-actions">
            <summary>位置操作</summary>
            <div className="wb-popover">
              <button disabled={disabled} onClick={() => open({ kind: 'place', parent: id })}>
                新建下级位置
              </button>
              <button disabled={disabled} onClick={() => open({ kind: 'rename', target: id })}>
                修改位置名称
              </button>
              <button disabled={disabled} onClick={() => open({ kind: 'move', target: id })}>
                移动位置
              </button>
            </div>
          </details>
        )}
        <div className="wb-toolbar">
          <WorkbenchSearch
            label={id ? '在当前位置搜索…' : '搜索物品、规格、位置…'}
            value={view.query}
            onChange={(query) => {
              patch({ query });
              if (globalQuery !== null) {
                const next = Object.fromEntries(params);
                if (query) next.q = query;
                else delete next.q;
                void navigate({ to: location.pathname, search: next, replace: true });
              }
            }}
          />
          <select
            className="wb-scope"
            aria-label="位置范围"
            value={view.descendants ? 'all' : 'direct'}
            onChange={(e) => patch({ descendants: e.target.value === 'all' })}
          >
            <option value="direct">仅当前位置</option>
            <option value="all">包含下级</option>
          </select>
          <details className="wb-filter">
            <summary>筛选</summary>
            <div className="wb-popover">
              <label>
                类型
                <select
                  aria-label="商品分类"
                  value={view.category}
                  onChange={(e) => patch({ category: e.target.value })}
                >
                  <option value="">全部分类</option>
                  {data.catalog
                    .filter((c) => c.kind === 'GROUP')
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {ancestors(c.id, data.catalog)
                          .map((a) => a.name)
                          .join(' / ')}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                状态
                <select
                  aria-label="物品状态"
                  value={view.status}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  <option value="">全部在库状态</option>
                  {availabilityOptions.map(([v, t]) => (
                    <option key={v} value={v || 'unknown'}>
                      {t}
                    </option>
                  ))}
                  <option value="terminal">历史物品</option>
                </select>
              </label>
              <button type="button" onClick={() => patch({ status: '', category: '' })}>
                清除筛选
              </button>
            </div>
          </details>
          <select
            className="wb-sort"
            aria-label="排序"
            value={view.sort}
            onChange={(e) => patch({ sort: e.target.value })}
          >
            <option value="name">名称排序</option>
            <option value="recent">最近入库</option>
          </select>
          <details className="wb-columns">
            <summary>显示列</summary>
            <div className="wb-popover">
              {[
                ['spec', '规格'],
                ['status', '状态'],
                ['place', '收纳位置'],
                ['note', '备注'],
              ].map(([v, t]) => (
                <label key={v}>
                  <input
                    type="checkbox"
                    checked={view.columns.includes(v)}
                    onChange={() =>
                      patch({
                        columns: view.columns.includes(v)
                          ? view.columns.filter((c) => c !== v)
                          : [...view.columns, v],
                        page,
                      })
                    }
                  />
                  {t}
                </label>
              ))}
            </div>
          </details>
          <button
            className="wb-select-toggle"
            onClick={() => patch({ selecting: !view.selecting, selected: [], page })}
          >
            {view.selecting ? '取消' : '选择'}
          </button>
        </div>
        {(view.query || view.status || view.category) && (
          <div className="wb-active-filters">
            <span>
              {view.query ? `“${view.query}” · 搜索此位置及全部下级` : '已筛选'} · {results.length}{' '}
              件
            </span>
            <button
              onClick={() => {
                patch({ query: '', category: '', status: '' });
                if (globalQuery !== null) {
                  const next = Object.fromEntries(params);
                  delete next.q;
                  void navigate({ to: location.pathname, search: next });
                }
              }}
            >
              清除
            </button>
          </div>
        )}
        {!!childPlaces.length && !view.query && (
          <div className="wb-child-places" aria-label="下级位置">
            {childPlaces.map((p) => (
              <Link key={p.id} to={`/places/${p.id}`}>
                <WorkbenchIcon name="folder" size={16} />
                {itemName(p, data)}
              </Link>
            ))}
          </div>
        )}
        <div className={`wb-selection-bar ${selected.length ? 'with-selection' : ''}`}>
          <span>
            {selected.length
              ? `已选 ${selected.length} 件`
              : '点击物品查看详情；使用复选框选择后批量移动。'}
          </span>
          {selected.length > 0 && (
            <>
              <Button
                variant="secondary"
                disabled={disabled || selected.length > 100}
                onClick={() => open({ kind: 'move', ids: selected.map((i) => i.id).join(',') })}
              >
                移动到…
              </Button>
              <button onClick={() => patch({ selected: [], selecting: false, page })}>
                取消选择
              </button>
            </>
          )}
        </div>
        <div
          className="wb-table-scroll"
          ref={list}
          onScroll={(e) => {
            const scroll = e.currentTarget.scrollTop;
            setView((old) => ({ ...old, scroll }));
          }}
        >
          <table className="wb-table">
            <thead>
              <tr>
                <th className="wb-check-cell">
                  <input
                    type="checkbox"
                    aria-label="选择本页全部物品"
                    checked={
                      shown.some((i) => !isTerminal(i)) &&
                      shown.filter((i) => !isTerminal(i)).every((i) => view.selected.includes(i.id))
                    }
                    onChange={selectAll}
                  />
                </th>
                <th>物品</th>
                {view.columns.includes('spec') && <th className="wb-spec-cell">规格</th>}
                {view.columns.includes('status') && <th className="wb-status-cell">状态</th>}
                {view.columns.includes('place') && <th className="wb-place-cell">收纳位置</th>}
                {view.columns.includes('note') && <th className="wb-note-cell">备注</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
                const spec = specification(sku) || '规格未记录';
                const parent = data.items.find((i) => i.id === item.parent_id);
                const name = itemName(item, data),
                  status = itemStatus(item);
                const selectedRow = view.selected.includes(item.id);
                return (
                  <tr
                    key={item.id}
                    className={selectedRow || inspected?.id === item.id ? 'is-selected' : ''}
                  >
                    <td className="wb-check-cell">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${name} ${item.id}`}
                        disabled={isTerminal(item)}
                        checked={selectedRow}
                        onChange={() => toggle(item)}
                      />
                    </td>
                    <td className="wb-name-cell">
                      <button
                        type="button"
                        onClick={() => (view.selecting ? toggle(item) : inspect(item))}
                        title={`${name} · ${item.id}`}
                      >
                        <strong>{name}</strong>
                        <span className="wb-mobile-spec">{spec}</span>
                        <span className="wb-mobile-side">
                          <span>
                            <img
                              alt=""
                              src={`/design/workbench/${attr(item, 'lifecycle')?.availability === 'IN_USE' ? 'status' : 'status-muted'}.svg`}
                            />
                            {status}
                          </span>
                          <small>{parent ? itemName(parent, data) : '未记录位置'}</small>
                        </span>
                      </button>
                    </td>
                    {view.columns.includes('spec') && (
                      <td className="wb-spec-cell" title={spec}>
                        {spec}
                      </td>
                    )}
                    {view.columns.includes('status') && (
                      <td
                        className={`wb-status-cell ${attr(item, 'lifecycle')?.availability === 'IN_USE' ? 'in-use' : ''}`}
                      >
                        {status}
                      </td>
                    )}
                    {view.columns.includes('place') && (
                      <td className="wb-place-cell" title={fullPath(item.parent_id, data)}>
                        {parent ? itemName(parent, data) : '未记录位置'}
                      </td>
                    )}
                    {view.columns.includes('note') && (
                      <td className="wb-note-cell" title={latestNote(data, item.id)?.body}>
                        {latestNote(data, item.id)?.body || '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && (
            <Empty
              title={
                view.query || view.status || view.category ? '没有找到匹配物品' : '这里还没有物品'
              }
            >
              {id && !view.descendants
                ? '可进入下级位置，或选择“包含下级”查看其中物品。'
                : '添加物品，开始整理你的库存。'}
            </Empty>
          )}
        </div>
        <footer className="wb-pagination">
          <span role="status">
            显示 {results.length ? (page - 1) * WORKBENCH_PAGE_SIZE + 1 : 0}–
            {Math.min(page * WORKBENCH_PAGE_SIZE, results.length)} / {results.length} 件
          </span>
          <nav aria-label="列表分页">
            <button
              disabled={page === 1}
              aria-label="上一页"
              onClick={() => patch({ page: page - 1, scroll: 0 })}
            >
              ‹
            </button>
            {Array.from(
              { length: Math.min(5, pageCount) },
              (_, i) => Math.max(1, Math.min(page - 2, pageCount - 4)) + i,
            ).map((p) => (
              <button
                key={p}
                aria-label={`第 ${p} 页`}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => {
                  patch({ page: p, scroll: 0 });
                  list.current?.scrollTo(0, 0);
                }}
              >
                {p}
              </button>
            ))}
            <button
              disabled={page === pageCount}
              aria-label="下一页"
              onClick={() => {
                patch({ page: page + 1, scroll: 0 });
                list.current?.scrollTo(0, 0);
              }}
            >
              ›
            </button>
          </nav>
          <span>每页 {WORKBENCH_PAGE_SIZE}</span>
        </footer>
        {view.selecting && (
          <div className="wb-mobile-selection">
            <label>
              <input
                type="checkbox"
                checked={shown.length > 0 && shown.every((i) => view.selected.includes(i.id))}
                onChange={selectAll}
              />
              本页全选
            </label>
            <span>已选 {selected.length} 件</span>
            <Button
              disabled={disabled || !selected.length || selected.length > 100}
              onClick={() => open({ kind: 'move', ids: selected.map((i) => i.id).join(',') })}
            >
              移动到…
            </Button>
          </div>
        )}
      </section>
      {selected.length > 0 && !inspected && (
        <aside className="wb-inspector wb-selection-inspector">
          <header>
            <h2>已选物品</h2>
            <button
              aria-label="取消选择"
              onClick={() => patch({ selected: [], selecting: false, page })}
            >
              <WorkbenchIcon name="close" />
            </button>
          </header>
          <h3>已选择 {selected.length} 件</h3>
          {selected.map((i) => (
            <div className="wb-selected-item" key={i.id}>
              <strong>{itemName(i, data)}</strong>
              <p>
                {specification(data.catalog.find((c) => c.id === i.catalog_node_id)) ||
                  '规格未记录'}
              </p>
            </div>
          ))}
          <Button
            disabled={disabled || selected.length > 100}
            onClick={() => open({ kind: 'move', ids: selected.map((i) => i.id).join(',') })}
          >
            移动到…
          </Button>
          {selected.length > 100 && <Notice>每次最多移动 100 件，请减少选择。</Notice>}
        </aside>
      )}
      {inspected && (
        <ItemInspector key={inspected.id} item={inspected} open={open} close={() => inspect()} />
      )}
      {inspectedId && !inspected && (
        <Notice danger>
          这件物品已不可用。<button onClick={() => inspect()}>返回列表</button>
        </Notice>
      )}
      {locations && (
        <Sheet title="选择位置" onClose={() => setLocations(false)} workbench>
          <LocationTree
            active={id}
            onChoose={(target) => {
              setLocations(false);
              void navigate({ to: target ? `/places/${target}` : '/items' });
            }}
            searchable
          />
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setLocations(false);
              open({ kind: 'place', parent: id });
            }}
          >
            新建位置
          </Button>
        </Sheet>
      )}
    </div>
  );
}
function ItemInspector({
  item,
  open,
  close,
}: {
  item: ItemRecord;
  open: (a: Action) => void;
  close: () => void;
}) {
  const { data, stale } = useInventory();
  const { online, session } = useSession();
  const life = attr(item, 'lifecycle');
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  const note = latestNote(data, item.id);
  const events = useQuery({
    queryKey: ['history', session.cache_key, item.id, item.revision],
    queryFn: () => history(item.id, 'ITEM'),
    enabled: online && !stale,
  });
  const disabled = !online || stale;
  return (
    <aside className="wb-inspector" aria-label="物品详情">
      <header>
        <button className="wb-detail-back" onClick={close}>
          ‹ 返回
        </button>
        <h2>物品详情</h2>
        <button className="wb-detail-close" aria-label="关闭详情" onClick={close}>
          <WorkbenchIcon name="close" />
        </button>
        <Link
          className="wb-detail-more"
          aria-label="更多资料与操作"
          to={`/items/${item.id}/details`}
        >
          <WorkbenchIcon name="dots" />
        </Link>
      </header>
      <div className="wb-inspector-body">
        <h3>{itemName(item, data)}</h3>
        <p className="wb-detail-spec">{specification(sku) || '规格未记录'}</p>
        <p className="wb-detail-status">
          <img
            alt=""
            src={`/design/workbench/${life?.availability === 'IN_USE' ? 'status' : 'status-muted'}.svg`}
          />
          {itemStatus(item)}
        </p>
        <div className="wb-detail-actions">
          <Button
            variant="secondary"
            disabled={disabled || isTerminal(item)}
            onClick={() => open({ kind: 'move', target: item.id })}
          >
            移动
          </Button>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => open({ kind: 'edit', target: item.id, note: note?.id })}
          >
            编辑
          </Button>
        </div>
        <section className="wb-properties">
          <h4>物品资料</h4>
          <dl>
            <div>
              <dt>位置</dt>
              <dd>
                <LocationPath id={item.parent_id} />
              </dd>
            </div>
            <div>
              <dt>编号</dt>
              <dd className="wb-item-id">{item.id}</dd>
            </div>
            <div>
              <dt>规格</dt>
              <dd>{specification(sku) || '未记录'}</dd>
            </div>
            <div>
              <dt>购入日期</dt>
              <dd>{life?.acquisition?.acquired_on || '未记录'}</dd>
            </div>
            {attr(item, 'contents')?.remaining && (
              <div>
                <dt>剩余量</dt>
                <dd>{remaining(item)}</dd>
              </div>
            )}
          </dl>
        </section>
        <section className="wb-note">
          <h4>备注</h4>
          <p>{note?.body || '未记录'}</p>
        </section>
        <section className="wb-history">
          <h4>最近动态</h4>
          {events.data?.data.slice(0, 3).map((event) => (
            <p key={event.id}>
              <time>{time(event.occurred_at)}</time>
              <span>{eventNames[event.event_type] ?? event.event_type}</span>
            </p>
          ))}
          {events.isFetching && <small>正在读取动态…</small>}
          {events.isError && (
            <button onClick={() => void events.refetch()}>动态读取失败，重试</button>
          )}
          {!online && <small>联网后可查看最新动态</small>}
          <Link to={`/items/${item.id}/history`}>查看全部动态</Link>
        </section>
        <Link
          className="wb-more-details"
          to={`/items/${item.id}/details`}
          search={{
            returnTo: item.parent_id
              ? `/places/${item.parent_id}?item=${item.id}`
              : `/items?item=${item.id}`,
          }}
        >
          更多资料、消耗与笔记 ›
        </Link>
      </div>
    </aside>
  );
}
