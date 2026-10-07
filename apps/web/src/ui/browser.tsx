import {
  Breadcrumb,
  Button,
  Checkbox,
  Input,
  Pagination,
  Popover,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import {
  ancestors,
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
import { Empty, FormField } from './components';
import { useViewport } from './theme';
import type { Action } from './forms';

type BrowseState = {
  query: string;
  scope: string;
  state: string;
  category: string;
  sort: string;
  columns: string[];
  page: number;
  pageSize: number;
  scroll: number;
  selected: string[];
  selecting: boolean;
};
const views = new Map<string, BrowseState>();
export function clearBrowseSelections() {
  for (const [key, view] of views) views.set(key, { ...view, selected: [], selecting: false });
}
export function useBrowseState(view: string, scope = '') {
  const { session } = useSession();
  const key = `${session.cache_key}:${view}`;
  const defaults = (): BrowseState =>
    views.get(key) ?? {
      query: '',
      scope,
      state: 'current',
      category: '',
      sort: 'name',
      columns: ['spec', 'place', 'remaining', 'category', 'count'],
      page: 1,
      pageSize: PAGE_SIZE,
      scroll: 0,
      selected: [],
      selecting: false,
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
      const next = {
        ...current.current,
        ...old,
        scroll: current.current.scroll,
        page: 1,
        ...patch,
      };
      views.set(key, next);
      return next;
    });
  return [state, update] as const;
}
export function ListOptions({
  view,
  update,
  catalog = false,
}: {
  view: BrowseState;
  update: (patch: Partial<BrowseState>) => void;
  catalog?: boolean;
}) {
  const { mobile } = useViewport();
  return (
    <>
      <Select
        aria-label="排序"
        value={view.sort}
        onChange={(sort) => update({ sort })}
        options={[
          { value: 'name', label: '名称排序' },
          { value: 'recent', label: catalog ? '库存数量排序' : '最近入库' },
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
              onChange={(columns) => update({ columns: columns.map(String), page: view.page })}
              options={(catalog
                ? [
                    ['spec', '规格'],
                    ['category', '分类'],
                    ['count', '在库实物'],
                  ]
                : [
                    ['spec', '规格'],
                    ['place', '收纳位置'],
                    ['remaining', '剩余'],
                  ]
              ).map(([value, label]) => ({ value, label }))}
            />
          }
        >
          <Button>显示列</Button>
        </Popover>
      )}
    </>
  );
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
    <Input
      className="ac-search"
      type="search"
      aria-label={label}
      placeholder={label}
      prefix={<SearchOutlined aria-hidden="true" />}
      allowClear={{ clearIcon: <span aria-label="清除搜索">×</span> }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
export function LocationPath({ id }: { id: string | null }) {
  const { data } = useInventory();
  return (
    <Breadcrumb
      aria-label="完整位置路径"
      items={[
        { title: <Link to="/items">全部位置</Link> },
        ...ancestors(id, data.items).map((p) => ({
          key: p.id,
          title: <Link to={`/places/${p.id}`}>{itemName(p, data)}</Link>,
        })),
      ]}
    />
  );
}
export function PageEnd({
  total,
  page,
  pageSize,
  onChange,
  unit = '条',
}: {
  total: number;
  page: number;
  pageSize: number;
  onChange: (page: number, pageSize: number) => void;
  unit?: string;
}) {
  return (
    <Pagination
      aria-label="列表分页"
      current={Math.min(page, Math.max(1, Math.ceil(total / pageSize)))}
      pageSize={pageSize}
      total={total}
      showSizeChanger
      pageSizeOptions={[20, 50, 100]}
      showTotal={(count, range) => `显示 ${range[0]}–${range[1]} / ${count} ${unit}`}
      onChange={(next, size) => onChange(size !== pageSize ? 1 : next, size)}
    />
  );
}
export function PhysicalRow({ item, path = false }: { item: ItemRecord; path?: boolean }) {
  const { data } = useInventory();
  const location = useLocation();
  const sku = data.catalog.find((c) => c.id === item.catalog_node_id);
  const container = isContainer(item);
  return (
    <Link
      className="row"
      to={container ? `/places/${item.id}` : `/items/${item.id}/details`}
      search={{ returnTo: location.pathname + location.searchStr }}
    >
      <span className="row-copy">
        <strong>{itemName(item, data)}</strong>
        <Typography.Text type="secondary">
          {container ? '位置' : specification(sku) || '规格未记录'}
          {path && ` · ${fullPath(item.parent_id, data)}`}
        </Typography.Text>
        <small className="item-identity">{container ? '' : `实物 ${item.id}`}</small>
      </span>
      <span className="row-detail">
        {container
          ? `${physicalItems(data.items.filter((i) => i.parent_id === item.id && !isTerminal(i))).length} 件实物`
          : isTerminal(item)
            ? '历史记录'
            : remaining(item)}
      </span>
    </Link>
  );
}
export function ItemTable({
  items,
  selected,
  onSelection,
  columns = ['spec', 'place', 'remaining'],
}: {
  items: ItemRecord[];
  selected?: string[];
  onSelection?: (ids: string[]) => void;
  columns?: string[];
}) {
  const { data } = useInventory();
  const { mobile } = useViewport();
  const location = useLocation();
  const ids = items.filter((i) => !isTerminal(i)).map((i) => i.id);
  const all = !!ids.length && ids.every((id) => selected?.includes(id));
  const selectAll = () =>
    onSelection?.(
      all
        ? (selected ?? []).filter((id) => !ids.includes(id))
        : [...new Set([...(selected ?? []), ...ids])],
    );
  if (mobile)
    return (
      <div className="ac-mobile-list">
        {onSelection && (
          <Checkbox aria-label="选择本页全部物品" checked={all} onChange={selectAll}>
            本页全选
          </Checkbox>
        )}
        {items.map((item) => (
          <div className="ac-mobile-item" key={item.id}>
            {onSelection && (
              <Checkbox
                aria-label={`选择 ${itemName(item, data)} ${item.id}`}
                disabled={isTerminal(item)}
                checked={selected?.includes(item.id)}
                onChange={(e) =>
                  onSelection(
                    e.target.checked
                      ? [...(selected ?? []), item.id]
                      : (selected ?? []).filter((id) => id !== item.id),
                  )
                }
              />
            )}
            <PhysicalRow item={item} path />
          </div>
        ))}
      </div>
    );
  return (
    <Table<ItemRecord>
      aria-label="实物列表"
      rowKey="id"
      dataSource={items}
      pagination={false}
      tableLayout="fixed"
      rowSelection={
        onSelection
          ? {
              selectedRowKeys: selected,
              preserveSelectedRowKeys: true,
              columnTitle: (
                <Checkbox aria-label="选择本页全部物品" checked={all} onChange={selectAll} />
              ),
              onChange: (keys) => onSelection(keys.map(String)),
              getCheckboxProps: (item) => ({
                disabled: isTerminal(item),
                'aria-label': `选择 ${itemName(item, data)} ${item.id}`,
              }),
            }
          : undefined
      }
      columns={[
        {
          title: '物品',
          key: 'name',
          render: (_, item) => (
            <Link
              to={isContainer(item) ? `/places/${item.id}` : `/items/${item.id}/details`}
              search={{ returnTo: location.pathname + location.searchStr }}
            >
              {itemName(item, data)}
            </Link>
          ),
        },
        {
          title: '规格',
          key: 'spec',
          hidden: !columns.includes('spec'),
          ellipsis: true,
          render: (_, item) =>
            isContainer(item)
              ? '位置'
              : specification(data.catalog.find((c) => c.id === item.catalog_node_id)) ||
                '规格未记录',
        },
        {
          title: '收纳位置',
          key: 'place',
          hidden: !columns.includes('place'),
          ellipsis: true,
          render: (_, item) => fullPath(item.parent_id, data),
        },
        {
          title: '剩余',
          key: 'remaining',
          hidden: !columns.includes('remaining'),
          render: (_, item) => (isTerminal(item) ? '历史记录' : remaining(item)),
        },
      ]}
    />
  );
}
export function InventorySearch() {
  const { data } = useInventory();
  const [view, update] = useBrowseState('search');
  const results = searchInventory(data, view.query, view.scope, view.state, view.category).sort(
    (a, b) =>
      view.sort === 'recent'
        ? b.created_at.localeCompare(a.created_at)
        : itemName(a, data).localeCompare(itemName(b, data), 'zh-CN'),
  );
  const page = Math.min(view.page, Math.max(1, Math.ceil(results.length / view.pageSize)));
  const shown = results.slice((page - 1) * view.pageSize, page * view.pageSize);
  return (
    <div className="ac-page">
      <header className="page-header">
        <Typography.Title level={2}>搜索</Typography.Title>
      </header>
      <div className="ac-toolbar">
        <SearchField
          value={view.query}
          onChange={(query) => update({ query })}
          label="搜索物品、规格或位置"
        />
        <FormField label="搜索范围">
          <Select
            value={view.scope}
            onChange={(scope) => update({ scope })}
            options={[
              { value: '', label: '全家庭' },
              ...data.items
                .filter(isContainer)
                .map((i) => ({ value: i.id, label: `${fullPath(i.id, data)}及下级位置` })),
            ]}
          />
        </FormField>
        <FormField label="库存状态">
          <Select
            value={view.state}
            onChange={(state) => update({ state })}
            options={[
              ['current', '当前库存'],
              ['all', '全部记录'],
              ['OPENED', '已开封'],
              ['SEALED', '未开封'],
              ['unknown', '开封未记录'],
              ['terminal', '历史物品'],
            ].map(([value, label]) => ({ value, label }))}
          />
        </FormField>
        <FormField label="商品分类">
          <Select
            value={view.category}
            onChange={(category) => update({ category })}
            options={[
              { value: '', label: '全部分类' },
              ...data.catalog
                .filter((c) => c.kind === 'GROUP')
                .map((c) => ({ value: c.id, label: [categoryPath(c, data), c.name].join(' / ') })),
            ]}
          />
        </FormField>
        <ListOptions view={view} update={update} />
      </div>
      <Typography.Text type="secondary">
        {physicalItems(results).length} 件实物 · {results.filter(isContainer).length} 个位置
      </Typography.Text>
      <ItemTable items={shown} columns={view.columns} />
      {!results.length && <Empty title="没有找到匹配结果">清除关键词或扩大搜索范围。</Empty>}
      <PageEnd
        total={results.length}
        page={page}
        pageSize={view.pageSize}
        onChange={(page, pageSize) => update({ page, pageSize })}
      />
    </div>
  );
}
export function ProductCatalog({ open }: { open: (action: Action) => void }) {
  const { data, stale } = useInventory();
  const { online, session } = useSession();
  const location = useLocation();
  const { mobile } = useViewport();
  const [view, update] = useBrowseState('catalog');
  const count = (id: string) =>
    physicalItems(data.items.filter((i) => i.catalog_node_id === id && !isTerminal(i))).length;
  const products = visibleProducts(data)
    .filter(
      (c) => !view.category || ancestors(c.id, data.catalog).some((a) => a.id === view.category),
    )
    .filter((c) =>
      `${c.name} ${specification(c)}`
        .toLocaleLowerCase()
        .includes(view.query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      view.sort === 'recent' ? count(b.id) - count(a.id) : a.name.localeCompare(b.name, 'zh-CN'),
    );
  const page = Math.min(view.page, Math.max(1, Math.ceil(products.length / view.pageSize)));
  const shown = products.slice((page - 1) * view.pageSize, page * view.pageSize);

  return (
    <div className="ac-page">
      <header className="page-header">
        <div>
          <Typography.Title level={2}>商品目录</Typography.Title>
          <Typography.Text type="secondary">{products.length} 款商品</Typography.Text>
        </div>
        <Space wrap>
          <Link to="/catalog/manage">管理商品资料</Link>
          <Button
            type="primary"
            disabled={!online || stale || session.can_write === false}
            onClick={() => open({ kind: 'catalog' })}
          >
            新增商品
          </Button>
        </Space>
      </header>
      <div className="ac-toolbar">
        <SearchField
          value={view.query}
          onChange={(query) => update({ query })}
          label="搜索商品名称或规格"
        />
        <Select
          aria-label="商品分类"
          value={view.category}
          onChange={(category) => update({ category })}
          options={[
            { value: '', label: '全部分类' },
            ...data.catalog
              .filter((c) => c.kind === 'GROUP')
              .map((c) => ({ value: c.id, label: categoryPath(c, data) + ' / ' + c.name })),
          ]}
        />
        <ListOptions view={view} update={update} catalog />
      </div>
      {mobile ? (
        <div className="ac-mobile-list">
          {shown.map((sku) => (
            <Link
              key={sku.id}
              className="row"
              to={`/items/group/${sku.id}`}
              search={{ returnTo: location.pathname }}
            >
              <span className="row-copy">
                <strong>{sku.name}</strong>
                <Typography.Text type="secondary">
                  {specification(sku) || '规格未记录'} · {categoryPath(sku, data)}
                </Typography.Text>
              </span>
              <span className="row-detail">{count(sku.id)} 件实物</span>
            </Link>
          ))}
        </div>
      ) : (
        <Table
          rowKey="id"
          pagination={false}
          dataSource={shown}
          tableLayout="fixed"
          columns={[
            {
              title: '商品',
              key: 'name',
              render: (_, sku) => (
                <Link to={`/items/group/${sku.id}`} search={{ returnTo: location.pathname }}>
                  {sku.name}
                </Link>
              ),
            },
            {
              title: '规格',
              key: 'spec',
              hidden: !view.columns.includes('spec'),
              ellipsis: true,
              render: (_, sku) => specification(sku) || '规格未记录',
            },
            {
              title: '分类',
              key: 'category',
              hidden: !view.columns.includes('category'),
              ellipsis: true,
              render: (_, sku) => categoryPath(sku, data),
            },
            {
              title: '在库实物',
              key: 'count',
              hidden: !view.columns.includes('count'),
              render: (_, sku) => `${count(sku.id)} 件实物`,
            },
          ]}
        />
      )}
      {!products.length && mobile && <Empty title="没有找到商品" />}
      <PageEnd
        total={products.length}
        page={page}
        pageSize={view.pageSize}
        unit="款商品"
        onChange={(page, pageSize) => update({ page, pageSize })}
      />
    </div>
  );
}
