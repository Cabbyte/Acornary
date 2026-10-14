import { ItemInspector } from './item-inspector';
import { StashResults } from './stash-results';
import {
  attentionLabels,
  householdToday,
  itemAttention,
  stashGroups,
  type Attention,
  type GroupMode,
} from '../lib/stash';
import { LabelButton } from './label-button';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Dropdown,
  Input,
  Layout,
  Menu,
  Pagination,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd';
import {
  AppstoreOutlined,
  HistoryOutlined,
  DownOutlined,
  FolderOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
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
  itemFacts,
  latestNote,
  moveTargets,
  workbenchItems,
  WORKBENCH_PAGE_SIZE,
  type WorkbenchFilter,
} from '../lib/workbench';
import { label } from '../lib/presentation';
import { ActionDrawer, Empty, Notice } from './components';
import { LocationPath, SearchField } from './browser';
import { useViewport } from './theme';
import { pageScrollRoot, readPageScroll, setPageScroll } from './viewport';
import type { Action } from './forms';
import { InventoryColumns, useContentWidth, useLocationPanelWidth } from './inventory-layout';
import brand from '../../public/design/workbench/brand.svg?inline';

const navigation = [
  { key: 'items', label: '我的物品', icon: <InboxOutlined aria-hidden="true" /> },
  { key: 'catalog', label: '商品目录', icon: <AppstoreOutlined aria-hidden="true" /> },
  { key: 'activity', label: '动态', icon: <HistoryOutlined aria-hidden="true" /> },
  { key: 'settings', label: '设置', icon: <SettingOutlined aria-hidden="true" /> },
];
const sidebarCollapsedKey = 'acornary-sidebar-collapsed';
let rememberedSidebarCollapsed = false;

function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(sidebarCollapsedKey);
      if (saved !== null) rememberedSidebarCollapsed = saved === 'true';
    } catch {
      // Opaque MCP iframes retain the preference only within this running session.
    }
    return rememberedSidebarCollapsed;
  });
  const toggle = () => {
    rememberedSidebarCollapsed = !collapsed;
    setCollapsed(rememberedSidebarCollapsed);
    try {
      localStorage.setItem(sidebarCollapsedKey, String(rememberedSidebarCollapsed));
    } catch {
      // Storage restrictions must not disable navigation.
    }
  };
  return { collapsed, toggle };
}

