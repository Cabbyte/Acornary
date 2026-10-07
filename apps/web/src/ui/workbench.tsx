import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Dropdown,
  Input,
  Layout,
  Menu,
  Pagination,
  Popover,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Timeline,
  Tree,
  Typography,
  type TreeDataNode,
} from 'antd';
import {
  AppstoreOutlined,
  CloseOutlined,
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
import { ActionDrawer, Empty, Notice } from './components';
import { LocationPath, SearchField } from './browser';
import { useViewport } from './theme';
import type { Action } from './forms';
import brand from '../../public/design/workbench/brand.svg?inline';

const navigation = [
  { key: 'items', label: '我的物品', icon: <InboxOutlined aria-hidden="true" /> },
  { key: 'catalog', label: '商品目录', icon: <AppstoreOutlined aria-hidden="true" /> },
  { key: 'settings', label: '设置', icon: <SettingOutlined aria-hidden="true" /> },
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
  const { online, session } = useSession();
  const navigate = useNavigate();
  const { mobile, wide } = useViewport();
  const [collapsed, setCollapsed] = useState(false);
  const active = section === 'places' || section === 'search' ? 'items' : section;
  return (
    <Layout className="workbench-shell">
      <a href="#main" className="skip-link">
        跳到内容
      </a>
      <Layout.Header className="wb-header">
        <Link to="/items" className="wb-brand">
          <img src={brand} alt="" width={36} height={36} />
          <span>
            <strong>松仓</strong>
            <small>Acornary</small>
          </span>
        </Link>
        <Button onClick={() => void navigate({ to: '/settings/household' })}>
          {data.household.name}
          <DownOutlined aria-hidden="true" />
        </Button>
      </Layout.Header>
      <Layout>
        {!mobile && (
          <Layout.Sider
            width={wide ? 224 : 200}
            collapsed={collapsed && !wide}
            collapsedWidth={64}
            className="wb-sidebar"
          >
            {!wide && (
              <Button
                type="text"
                aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
                onClick={() => setCollapsed(!collapsed)}
                icon={
                  collapsed ? (
                    <MenuUnfoldOutlined aria-hidden="true" />
                  ) : (
                    <MenuFoldOutlined aria-hidden="true" />
                  )
                }
              />
            )}
            <Menu
              aria-label="主导航"
              mode="inline"
              selectedKeys={[active]}
              items={navigation.map((n) => ({
                ...n,
                label: <Link to={`/${n.key}`}>{n.label}</Link>,
              }))}
            />
            {(!collapsed || wide) && (
              <>
                <div className="wb-location-heading">
                  <Typography.Text type="secondary">位置</Typography.Text>
                  <Button
                    type="text"
                    icon={<PlusOutlined aria-hidden="true" />}
                    aria-label="新建位置"
                    disabled={!online || stale || session.can_write === false}
                    onClick={() => open({ kind: 'place', parent: place })}
                  />
                </div>
                <LocationTree
                  active={place}
                  onChoose={(id) => void navigate({ to: id ? `/places/${id}` : '/items' })}
                />
              </>
            )}
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
  const [expanded, setExpanded] = useState<string[]>(() =>
    ancestors(active ?? null, data.items).map((i) => i.id),
  );
  useEffect(
    () =>
      setExpanded((old) => [
        ...new Set([...old, ...ancestors(active ?? null, data.items).map((i) => i.id)]),
      ]),
    [active, data.items],
  );
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
      <span title={fullPath(p.id, data)}>
        {query ? fullPath(p.id, data) : itemName(p, data)}{' '}
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
    <div className="stack">
      {searchable && (
        <SearchField
          value={query}
          onChange={setQuery}
          label={moving ? '搜索目标位置' : '搜索位置'}
        />
      )}
      <Button type={!(selected ?? active) ? 'primary' : 'text'} onClick={() => onChoose('')}>
        {moving ? '未指定位置' : '全部物品'}
      </Button>
      <Tree
        aria-label={moving ? '目标位置' : '位置树'}
        blockNode
        showIcon
        treeData={treeData}
        expandedKeys={expanded}
        onExpand={(keys) => setExpanded(keys.map(String))}
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
};
const views = new Map<string, View>();
let householdScope = '';
const defaults = (): View => ({
  query: '',
  descendants: false,
  status: '',
  category: '',
  sort: 'name',
  page: 1,
  pageSize: WORKBENCH_PAGE_SIZE,
  selected: [],
  selecting: false,
  columns: ['spec', 'status', 'place', 'note'],
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
    return views.get(key) ?? defaults();
  });
  const [locations, setLocations] = useState(false);
  const params = new URLSearchParams(location.searchStr);
  const inspectedId = detailId ?? params.get('item');
  const inspected = data.items.find((i) => i.id === inspectedId);
  const patch = (values: Partial<View>) => setView((old) => ({ ...old, page: 1, ...values }));
  useEffect(() => {
    views.set(key, view);
  }, [key, view]);
  const current = useRef(view);
  current.current = view;
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo(0, inspectedId && mobile ? 0 : current.current.scroll),
    );
    return () => cancelAnimationFrame(frame);
  }, [inspectedId]);
  useEffect(() => {
    const scroll = () => {
      if (!inspectedId) {
        const next = { ...current.current, scroll: window.scrollY };
        current.current = next;
        views.set(key, next);
      }
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
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
  const results = useMemo(
    () => workbenchItems(data, id, view),
    [data, id, view.query, view.descendants, view.status, view.category, view.sort],
  );
  const page = Math.min(view.page, Math.max(1, Math.ceil(results.length / view.pageSize)));
  const shown = results.slice((page - 1) * view.pageSize, page * view.pageSize);
  const place = data.items.find((i) => i.id === id && isContainer(i));
  const childPlaces = data.items.filter(
    (i) => isContainer(i) && !isTerminal(i) && i.parent_id === (id ?? null),
  );
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
    if (item) setView((old) => ({ ...old, scroll: window.scrollY }));
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
    patch({ query });
    if (globalQuery !== null) {
      const next = Object.fromEntries(params);
      if (query) next.q = query;
      else delete next.q;
      void navigate({ to: location.pathname, search: next, replace: true });
    }
  };
  const detail = inspected ? (
    <ItemInspector item={inspected} open={open} close={() => inspect()} />
  ) : null;
  return (
    <div className="wb-workspace">
      <section className="wb-inventory" aria-label="库存工作台" hidden={mobile && !!inspected}>
        <Space wrap>
          {mobile && (
            <Button icon={<FolderOutlined aria-hidden="true" />} onClick={() => setLocations(true)}>
              位置
            </Button>
          )}
          <LocationPath id={id ?? null} />
        </Space>
        <div className="wb-title">
          <div>
            <Typography.Title level={2}>
              {place ? itemName(place, data) : '我的物品'}
            </Typography.Title>
            <Typography.Text type="secondary">{results.length} 件物品</Typography.Text>
          </div>
          <Button
            type="primary"
            icon={<PlusOutlined aria-hidden="true" />}
            disabled={disabled}
            onClick={() => open({ kind: 'intake', parent: id })}
          >
            添加物品
          </Button>
          {place && (
            <Dropdown
              menu={{
                items: [
                  { key: 'place', label: '新建下级位置' },
                  { key: 'rename', label: '修改位置名称' },
                  { key: 'move', label: '移动位置' },
                ],
                onClick: ({ key }) =>
                  open({
                    kind: key,
                    parent: key === 'place' ? id : undefined,
                    target: key !== 'place' ? id : undefined,
                  }),
              }}
              disabled={disabled}
            >
              <Button aria-label="位置操作" icon={<MoreOutlined aria-hidden="true" />} />
            </Dropdown>
          )}
        </div>
        <div className="wb-toolbar">
          <SearchField
            label={id ? '在当前位置搜索…' : '搜索物品、规格、位置…'}
            value={view.query}
            onChange={changeQuery}
          />
          {id && (
            <Select
              aria-label="位置范围"
              value={view.descendants ? 'all' : 'direct'}
              onChange={(value) => patch({ descendants: value === 'all' })}
              options={[
                { value: 'direct', label: '仅当前位置' },
                { value: 'all', label: '包含下级' },
              ]}
            />
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
                  aria-label="物品状态"
                  value={view.status}
                  onChange={(status) => patch({ status })}
                  options={[
                    { value: '', label: '全部在库状态' },
                    ...availabilityOptions.map(([v, t]) => ({ value: v || 'unknown', label: t })),
                    { value: 'terminal', label: '历史物品' },
                  ]}
                />
                <Button onClick={() => patch({ status: '', category: '' })}>清除筛选</Button>
              </div>
            }
          >
            <Button>
              筛选
              <DownOutlined aria-hidden="true" />
            </Button>
          </Popover>
          <Select
            aria-label="排序"
            value={view.sort}
            onChange={(sort) => patch({ sort })}
            options={[
              { value: 'name', label: '名称排序' },
              { value: 'recent', label: '最近入库' },
            ]}
          />
          {!mobile && (
            <Popover
              trigger="click"
              title="显示列"
              content={
                <Checkbox.Group
                  className="stack"
                  value={view.columns}
                  options={[
                    { value: 'spec', label: '规格' },
                    { value: 'status', label: '状态' },
                    { value: 'place', label: '收纳位置' },
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
          {mobile && (
            <Button onClick={() => patch({ selecting: !view.selecting, selected: [], page })}>
              {view.selecting ? '取消选择' : '选择'}
            </Button>
          )}
        </div>
        {(view.query || view.status || view.category) && (
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
                patch({ query: '', category: '', status: '' });
                changeQuery('');
              }}
            >
              清除
            </Button>
          </Space>
        )}
        {!!childPlaces.length && !view.query && (
          <Space wrap aria-label="下级位置">
            {childPlaces.map((p) => (
              <Link key={p.id} to={`/places/${p.id}`}>
                <Tag icon={<FolderOutlined aria-hidden="true" />}>{itemName(p, data)}</Tag>
              </Link>
            ))}
          </Space>
        )}
        {selected.length > 0 && (
          <div className="wb-selection-bar">
            <span>已选 {selected.length} 件</span>
            <Button
              disabled={disabled || selected.length > 100}
              onClick={() => open({ kind: 'move', ids: selected.map((i) => i.id).join(',') })}
            >
              移动到…
            </Button>
            <Button type="text" onClick={() => patch({ selected: [], selecting: false, page })}>
              取消选择
            </Button>
            {selected.length > 100 && <Notice>每次最多移动 100 件，请减少选择。</Notice>}
          </div>
        )}
        {mobile ? (
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
                <Button type="text" className="row" onClick={() => inspect(item)}>
                  <span className="row-copy">
                    <strong>{itemName(item, data)}</strong>
                    <Typography.Text type="secondary">
                      {specs(item)} · {itemStatus(item)} · {fullPath(item.parent_id, data)}
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
                <Checkbox aria-label="选择本页全部物品" checked={allChecked} onChange={selectAll} />
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
                  <Button type="link" className="ac-name-button" onClick={() => inspect(item)}>
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
              ...(view.columns.includes('place')
                ? [
                    {
                      title: '收纳位置',
                      key: 'place',
                      ellipsis: true,
                      render: (_: unknown, item: ItemRecord) => fullPath(item.parent_id, data),
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
        {!shown.length && mobile && (
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
        <Pagination
          aria-label="列表分页"
          current={page}
          pageSize={view.pageSize}
          total={results.length}
          showSizeChanger
          pageSizeOptions={[20, 50, 100]}
          showTotal={(total, range) => `显示 ${range[0]}–${range[1]} / ${total} 件`}
          onChange={(next, size) => {
            patch({ page: size !== view.pageSize ? 1 : next, pageSize: size, scroll: 0 });
            window.scrollTo(0, 0);
          }}
        />
      </section>
      {detail &&
        (wide ? (
          <aside className="wb-inspector">{detail}</aside>
        ) : mobile ? (
          <section className="ac-full-detail">{detail}</section>
        ) : (
          <Drawer open title="物品详情" size={360} onClose={() => inspect()}>
            {detail}
          </Drawer>
        ))}
      {inspectedId && !inspected && (
        <Notice danger>
          这件物品已不可用。<Button onClick={() => inspect()}>返回列表</Button>
        </Notice>
      )}
      {locations && (
        <ActionDrawer title="选择位置" onClose={() => setLocations(false)}>
          <LocationTree
            active={id}
            onChoose={(target) => {
              setLocations(false);
              void navigate({ to: target ? `/places/${target}` : '/items' });
            }}
            searchable
          />
          <Button
            disabled={disabled}
            onClick={() => {
              setLocations(false);
              open({ kind: 'place', parent: id });
            }}
          >
            新建位置
          </Button>
        </ActionDrawer>
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
    queryFn: ({ signal }) => history(item.id, 'ITEM', undefined, signal),
    enabled: online && !stale,
  });
  const disabled = !online || stale || session.can_write === false;
  return (
    <div className="stack" aria-label="物品详情">
      <Space wrap>
        <Button onClick={close}>返回列表</Button>
        <Button
          type="text"
          aria-label="关闭详情"
          icon={<CloseOutlined aria-hidden="true" />}
          onClick={close}
        />
        <Link to={`/items/${item.id}/details`}>更多资料与操作</Link>
      </Space>
      <Typography.Title level={3}>{itemName(item, data)}</Typography.Title>
      <Typography.Text type="secondary">{specification(sku) || '规格未记录'}</Typography.Text>
      <Tag>{itemStatus(item)}</Tag>
      <Space>
        <Button
          disabled={disabled || isTerminal(item)}
          onClick={() => open({ kind: 'move', target: item.id })}
        >
          移动
        </Button>
        <Button
          id={`edit-item-${item.id}`}
          disabled={disabled}
          onClick={(event) => {
            // Safari does not focus buttons on pointer activation; retain the return target.
            event.currentTarget.focus({ preventScroll: true });
            open({ kind: 'edit', target: item.id, note: note?.id });
          }}
        >
          编辑
        </Button>
      </Space>
      <Descriptions
        title="物品资料"
        column={1}
        items={[
          { key: 'place', label: '位置', children: <LocationPath id={item.parent_id} /> },
          {
            key: 'id',
            label: '编号',
            children: (
              <Typography.Text className="ac-identity" copyable>
                {item.id}
              </Typography.Text>
            ),
          },
          { key: 'spec', label: '规格', children: specification(sku) || '未记录' },
          { key: 'date', label: '购入日期', children: life?.acquisition?.acquired_on || '未记录' },
          ...(attr(item, 'contents')?.remaining
            ? [{ key: 'remaining', label: '剩余量', children: remaining(item) }]
            : []),
        ]}
      />
      <Card size="small" title="备注">
        {note?.body || '未记录'}
      </Card>
      <Card size="small" title="最近动态">
        {events.isFetching ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (
          <Timeline
            items={events.data?.data.slice(0, 3).map((event) => ({
              key: event.id,
              content: (
                <>
                  <Typography.Text type="secondary">{time(event.occurred_at)}</Typography.Text>
                  <p>{eventNames[event.event_type] ?? event.event_type}</p>
                </>
              ),
            }))}
          />
        )}
        {events.isError && (
          <Button onClick={() => void events.refetch()}>动态读取失败，重试</Button>
        )}
        {!online && <Typography.Text type="secondary">联网后可查看最新动态</Typography.Text>}
        <Link to={`/items/${item.id}/history`}>查看全部动态</Link>
      </Card>
      <Link
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
  );
}