export function WorkbenchShell({ children, section }: { children: ReactNode; section: string }) {
  const { data } = useInventory();
  const navigate = useNavigate();
  const { mobile, wide } = useViewport();
  const { collapsed, toggle } = useSidebarCollapsed();
  const active = section === 'places' || section === 'search' ? 'items' : section;
  return (
    <Layout className="workbench-shell">
      <a href="#main" className="skip-link">
        跳到内容
      </a>
      {mobile && (
        <Layout.Header className="wb-header">
          <Link to="/items" className="wb-brand">
            <img src={brand} alt="" width={36} height={36} />
            <span>
              <strong>松仓</strong>
              <small>Acornary</small>
            </span>
          </Link>
          <Button onClick={() => void navigate({ to: '/settings/households' })}>
            {data.household.name}
            <DownOutlined aria-hidden="true" />
          </Button>
        </Layout.Header>
      )}
      <Layout>
        {!mobile && (
          <Layout.Sider
            width={wide ? 224 : 200}
            collapsed={collapsed}
            collapsedWidth={64}
            className="wb-sidebar"
          >
            <div className={`stash-sidebar-brand${collapsed ? ' is-collapsed' : ''}`}>
              <Link to="/items" className="wb-brand">
                <img src={brand} alt="松仓" width={36} height={36} />
                {!collapsed && (
                  <span>
                    <strong>松仓</strong>
                    <small>Acornary</small>
                  </span>
                )}
              </Link>
              <Button
                type="text"
                aria-label={`切换家庭：${data.household.name}`}
                title={data.household.name}
                onClick={() => void navigate({ to: '/settings/households' })}
              >
                {collapsed ? (
                  <DownOutlined />
                ) : (
                  <>
                    {data.household.name}
                    <DownOutlined />
                  </>
                )}
              </Button>
            </div>
            <Button
              className="wb-sidebar-toggle"
              type="text"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              title={collapsed ? '展开侧栏' : '收起侧栏'}
              aria-expanded={!collapsed}
              onClick={toggle}
              icon={
                collapsed ? (
                  <MenuUnfoldOutlined aria-hidden="true" />
                ) : (
                  <MenuFoldOutlined aria-hidden="true" />
                )
              }
            />
            <Menu
              aria-label="主导航"
              mode="inline"
              selectedKeys={[active]}
              inlineCollapsed={collapsed}
              items={navigation.slice(0, 3).map((n) => ({
                ...n,
                title: n.label,
                label: <Link to={`/${n.key}`}>{n.label}</Link>,
              }))}
            />
            <Menu
              className="wb-settings-nav"
              aria-label="设置导航"
              mode="inline"
              inlineCollapsed={collapsed}
              selectedKeys={[active]}
              items={[
                {
                  ...navigation[3],
                  title: '设置',
                  label: <Link to="/settings">设置</Link>,
                },
              ]}
            />
          </Layout.Sider>
        )}
        <Layout.Content id="main" className="app-main">
          {children}
        </Layout.Content>
      </Layout>
      {mobile && (
        <nav className="wb-bottom-nav" aria-label="底部导航">
          {navigation.map((n) => (
            <Link key={n.key} to={`/${n.key}`} aria-current={active === n.key ? 'page' : undefined}>
              {n.icon}
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </Layout>
  );
}
type LocationTreeState = { query: string; expanded: string[] };
const locationViews = new Map<string, LocationTreeState>();

export function LocationTree({
  active,
  selected,
  onChoose,
  moving,
  searchable = false,
  state,
  onStateChange,
}: {
  active?: string;
  selected?: string;
  onChoose: (id: string) => void;
  moving?: ItemRecord[];
  searchable?: boolean;
  state?: LocationTreeState;
  onStateChange?: (state: LocationTreeState) => void;
}) {
  const { data } = useInventory();
  const [local, setLocal] = useState<LocationTreeState>({ query: '', expanded: [] });
  const { query, expanded } = state ?? local;
  const update = (next: Partial<LocationTreeState>) =>
    (onStateChange ?? setLocal)({ query, expanded, ...next });
  useEffect(() => {
    const parents = ancestors(active ?? null, data.items).map((i) => i.id);
    if (parents.some((p) => !expanded.includes(p)))
      update({ expanded: [...new Set([...expanded, ...parents])] });
  }, [active, data.items]);
  const locations = moving
    ? moveTargets(data, moving)
    : data.items.filter((i) => isContainer(i) && !isTerminal(i));
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of data.items)
      if (!isContainer(item) && !isTerminal(item))
        for (const p of ancestors(item.parent_id, data.items))
          result.set(p.id, (result.get(p.id) ?? 0) + 1);
    return result;
  }, [data]);
  const node = (p: ItemRecord): TreeDataNode => ({
    key: p.id,
    icon: <FolderOutlined aria-hidden="true" />,
    title: (
      <span className="wb-tree-title" title={fullPath(p.id, data)}>
        <span className="wb-tree-name">{query ? fullPath(p.id, data) : itemName(p, data)}</span>{' '}
        <Typography.Text type="secondary">{counts.get(p.id) ?? 0}</Typography.Text>
      </span>
    ),
    children: query ? undefined : locations.filter((i) => i.parent_id === p.id).map(node),
  });
  const treeData = (
    query
      ? locations.filter((p) =>
          fullPath(p.id, data).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
        )
      : locations.filter(
          (p) => !p.parent_id || !locations.some((parent) => parent.id === p.parent_id),
        )
  ).map(node);
  return (
    <div className="stack wb-location-tree">
      {searchable && (
        <SearchField
          value={query}
          onChange={(query) => update({ query })}
          label={moving ? '搜索目标位置' : '搜索位置'}
        />
      )}
      <Button
        type="text"
        block
        className={`wb-tree-root${!(selected ?? active) ? ' is-selected' : ''}`}
        aria-label={moving ? '未指定位置' : '全部物品'}
        aria-pressed={!(selected ?? active)}
        icon={<FolderOutlined aria-hidden="true" />}
        onClick={() => onChoose('')}
      >
        <span className="wb-tree-title">
          <span className="wb-tree-name">{moving ? '未指定位置' : '全部物品'}</span>
          {!moving && (
            <Typography.Text type="secondary">
              {data.items.filter((i) => !isContainer(i) && !isTerminal(i)).length}
            </Typography.Text>
          )}
        </span>
      </Button>
      <Tree
        aria-label={moving ? '目标位置' : '位置树'}
        blockNode
        showIcon
        treeData={treeData}
        expandedKeys={expanded}
        onExpand={(keys) => update({ expanded: keys.map(String) })}
        selectedKeys={[selected ?? active ?? '']}
        onSelect={(keys) => {
          if (keys[0]) onChoose(String(keys[0]));
        }}
      />
      {!locations.length && <Typography.Text type="secondary">还没有位置</Typography.Text>}
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
  return (
    <div className="stack">
      <Card size="small" title={`已选物品 · ${items.length} 件`}>
        {items.map((i) => (
          <p key={i.id}>{itemName(i, data)}</p>
        ))}
        <Typography.Text type="secondary">
          来源：{[...new Set(items.map((i) => fullPath(i.parent_id, data)))].join('；')}
        </Typography.Text>
      </Card>
      {items.some(isContainer) && (
        <Notice>
          移动此容器时，内部所有物品和子容器会一起移动，各自的身份与相对位置保持不变。
        </Notice>
      )}
      <Typography.Title level={4}>选择目标位置</Typography.Title>
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
  pageSize: number;
  selected: string[];
  selecting: boolean;
  columns: string[];
  scroll: number;
  group: GroupMode;
  attention: Attention[];
  expanded: string[];
  forcedCollapsed: string[];
  groupPages: Record<string, number>;
  selectedOnly: boolean;
};
const views = new Map<string, View>();
let householdScope = '';
const defaults = (): View => ({
  query: '',
  group: 'product',
  attention: [],
  expanded: [],
  forcedCollapsed: [],
  groupPages: {},
  selectedOnly: false,
  descendants: true,
  status: '',
  category: '',
  sort: 'name',
  page: 1,
  pageSize: WORKBENCH_PAGE_SIZE,
  selected: [],
  selecting: false,
  columns: ['spec', 'status', 'note'],
  scroll: 0,
});
export function clearWorkbenchSelections() {
  for (const [key, view] of views) views.set(key, { ...view, selected: [], selecting: false });
}
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
  const { mobile, wide } = useViewport();
  const location = useLocation();
  const navigate = useNavigate();
  const key = `${session.cache_key}:workbench:${id ?? ''}`;
  const [view, setView] = useState<View>(() => {
    if (householdScope !== session.cache_key) {
      for (const [k, v] of views) views.set(k, { ...v, selected: [], selecting: false });
      householdScope = session.cache_key ?? '';
    }
    const saved = views.get(key) ?? defaults();
    return { ...saved, columns: saved.columns.filter((column) => column !== 'place') };
  });
  const [locations, setLocations] = useState(false);
  const [treeState, setTreeState] = useState<LocationTreeState>(
    () => locationViews.get(session.cache_key ?? '') ?? { query: '', expanded: [] },
  );
  const changeTreeState = (next: LocationTreeState) => {
    locationViews.set(session.cache_key ?? '', next);
    setTreeState(next);
  };
  const workspace = useContentWidth();
  const locationWidth = useLocationPanelWidth();
  // Measure the workspace independently of the inspector to avoid layout feedback loops.
  const contentWidth = workspace.width - 48;
  const inlineLocations = wide && contentWidth >= 836;
  const inlineDetail = inlineLocations && contentWidth >= 320 + 656 + 384;
  const availableWidth =
    contentWidth -
    (inlineDetail && (detailId || new URLSearchParams(location.searchStr).get('item')) ? 384 : 0);
  const maxLocationWidth = Math.max(180, Math.min(320, availableWidth - 656));
  useEffect(() => {
    if (inlineLocations) setLocations(false);
  }, [inlineLocations]);
  const params = new URLSearchParams(location.searchStr);
  const inspectedId = detailId ?? params.get('item');
  const inspected = data.items.find((i) => i.id === inspectedId);
  const lastInspected = useRef(inspectedId);
  const originControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const previous = lastInspected.current;
    lastInspected.current = inspectedId;
    if (params.has('dialog')) return;
    const frame = requestAnimationFrame(() => {
      if (inspectedId && (mobile || inlineDetail)) {
        document.getElementById('stash-dossier-heading')?.focus({ preventScroll: true });
      } else if (!inspectedId && previous) {
        const fallback =
          document.querySelector<HTMLElement>(`[data-inspect-id="${CSS.escape(previous)}"]`) ??
          document.querySelector<HTMLElement>('.wb-toolbar input[type="search"]');
        const target = originControl.current?.isConnected ? originControl.current : fallback;
        target?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [inspectedId, mobile, inlineDetail]);
  const patch = (values: Partial<View>) => setView((old) => ({ ...old, page: 1, ...values }));
  useEffect(() => {
    views.set(key, view);
  }, [key, view]);
  const current = useRef(view);
  current.current = view;
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() =>
      setPageScroll(inspectedId && mobile ? 0 : current.current.scroll),
    );
    return () => cancelAnimationFrame(frame);
  }, [inspectedId]);
  useEffect(() => {
    const scroll = () => {
      if (!inspectedId) {
        const next = { ...current.current, scroll: readPageScroll() };
        current.current = next;
        views.set(key, next);
      }
    };
    const surface = pageScrollRoot() ?? window;
    surface.addEventListener('scroll', scroll, { passive: true });
    return () => surface.removeEventListener('scroll', scroll);
  }, [key, inspectedId]);
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
  const selected = data.items.filter(
    (i) => view.selected.includes(i.id) && !isContainer(i) && !isTerminal(i),
  );
  useEffect(() => {
    if (view.selectedOnly && selected.length === 0) patch({ selectedOnly: false });
  }, [view.selectedOnly, selected.length]);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const today = householdToday(data.household.timezone, clock);
  const scopeResults = useMemo(
    () => workbenchItems(data, id, view),
    [
      data,
      id,
      view.query,
      view.descendants,
      view.status,
      view.category,
      view.sort,
      view.opening,
      view.condition,
      view.lifecycle,
    ],
  );
  const filteredResults = view.selectedOnly
    ? selected
    : scopeResults.filter(
        (item) =>
          !view.attention.length ||
          itemAttention(item, data, today).some((a) => view.attention.includes(a)),
      );
  const results =
    view.group === 'place' || view.group === 'date'
      ? stashGroups(filteredResults, data, view.group).flatMap((g) => g.items)
      : filteredResults;
  const groups = stashGroups(results, data, view.group);
  const total = view.group === 'product' ? groups.length : results.length;
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of data.items) {
      const name = itemName(item, data);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return counts;
  }, [data]);
  const page = Math.min(view.page, Math.max(1, Math.ceil(total / view.pageSize)));
  const flatPage = results.slice((page - 1) * view.pageSize, page * view.pageSize);
  const shownGroups =
    view.group === 'product'
      ? groups.slice((page - 1) * view.pageSize, page * view.pageSize)
      : stashGroups(flatPage, data, view.group);
  const forceExpand =
    !!view.query || !!view.attention.length || view.group !== 'product' || view.selectedOnly;
  const shown =
    view.group === 'none'
      ? flatPage
      : shownGroups.flatMap((g) => {
          if (
            g.items.length > 1 &&
            (forceExpand ? view.forcedCollapsed.includes(g.id) : !view.expanded.includes(g.id))
          )
            return [];
          if (view.group !== 'product') return g.items;
          const p = Math.min(view.groupPages[g.id] ?? 1, Math.ceil(g.items.length / 20));
          return g.items.slice((p - 1) * 20, p * 20);
        });
  const place = data.items.find((i) => i.id === id && isContainer(i));
  const disabled = !online || stale || session.can_write === false;
  const toggle = (item: ItemRecord) =>
    patch({
      selected: view.selected.includes(item.id)
        ? view.selected.filter((i) => i !== item.id)
        : [...view.selected, item.id],
      selecting: true,
      page,
    });
  const inspect = (item?: ItemRecord) => {
    if (item)
      originControl.current = document.querySelector<HTMLElement>(
        `[data-inspect-id="${CSS.escape(item.id)}"]`,
      );
    if (item) setView((old) => ({ ...old, scroll: readPageScroll() }));
    if (!item && detailId && params.get('returnTo')) {
      const p = params.get('returnTo')!;
      const u = URL.canParse(p, window.location.origin) ? new URL(p, window.location.origin) : null;
      if (
        u &&
        u.origin === window.location.origin &&
        /^\/(items|places|catalog|search)(\/|$)/.test(u.pathname)
      ) {
        void navigate({ to: u.pathname, search: Object.fromEntries(u.searchParams) });
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
  const allChecked =
    shown.some((i) => !isTerminal(i)) &&
    shown.filter((i) => !isTerminal(i)).every((i) => view.selected.includes(i.id));
  const specs = (item: ItemRecord) =>
    specification(data.catalog.find((c) => c.id === item.catalog_node_id)) || '规格未记录';
  const changeQuery = (query: string) => {
    patch({ query, forcedCollapsed: [], groupPages: {} });
    if (globalQuery !== null) {
      const next = Object.fromEntries(params);
      if (query) next.q = query;
      else delete next.q;
      void navigate({ to: location.pathname, search: next, replace: true });
    }
  };
  const detail = inspected ? (
    <>
      <Notice>
        {!results.some((i) => i.id === inspected.id) ? '当前查看的物品不在筛选结果中' : '单件档案'}
      </Notice>
      <ItemInspector item={inspected} open={open} close={() => inspect()} />
    </>
  ) : null;
  const chooseLocation = (target: string) => {
    setLocations(false);
    void navigate({ to: target ? `/places/${target}` : '/items' });
  };
  const locationTree = (
    <LocationTree
      active={id}
      onChoose={chooseLocation}
      searchable
      state={treeState}
      onStateChange={changeTreeState}
    />
  );
  return (
    <div className="wb-workspace" ref={workspace.ref}>
      <section className="wb-inventory" aria-label="库存工作台" hidden={mobile && !!inspected}>
        <div className="wb-title">
          <div className="wb-title-copy">
            <Typography.Title level={1}>我的物品</Typography.Title>
            <Typography.Text type="secondary">
              {view.selectedOnly ? '已选范围' : '当前范围'}{' '}
              {new Set(results.map((i) => i.catalog_node_id)).size} 种商品 · {results.length} 件实物
            </Typography.Text>
          </div>
          <Space.Compact className="wb-add-actions">
            <Button
              aria-label="添加物品"
              type="primary"
              icon={<PlusOutlined aria-hidden="true" />}
              disabled={disabled}
              onClick={() => open({ kind: 'intake', parent: id })}
            >
              <span className="wb-add-desktop">添加物品</span>
              <span className="wb-add-mobile">添加</span>
            </Button>
            <Dropdown
              trigger={['click']}
              disabled={disabled}
              menu={{
                items: [
                  { key: 'place', label: '添加位置', icon: <FolderOutlined aria-hidden="true" /> },
                ],
                onClick: () => open({ kind: 'place', parent: id }),
              }}
            >
              <Button
                type="primary"
                disabled={disabled}
                aria-label="更多添加选项"
                icon={<DownOutlined aria-hidden="true" />}
              />
            </Dropdown>
          </Space.Compact>
        </div>
        <InventoryColumns
          inline={inlineLocations}
          width={locationWidth.width}
          max={maxLocationWidth}
          onResize={locationWidth.setWidth}
          onRemember={locationWidth.remember}
          tree={
            <>
              <Typography.Title level={2} className="wb-location-heading">
                位置
              </Typography.Title>
              {locationTree}
            </>
          }
        >
          <div className="wb-toolbar">
            <SearchField
              label={id ? '在当前位置搜索…' : '搜索物品、规格、位置…'}
              value={view.query}
              onChange={changeQuery}
            />
            <Select
              className="stash-group-mode"
              aria-label="分组方式"
              value={view.group}
              onChange={(group) => patch({ group, groupPages: {}, forcedCollapsed: [] })}
              options={[
                { value: 'product', label: '按商品' },
                { value: 'place', label: '按位置' },
                { value: 'date', label: '按日期' },
                { value: 'none', label: '不分组' },
              ]}
            />
            {!inlineLocations && (
              <Button
                id="wb-location-trigger"
                icon={<FolderOutlined aria-hidden="true" />}
                onClick={() => setLocations(true)}
              >
                位置
              </Button>
            )}
            <Popover
              trigger="click"
              title="筛选物品"
              content={
                <div className="stack">
                  <Select
                    aria-label="商品分类"
                    value={view.category}
                    onChange={(category) => patch({ category })}
                    options={[
                      { value: '', label: '全部分类' },
                      ...data.catalog
                        .filter((c) => c.kind === 'GROUP')
                        .map((c) => ({
                          value: c.id,
                          label: ancestors(c.id, data.catalog)
                            .map((a) => a.name)
                            .join(' / '),
                        })),
                    ]}
                  />
                  <Select
                    aria-label="可用性与库存范围"
                    value={view.status}
                    onChange={(status) => patch({ status })}
                    options={[
                      { value: '', label: '全部在库物品' },
                      ...availabilityOptions.map(([v, t]) => ({ value: v || 'unknown', label: t })),
                      { value: 'terminal', label: '历史物品' },
                    ]}
                  />
                  <Select
                    aria-label="库存状态"
                    value={view.lifecycle ?? ''}
                    onChange={(lifecycle) => patch({ lifecycle })}
                    options={[
                      { value: '', label: '库存状态：全部' },
                      { value: 'unknown', label: '库存状态未记录' },
                      ...['ACTIVE', 'CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].map((value) => ({
                        value,
                        label: label(value),
                      })),
                    ]}
                  />
                  <Select
                    aria-label="开封筛选"
                    value={view.opening ?? ''}
                    onChange={(opening) => patch({ opening })}
                    options={[
                      { value: '', label: '开封：全部' },
                      { value: 'unknown', label: '开封未记录' },
                      { value: 'SEALED', label: '未开封' },
                      { value: 'OPENED', label: '已开封' },
                    ]}
                  />
                  <Select
                    aria-label="状况筛选"
                    value={view.condition ?? ''}
                    onChange={(condition) => patch({ condition })}
                    options={[
                      { value: '', label: '状况：全部' },
                      { value: 'unknown', label: '状况未记录' },
                      ...['NEW', 'GOOD', 'WORN', 'DAMAGED', 'BROKEN'].map((value) => ({
                        value,
                        label: label(value),
                      })),
                    ]}
                  />
                  <Button
                    onClick={() =>
                      patch({ status: '', category: '', opening: '', condition: '', lifecycle: '' })
                    }
                  >
                    清除筛选
                  </Button>
                  {mobile && (
                    <label className="stack">
                      排序
                      <Select
                        aria-label="排序"
                        value={view.sort}
                        onChange={(sort) => patch({ sort })}
                        options={[
                          { value: 'name', label: '名称排序' },
                          { value: 'recent', label: '最近入库' },
                        ]}
                      />
                    </label>
                  )}
                </div>
              }
            >
              <Button>
                筛选
                <DownOutlined aria-hidden="true" />
              </Button>
            </Popover>
            {!mobile && (
              <Select
                aria-label="排序"
                value={view.sort}
                onChange={(sort) => patch({ sort })}
                options={[
                  { value: 'name', label: '名称排序' },
                  { value: 'recent', label: '最近入库' },
                ]}
              />
            )}
            {!mobile && view.group === 'none' && (
              <Popover
                trigger="click"
                title="显示列"
                content={
                  <Checkbox.Group
                    className="stack"
                    value={view.columns}
                    options={[
                      { value: 'spec', label: '规格' },
                      { value: 'status', label: '可用性' },
                      { value: 'note', label: '备注' },
                    ]}
                    onChange={(columns) => patch({ columns: columns.map(String), page })}
                  />
                }
              >
                <Button>
                  显示列
                  <DownOutlined aria-hidden="true" />
                </Button>
              </Popover>
            )}
            {mobile && view.group === 'none' && (
              <Button onClick={() => patch({ selecting: !view.selecting, selected: [], page })}>
                {view.selecting ? '取消选择' : '选择'}
              </Button>
            )}
          </div>
          <div
            className="stash-view-bar"
            hidden={
              view.group === 'none' || (!shown.length && (view.group === 'product' || page === 1))
            }
          >
            {view.group !== 'none' && shown.length > 0 && (
              <Checkbox
                aria-label="选择本页全部物品"
                checked={allChecked}
                onChange={selectAll}
                disabled={!shown.length}
              >
                选择当前可见实物
              </Checkbox>
            )}
            {view.group !== 'product' && view.group !== 'none' && page > 1 && (
              <Typography.Text type="secondary">按实物分页，同组可能接续上一页</Typography.Text>
            )}
          </div>
          <div className="stash-attention" aria-label="需要留意">
            <span>需要留意</span>
            {(Object.keys(attentionLabels) as Attention[]).map((a) => (
              <Button
                key={a}
                size="small"
                type={view.attention.includes(a) ? 'primary' : 'default'}
                aria-pressed={view.attention.includes(a)}
                onClick={() =>
                  patch({
                    attention: view.attention.includes(a)
                      ? view.attention.filter((v) => v !== a)
                      : [...view.attention, a],
                    groupPages: {},
                    forcedCollapsed: [],
                  })
                }
              >
                {attentionLabels[a]}{' '}
                {scopeResults.filter((i) => itemAttention(i, data, today).includes(a)).length}
              </Button>
            ))}
            {!!view.attention.length && (
              <Button type="link" size="small" onClick={() => patch({ attention: [] })}>
                清除关注筛选
              </Button>
            )}
            {view.attention.length > 1 && <small>满足任一关注条件</small>}
          </div>
          <div className="wb-location-bar">
            <LocationPath id={id ?? null} rootLabel="全部物品" />
            {id && (
              <Checkbox
                checked={view.descendants}
                onChange={(e) => patch({ descendants: e.target.checked })}
              >
                包含下级位置
              </Checkbox>
            )}
            {place && (
              <Dropdown
                trigger={['click']}
                disabled={disabled}
                menu={{
                  items: [
                    { key: 'rename', label: '修改位置名称' },
                    { key: 'move', label: '移动位置' },
                  ],
                  onClick: ({ key }) => open({ kind: key, target: id }),
                }}
              >
                <Button
                  aria-label="位置操作"
                  icon={<MoreOutlined aria-hidden="true" />}
                  disabled={disabled}
                />
              </Dropdown>
            )}
          </div>
          {(view.query ||
            view.status ||
            view.category ||
            view.opening ||
            view.condition ||
            view.lifecycle) && (
            <Space wrap>
              <Typography.Text type="secondary">
                {view.query
                  ? `“${view.query}” · ${id ? (view.descendants ? '当前位置及下级' : '仅当前位置') : '全家庭'}`
                  : '已筛选'}{' '}
                · {results.length} 件
              </Typography.Text>
              <Button
                type="link"
                onClick={() => {
                  patch({
                    query: '',
                    category: '',
                    status: '',
                    opening: '',
                    condition: '',
                    lifecycle: '',
                  });
                  changeQuery('');
                }}
              >
                清除
              </Button>
            </Space>
          )}
          {selected.length > 0 && (
            <div className="wb-selection-bar">
              <span>
                已选 {selected.length} 件
                {selected.filter((i) => !results.some((r) => r.id === i.id)).length > 0 &&
                  `，其中 ${selected.filter((i) => !results.some((r) => r.id === i.id)).length} 件不在当前结果`}
              </span>
              <Button type="text" onClick={() => patch({ selectedOnly: !view.selectedOnly })}>
                {view.selectedOnly ? '显示全部结果' : '查看已选'}
              </Button>
              <LabelButton
                disabled={!online || stale || selected.length > 100}
                onClick={() => open({ kind: 'print', ids: selected.map((i) => i.id).join(',') })}
              />
              <Button
                disabled={disabled || selected.length > 100}
                onClick={() => open({ kind: 'move', ids: selected.map((i) => i.id).join(',') })}
              >
                移动到…
              </Button>
              <Button
                type="text"
                onClick={() => patch({ selected: [], selecting: false, selectedOnly: false, page })}
              >
                取消选择
              </Button>
              {selected.length > 100 && <Notice>每次最多移动 100 件，请减少选择。</Notice>}
            </div>
          )}
          {view.group !== 'none' ? (
            <StashResults
              groups={shownGroups}
              allGroups={groups}
              productMode={view.group === 'product'}
              data={data}
              selected={view.selected}
              expanded={view.expanded}
              collapsed={view.forcedCollapsed}
              pages={view.groupPages}
              forceExpand={forceExpand}
              query={view.query}
              inspect={inspect}
              toggle={toggle}
              changeExpanded={(group) =>
                patch({
                  ...(forceExpand
                    ? {
                        forcedCollapsed: view.forcedCollapsed.includes(group)
                          ? view.forcedCollapsed.filter((g) => g !== group)
                          : [...view.forcedCollapsed, group],
                      }
                    : {
                        expanded: view.expanded.includes(group)
                          ? view.expanded.filter((g) => g !== group)
                          : [...view.expanded, group],
                      }),
                  page,
                })
              }
              changePage={(group, n) =>
                patch({ groupPages: { ...view.groupPages, [group]: n }, page })
              }
              selectGroup={(items) =>
                patch({
                  selected: [...new Set([...view.selected, ...items.map((i) => i.id)])],
                  selecting: true,
                  page,
                })
              }
            />
          ) : mobile ? (
            <div className="ac-mobile-list">
              {view.selecting && (
                <Checkbox aria-label="选择本页全部物品" checked={allChecked} onChange={selectAll}>
                  本页全选
                </Checkbox>
              )}
              {shown.map((item) => (
                <div key={item.id} className="ac-mobile-item">
                  {view.selecting && (
                    <Checkbox
                      aria-label={`选择 ${itemName(item, data)} ${item.id}`}
                      checked={view.selected.includes(item.id)}
                      disabled={isTerminal(item)}
                      onChange={() => toggle(item)}
                    />
                  )}
                  <Button
                    type="text"
                    className="row"
                    data-inspect-id={item.id}
                    onClick={() => inspect(item)}
                  >
                    <span className="row-copy">
                      <span className="wb-item-heading">
                        <strong>{itemName(item, data)}</strong>
                        {(nameCounts.get(itemName(item, data)) ?? 0) > 1 && (
                          <span className="wb-instance-id" title={item.id}>
                            尾号 {item.id.slice(-8)}
                          </span>
                        )}
                      </span>
                      <span className="wb-item-facts">{itemFacts(item)}</span>
                      <Typography.Text type="secondary">
                        {fullPath(item.parent_id, data).replace(/^全部位置\s*\/\s*/, '')}
                      </Typography.Text>
                    </span>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Table<ItemRecord>
              aria-label="物品列表"
              rowKey="id"
              dataSource={shown}
              pagination={false}
              tableLayout="fixed"
              size="middle"
              rowSelection={{
                selectedRowKeys: view.selected,
                preserveSelectedRowKeys: true,
                columnTitle: (
                  <Checkbox
                    aria-label="选择本页全部物品"
                    checked={allChecked}
                    onChange={selectAll}
                  />
                ),
                onChange: (keys) => patch({ selected: keys.map(String), selecting: true, page }),
                getCheckboxProps: (item) => ({
                  disabled: isTerminal(item),
                  'aria-label': `选择 ${itemName(item, data)} ${item.id}`,
                }),
              }}
              columns={[
                {
                  title: '物品',
                  key: 'name',
                  render: (_, item) => (
                    <Button
                      type="link"
                      className="ac-name-button"
                      data-inspect-id={item.id}
                      onClick={() => inspect(item)}
                    >
                      {itemName(item, data)}
                    </Button>
                  ),
                },
                ...(view.columns.includes('spec')
                  ? [
                      {
                        title: '规格',
                        key: 'spec',
                        ellipsis: true,
                        render: (_: unknown, item: ItemRecord) => specs(item),
                      },
                    ]
                  : []),
                ...(view.columns.includes('status')
                  ? [
                      {
                        title: '状态',
                        key: 'status',
                        width: 100,
                        render: (_: unknown, item: ItemRecord) => <Tag>{itemStatus(item)}</Tag>,
                      },
                    ]
                  : []),
                ...(view.columns.includes('note')
                  ? [
                      {
                        title: '备注',
                        key: 'note',
                        ellipsis: true,
                        render: (_: unknown, item: ItemRecord) =>
                          latestNote(data, item.id)?.body || '—',
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {!shown.length && mobile && view.group === 'none' && (
            <Empty
              title={
                view.query ||
                view.status ||
                view.category ||
                view.opening ||
                view.condition ||
                view.lifecycle
                  ? '没有找到匹配物品'
                  : '这里还没有物品'
              }
            >
              {id && !view.descendants
                ? '可进入下级位置，或选择“包含下级”查看其中物品。'
                : '添加物品，开始整理你的库存。'}
            </Empty>
          )}
          <Pagination
            aria-label="列表分页"
            current={page}
            pageSize={view.pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[20, 50, 100]}
            showTotal={(total, range) =>
              `显示 ${range[0]}–${range[1]} / ${total} ${view.group === 'product' ? '种商品' : '件'}`
            }
            onChange={(next, size) => {
              patch({ page: size !== view.pageSize ? 1 : next, pageSize: size, scroll: 0 });
              setPageScroll(0);
            }}
          />
        </InventoryColumns>
      </section>
      {detail &&
        (inlineDetail ? (
          <aside className="wb-inspector">{detail}</aside>
        ) : mobile ? (
          <section className="ac-full-detail">{detail}</section>
        ) : (
          <Drawer
            open
            title="物品详情"
            size={360}
            onClose={() => inspect()}
            // A responsive inspector must not cover or take focus from an active editor.
            autoFocus={!params.has('dialog')}
            rootStyle={{ display: params.has('dialog') ? 'none' : undefined }}
          >
            {detail}
          </Drawer>
        ))}
      {inspectedId && !inspected && (
        <Notice danger>
          这件物品已不可用。<Button onClick={() => inspect()}>返回列表</Button>
        </Notice>
      )}
      {locations && !inlineLocations && (
        <ActionDrawer title="选择位置" onClose={() => setLocations(false)}>
          {locationTree}
        </ActionDrawer>
      )}
    </div>
  );
}
