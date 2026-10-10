import { LabelButton } from './ui/label-button';
import { itemDate } from './lib/labels';
import { Card } from 'antd';
import { Button, Checkbox, Input, Select, Descriptions, Timeline } from 'antd';
import appIcon from '../public/app-icon.png';
import { SearchOutlined } from '@ant-design/icons';
import { AccountSettings, HouseholdSettings } from './accounts';
import { useEffect, useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import {
  ancestors,
  attr,
  inventoryFilterSchema,
  isContainer,
  isTerminal,
  itemName,
  locationName,
  productGroups,
  type InventoryFilter,
  type ProductGroup,
} from '../../../packages/contracts/src/web';
import type { TemplateId } from '../../../packages/contracts/src/index';
import { useInventory } from './lib/inventory';
import { useSession } from './lib/session';
import { history, request } from './lib/api';
import { persist, stored } from './lib/storage';
import {
  amount,
  eventNames,
  itemTitle,
  label,
  pieceUnit,
  remaining,
  time,
  total,
} from './lib/presentation';
import { Empty, FormField, Notice, Row, ActionDrawer } from './ui/components';
import { definitions, fieldValues, templateLabels } from './ui/fields';
import type { Action } from './ui/forms';
import {
  ListOptions,
  SearchField,
  LocationPath,
  PhysicalRow,
  ItemTable,
  PageEnd,
  useBrowseState,
} from './ui/browser';
import { PAGE_SIZE, specification, categoryPath, searchInventory } from './lib/browse';
export type OpenAction = (action: Action) => void;
function groupSubtitle(
  group: ProductGroup,
  data: import('../../../packages/contracts/src/web').InventoryData,
) {
  const selected = new Set(group.item_ids);
  const items = data.items.filter((item) => selected.has(item.id));
  if (group.totals.length) {
    const location =
      group.locations === 1 && items[0]
        ? locationName(items[0], data)
        : `${group.locations} 个位置`;
    return `${location} · ${group.opened ? `${group.opened} 件已开封 · ` : ''}剩余 ${total(group)}`;
  }
  const positions = new Map<string, string[]>();
  for (const item of items) {
    const parent = data.items.find((p) => p.id === item.parent_id);
    const name = parent ? itemName(parent, data) : '未记录位置';
    positions.set(name, [...(positions.get(name) ?? []), item.id]);
  }
  return (
    [...positions]
      .map(([name, ids]) => `${name}${items.length > 1 ? ` ${ids.length} 件` : ''}`)
      .join(' · ') || '未记录位置'
  );
}
export function Home({ open }: { open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online, session } = useSession();
  const [filter, setFilter] = useState<InventoryFilter>(inventoryFilterSchema.parse({}));
  const [sheet, setSheet] = useState(false);
  const [debounced, setDebounced] = useState(filter);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(filter), 180);
    return () => clearTimeout(timer);
  }, [filter]);
  const filtered = useQuery({
    queryKey: ['groups', session.cache_key, debounced, data.cached_at],
    queryFn: () => request<ProductGroup[]>(`/api/ui/groups?${new URLSearchParams(debounced)}`),
    enabled: online && !stale,
    retry: false,
    staleTime: 30000,
  });
  const local = productGroups(data, filter);
  const groups =
    JSON.stringify(filter) === JSON.stringify(debounced) && filtered.data ? filtered.data : local;
  const update = (key: keyof InventoryFilter, value: string) =>
    setFilter((f) => ({ ...f, [key]: value }));
  return (
    <>
      <header className="page-header large">
        <div className="toolbar">
          <span />
          <Button
            className="icon-button"
            aria-label="入库"
            disabled={!online || stale}
            onClick={() => open({ kind: 'intake' })}
          >
            ＋
          </Button>
        </div>
        <h1>我的物品</h1>
        <p>
          {groups.length} 种商品 · {groups.reduce((n, g) => n + g.count, 0)} 件实物
        </p>
      </header>
      <div className="content">
        <label className="search">
          <SearchOutlined aria-hidden="true" />
          <Input
            aria-label="搜索物品"
            placeholder="搜索物品、品牌或名称"
            value={filter.search}
            onChange={(e) => update('search', e.target.value)}
          />
          {filter.search && (
            <Button aria-label="清除搜索" onClick={() => update('search', '')}>
              ×
            </Button>
          )}
        </label>
        <div className="chips">
          <Button className={!filter.category ? 'selected' : ''} onClick={() => setSheet(true)}>
            {filter.category ? '已选分类' : '全部物品'}
          </Button>
          <Button className={filter.location ? 'selected' : ''} onClick={() => setSheet(true)}>
            {filter.location ? '已选位置' : '存放位置'}
          </Button>
          <Button
            className={filter.state !== 'current' ? 'selected' : ''}
            onClick={() => setSheet(true)}
          >
            {filter.state === 'current' ? '状态筛选' : label(filter.state)}
          </Button>
        </div>
        {filtered.error && !stale && <Notice>筛选结果暂用上次缓存。请刷新后核对最新库存。</Notice>}
        <p className="section-label">你的松仓</p>
        {groups.length ? (
          <div className="grouped">
            {groups.map((g) => (
              <Row
                key={g.id}
                title={g.name}
                subtitle={groupSubtitle(g, data)}
                detail={`${g.count} ${pieceUnit(data.catalog.find((c) => c.id === g.id))}`}
                to={`/items/group/${g.id}`}
              />
            ))}
          </div>
        ) : (
          <Empty
            title={data.items.some((i) => !isContainer(i)) ? '没有找到物品' : '从第一件物品开始'}
          >
            {data.items.some((i) => !isContainer(i))
              ? '试试其他关键词，或放宽筛选条件。'
              : '轻点右上角 ＋，把家里的物品放进松仓。'}
          </Empty>
        )}
        {sheet && (
          <ActionDrawer title="筛选物品" onClose={() => setSheet(false)}>
            <div className="stack">
              <FormField label="分类">
                <Select
                  value={filter.category}
                  onChange={(e) => update('category', e)}
                  options={[
                    { value: '', label: '\u5168\u90E8\u5206\u7C7B' },
                    ...(data.catalog
                      .filter((c) => c.kind === 'GROUP')
                      .map((c) => ({
                        value: c.id,
                        label: ancestors(c.id, data.catalog)
                          .map((x) => x.name)
                          .join(' / '),
                      })) ?? []),
                  ]}
                />
              </FormField>
              <FormField label="存放位置">
                <Select
                  value={filter.location}
                  onChange={(e) => update('location', e)}
                  options={[
                    { value: '', label: '\u5168\u90E8\u4F4D\u7F6E' },
                    ...(data.items.filter(isContainer).map((i) => ({
                      value: i.id,
                      label: ancestors(i.id, data.items)
                        .map((x) => itemName(x, data))
                        .join(' / '),
                    })) ?? []),
                  ]}
                />
              </FormField>
              <FormField label="状态">
                <Select
                  value={filter.state}
                  onChange={(e) => update('state', e)}
                  options={[
                    ...([
                      ['current', '当前库存（包含状态未记录）'],
                      ['all', '全部记录'],
                      ['OPENED', '已开封'],
                      ['SEALED', '未开封'],
                      ['unknown', '开封状态未记录'],
                      ['terminal', '已用完、丢弃或归档'],
                    ].map(([v, t]) => ({ value: v, label: t })) ?? []),
                  ]}
                />
              </FormField>
              <Button onClick={() => setSheet(false)} htmlType="button" type="primary">
                查看结果
              </Button>
              <Button
                onClick={() => setFilter(inventoryFilterSchema.parse({}))}
                htmlType="button"
                type="default"
              >
                重置筛选
              </Button>
            </div>
          </ActionDrawer>
        )}
      </div>
    </>
  );
}
export function PageHeader({
  title,
  subtitle,
  back = '/items',
}: {
  title: string;
  subtitle?: string;
  back?: string;
}) {
  const location = useLocation();
  const requested = new URLSearchParams(location.searchStr).get('returnTo');
  const destination =
    requested && /^\/(items|places|catalog|search)(\/|\?|$)/.test(requested) ? requested : back;
  return (
    <header className="page-header">
      <div className="toolbar">
        <Link to={destination} className="icon-button" aria-label="返回">
          ‹
        </Link>
        <h1>{title}</h1>
        <span className="toolbar-spacer" />
      </div>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}
export function Product({ id, open }: { id: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const sku = data.catalog.find((c) => c.id === id);
  const [view, updateView] = useBrowseState(`product:${id}`);
  const showPast = view.state === 'all';
  const setShowPast = (value: boolean) => updateView({ state: value ? 'all' : 'current' });
  const selection = view.selected;
  const setSelection = (selected: string[]) => updateView({ selected, page: view.page });
  const selecting = view.selecting;
  const setSelecting = (selecting: boolean) => updateView({ selecting, page: view.page });
  if (!sku) return <Empty title="商品不可用">请返回物品列表刷新。</Empty>;
  const group = productGroups(data, inventoryFilterSchema.parse({})).find((g) => g.id === id);
  const items = searchInventory(data, view.query, view.scope, showPast ? 'all' : 'current')
    .filter((i) => i.catalog_node_id === id)
    .sort((a, b) =>
      view.sort === 'recent'
        ? b.created_at.localeCompare(a.created_at)
        : itemName(a, data).localeCompare(itemName(b, data), 'zh-CN'),
    );
  const page = Math.min(view.page, Math.max(1, Math.ceil(items.length / view.pageSize)));
  const visible = items.slice((page - 1) * view.pageSize, page * view.pageSize);
  return (
    <>
      <PageHeader
        title={sku.name}
        back="/catalog"
        subtitle={`商品汇总 · ${attr(sku, 'product')?.specification ?? '包装规格未记录'}`}
      />
      <div className="content">
        <Card className="card">
          <h2>
            家里还有 {group?.count ?? 0} {pieceUnit(sku)}
          </h2>
          <p className="quantity">{group ? '剩余 ' + total(group) : '当前没有在库实物'}</p>
          {group && (
            <p className="muted">
              已开封 {group.opened} 件 · 未开封 {group.sealed} 件<br />
              开封状态未记录 {group.unknown_opening} 件
              {group.unknown_lifecycle > 0 && (
                <>
                  <br />
                  {group.unknown_lifecycle} 件生命周期未记录
                </>
              )}
            </p>
          )}
          <Button
            disabled={!online || stale}
            onClick={() => open({ kind: 'intake', target: id })}
            htmlType="button"
            type="default"
          >
            再入库几件
          </Button>
        </Card>
        <div className="ac-toolbar">
          <SearchField
            label="搜索同款实物"
            value={view.query}
            onChange={(query) => updateView({ query })}
          />
          <ListOptions view={view} update={updateView} />

          <Button
            onClick={() => {
              setSelecting(!selecting);
              setSelection([]);
            }}
            htmlType="button"
            type="default"
          >
            {selecting ? '取消选择' : '选择实物'}
          </Button>
          <Button onClick={() => setShowPast(!showPast)} htmlType="button" type="default">
            {showPast ? '仅看当前库存' : '包含已用完'}
          </Button>
        </div>
        <ItemTable
          items={visible}
          columns={view.columns}
          selected={selection}
          onSelection={selecting ? setSelection : undefined}
        />
        <PageEnd
          total={items.length}
          page={page}
          pageSize={view.pageSize}
          unit="件实物"
          onChange={(page, pageSize) => updateView({ page, pageSize })}
        />
        {!items.length && <Empty title="这里还没有实物">入库后，每件实物会分别出现在这里。</Empty>}
        {selecting && (
          <LabelButton
            disabled={!online || stale || !selection.length || selection.length > 100}
            onClick={() => open({ kind: 'print', ids: selection.join(',') })}
          />
        )}
        {selecting && (
          <Button
            disabled={!online || stale || !selection.length || selection.length > 100}
            onClick={() => open({ kind: 'finish', ids: selection.join(',') })}
            htmlType="button"
            type="primary"
          >
            将选中 {selection.length} 件标记为用完
          </Button>
        )}
        <Link className="button secondary" to={`/catalog/${id}`}>
          查看商品共有资料
        </Link>
      </div>
    </>
  );
}
export function ItemDetail({ id, open }: { id: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online, session, switchHousehold } = useSession();
  const item = data.items.find((i) => i.id === id);
  const [edit, setEdit] = useState(false);
  const [correction, setCorrection] = useState(false);
  if (!item)
    return (
      <Empty title="当前家庭中没有这件物品">
        <p>请检查登录账号，或切换到保存此物品的家庭。</p>
        {session.households?.map((h) => (
          <Button
            key={h.household_id}
            disabled={h.household_id === session.household_id}
            onClick={() => void switchHousehold(h.household_id)}
          >
            {h.name}
          </Button>
        ))}
        <Link to="/items">返回我的物品</Link>
      </Empty>
    );
  const life = attr(item, 'lifecycle');
  const notes = data.notes.filter((n) => n.item_id === id);
  const disabled = !online || stale;
  const action = (kind: string, template?: TemplateId) => open({ kind, target: id, template });
  return (
    <>
      <PageHeader
        title={itemTitle(item, data)}
        subtitle={locationName(item, data)}
        back={`/items/group/${item.catalog_node_id}`}
      />
      <div className="content detail-grid">
        <div className="stack">
          <Card className="card">
            <h2>当前剩余</h2>
            <p className="quantity">剩余 {remaining(item)}</p>
            <p>
              {specification(data.catalog.find((c) => c.id === item.catalog_node_id)) ||
                '包装规格未记录'}
            </p>
            <LocationPath id={item.parent_id} />
            <p className="caption">
              商品分类：
              {data.catalog.find((c) => c.id === item.catalog_node_id)
                ? categoryPath(
                    data.catalog.find((c) => c.id === item.catalog_node_id)!,
                    data,
                  )
                : '未分类'}
            </p>
            <Descriptions
              column={1}
              items={[
                {
                  key: 'opening',
                  label: '开封状态',
                  children: (
                    <>
                      {label(life?.opening?.state)}
                      {life?.opening?.opened_at && ` · ${time(life.opening.opened_at)}`}
                    </>
                  ),
                },
                {
                  key: 'expiry',
                  label: itemDate(item).title,
                  children: <strong>{itemDate(item).text}</strong>,
                },
                { key: 'availability', label: '可用状态', children: label(life?.availability) },
                { key: 'state', label: '生命周期', children: label(life?.state) },
                { key: 'condition', label: '物品状况', children: label(life?.condition) },
              ]}
            />
            <small className="identity">实物编号 {item.id}</small>
            <LabelButton disabled={disabled} onClick={() => action('print')} />
          </Card>
          {!isTerminal(item) && (
            <>
              {life?.opening?.state !== 'OPENED' && (
                <Button
                  disabled={disabled}
                  onClick={() => action('open')}
                  htmlType="button"
                  type="primary"
                >
                  记录开封
                </Button>
              )}
              <Button
                disabled={disabled || !attr(item, 'contents')?.remaining}
                onClick={() => action('consume')}
                htmlType="button"
                type="primary"
              >
                记录消耗
              </Button>
              {!attr(item, 'contents')?.remaining && (
                <small>剩余量未记录。请先在编辑资料中填写已知数量。</small>
              )}
            </>
          )}
          <div className="split">
            <Button
              disabled={disabled}
              onClick={() => action('move')}
              htmlType="button"
              type="default"
            >
              移动位置
            </Button>
            <Button
              disabled={disabled}
              onClick={() => setEdit(true)}
              htmlType="button"
              type="default"
            >
              编辑资料
            </Button>
          </div>
          {!isTerminal(item) && (
            <Button
              disabled={disabled}
              onClick={() => action('finish')}
              htmlType="button"
              type="default"
            >
              整件用完
            </Button>
          )}
          <div className="grouped">
            <Row
              title="文字笔记"
              subtitle={notes[0]?.body ?? '为这件物品留下记录'}
              detail={`${notes.length} 条`}
              to={`/items/${id}/notes`}
            />
            <Row
              title="变化历史"
              subtitle="查看入库、开封和消耗记录"
              detail="查看"
              to={`/items/${id}/history`}
            />
          </div>
          <Button
            disabled={disabled}
            onClick={() => setCorrection(true)}
            htmlType="button"
            type="default"
          >
            纠正记录
          </Button>
        </div>
        <aside className="desktop-context">
          <History id={id} compact />
        </aside>
      </div>
      {(edit || correction) && (
        <ActionDrawer
          title={edit ? '编辑资料' : '纠正记录'}
          onClose={() => {
            setEdit(false);
            setCorrection(false);
          }}
        >
          <div className="grouped">
            {edit && (
              <Row
                title="这件实物的名称"
                onClick={() => {
                  setEdit(false);
                  action('rename');
                }}
              />
            )}
            {(['lifecycle', 'contents'] as TemplateId[]).map((t) => (
              <Row
                key={t}
                title={templateLabels[t]}
                onClick={() => {
                  const k = edit ? 'attributes' : 'correct';
                  setEdit(false);
                  setCorrection(false);
                  action(k, t);
                }}
              />
            ))}
          </div>
        </ActionDrawer>
      )}
    </>
  );
}
function readable(value: unknown): string {
  if (value === null || value === undefined) return '未记录';
  if (typeof value === 'string') return label(value);
  if (typeof value === 'object' && 'value' in value && 'unit' in value)
    return amount(String(value.value), String(value.unit));
  if (typeof value === 'object')
    return Object.entries(value)
      .map(([k, v]) => `${k}：${readable(v)}`)
      .join('，');
  return String(value);
}
const fieldLabels: Record<string, string> = {
  'attributes.contents.remaining': '剩余内容',
  'attributes.contents.accuracy': '数量依据',
  'attributes.lifecycle.opening.state': '开封状态',
  'attributes.lifecycle.opening.opened_at': '开封时间',
  'attributes.lifecycle.state': '生命周期',
  'attributes.lifecycle.expiry.date': '到期日期',
  parent_id: '存放位置',
  display_name: '名称',
  name: '名称',
  catalog_node_id: '商品关联',
  kind: '目录类型',
  'attributes.container.can_contain': '可容纳内容',
  'attributes.catalog.visibility': '目录可见性',
  ...Object.fromEntries(
    Object.entries(definitions).flatMap(([template, fields]) =>
      fields.map((f) => [`attributes.${template}.${f.path}`, f.label]),
    ),
  ),
};
export function History({
  id,
  compact = false,
  kind = 'ITEM',
}: {
  id: string;
  compact?: boolean;
  kind?: 'ITEM' | 'CATALOG_NODE';
}) {
  const { online, session } = useSession();
  const { data } = useInventory();
  const key = `${session.cache_key}:history:${kind}:${id}`;
  const [cached, setCached] = useState<Awaited<ReturnType<typeof history>>>();
  const q = useInfiniteQuery({
    queryKey: ['history', session.cache_key, kind, id, data.cached_at],
    queryFn: ({ pageParam, signal }) => history(id, kind, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: online,
    retry: false,
  });
  useEffect(() => {
    void stored<Awaited<ReturnType<typeof history>>>(key)
      .then(setCached)
      .catch(() => {});
  }, [key]);
  useEffect(() => {
    if (q.data?.pages[0]) void persist(key, q.data.pages[0]).catch(() => {});
  }, [key, q.data]);
  const events = q.data?.pages.flatMap((p) => p.data) ?? cached?.data;
  const body = (
    <Card className="card">
      <h2>变化历史</h2>
      {!events ? (
        <p role="status">
          {online && !q.error ? '正在读取…' : '这部分历史尚未缓存，请联网后查看。'}
        </p>
      ) : !events.length ? (
        <p>还没有变化记录。</p>
      ) : (
        <Timeline
          items={events.map((e) => ({
            key: e.id,
            content: (
              <article className="event" key={e.id}>
                <strong>{eventNames[e.event_type] ?? e.event_type}</strong>
                <time>{time(e.occurred_at)}</time>
                {e.reason && <p>原因：{e.reason}</p>}
                {e.changes
                  .filter((c) => !c.path.endsWith('.$binding'))
                  .map((c, i) => {
                    const display = (value: unknown) => {
                      if (c.path === 'parent_id' && typeof value === 'string')
                        return kind === 'ITEM'
                          ? ancestors(value, data.items)
                              .map((p) => itemName(p, data))
                              .join(' / ') || '原位置已不可用'
                          : ancestors(value, data.catalog)
                              .map((p) => p.name)
                              .join(' / ') || '原分类已不可用';
                      if (c.path === 'catalog_node_id' && typeof value === 'string')
                        return data.catalog.find((p) => p.id === value)?.name ?? '原商品已不可用';
                      if (c.path === 'kind')
                        return value === 'SKU' ? '商品' : value === 'GROUP' ? '分类' : '未记录';
                      return readable(value);
                    };
                    return (
                      <p key={i}>
                        {fieldLabels[c.path] ??
                          (c.path.startsWith('notes.') ? '文字笔记' : '资料变更')}
                        ：{display(c.before)} → {display(c.after)}
                      </p>
                    );
                  })}
              </article>
            ),
          }))}
        />
      )}
      {q.error && <Notice danger>历史读取失败；显示已缓存内容。</Notice>}
      {q.hasNextPage && (
        <Button
          disabled={!online || q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
          htmlType="button"
          type="default"
        >
          加载更早记录
        </Button>
      )}
      {!online && cached?.next_cursor && <small>离线仅包含最近 30 条已缓存记录。</small>}
    </Card>
  );
  return compact ? (
    body
  ) : (
    <>
      <PageHeader title="变化历史" back={kind === 'ITEM' ? `/items/${id}` : `/catalog/${id}`} />
      <div className="content">{body}</div>
    </>
  );
}
export function Notes({ id, open }: { id: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const notes = data.notes.filter((n) => n.item_id === id);
  return (
    <>
      <PageHeader title="文字笔记" back={`/items/${id}`} />
      <div className="content">
        <Button
          disabled={!online || stale}
          onClick={() => open({ kind: 'note', target: id })}
          htmlType="button"
          type="primary"
        >
          添加笔记
        </Button>
        {notes.map((n) => (
          <Card key={n.id} className="card">
            <h2>{n.title ?? '笔记'}</h2>
            <div className="markdown">
              <Markdown>{n.body}</Markdown>
            </div>
            <small>{time(n.updated_at)}</small>
            <Button
              disabled={!online || stale}
              onClick={() => open({ kind: 'note', target: id, note: n.id })}
              htmlType="button"
              type="default"
            >
              编辑笔记
            </Button>
          </Card>
        ))}
        {!notes.length && (
          <Empty title="还没有笔记">记录使用方式、存放提醒，或任何值得记住的事。</Empty>
        )}
      </div>
    </>
  );
}
export function Catalog({ id, open }: { id?: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const node = data.catalog.find((c) => c.id === id);
  const [edit, setEdit] = useState(false);
  const children = data.catalog.filter(
    (c) =>
      c.parent_id === (id ?? null) &&
      c.id !== data.container_catalog_id &&
      attr(c, 'catalog')?.visibility !== 'HIDDEN',
  );
  if (id && !node) return <Empty title="目录不可用" />;
  return (
    <>
      {node ? (
        <PageHeader
          title={node.name}
          subtitle={node.kind === 'SKU' ? '商品共有信息 · 每件实物的状态分别记录' : '分类'}
          back={node.parent_id ? `/catalog/${node.parent_id}` : '/catalog'}
        />
      ) : (
        <header className="page-header large">
          <h1>商品目录</h1>
          <p>商品定义与实物数量分别管理</p>
        </header>
      )}
      <div className="content">
        {node?.kind === 'SKU' ? (
          <>
            <div className="stack">
              {(['product', 'clothing', 'device'] as TemplateId[])
                .filter((t) => t === 'product' || !!attr(node, t))
                .map((t) => (
                  <Card className="card" key={t}>
                    <h2>{templateLabels[t]}</h2>
                    <Descriptions
                      column={1}
                      items={definitions[t]?.map((f) => {
                        const vs = fieldValues(attr(node, t), definitions[t]!);
                        return {
                          key: f.path,
                          label: f.label,
                          children: vs[f.path]
                            ? `${label(vs[f.path])}${f.type === 'measurement' ? ' ' + label(vs[`${f.path}.unit`]) : ''}`
                            : '未记录',
                        };
                      })}
                    />
                  </Card>
                ))}
            </div>
            <Button
              disabled={!online || stale}
              onClick={() => setEdit(true)}
              htmlType="button"
              type="primary"
            >
              编辑共有资料
            </Button>
            <Link className="button secondary" to={`/items/group/${id}`}>
              查看具体实物
            </Link>
            <Link className="button secondary" to={`/catalog/${id}/history`}>
              变化历史
            </Link>
          </>
        ) : (
          <>
            <div className="grouped">
              {children.map((c) => (
                <Row
                  key={c.id}
                  title={c.name}
                  subtitle={
                    c.kind === 'GROUP'
                      ? data.catalog
                          .filter((x) => x.parent_id === c.id)
                          .map((x) => x.name)
                          .join('、') || '暂无下级目录'
                      : (attr(c, 'product')?.specification ?? '规格未记录')
                  }
                  detail={c.kind === 'GROUP' ? '分类' : '商品'}
                  to={`/catalog/${c.id}`}
                />
              ))}
            </div>
            {!children.length && (
              <Empty title="目录还是空的">先创建分类或商品，再记录家里的实物。</Empty>
            )}
            <Button
              disabled={!online || stale}
              onClick={() => open({ kind: 'catalog', parent: id })}
              htmlType="button"
              type="primary"
            >
              ＋ 创建商品或分类
            </Button>
          </>
        )}
        {node && (
          <div className="split">
            <Button
              disabled={!online || stale}
              onClick={() => open({ kind: 'rename', target: id })}
              htmlType="button"
              type="default"
            >
              修改名称
            </Button>
            <Button
              disabled={!online || stale}
              onClick={() => open({ kind: 'move', target: id })}
              htmlType="button"
              type="default"
            >
              调整分类
            </Button>
          </div>
        )}
        {edit && (
          <ActionDrawer title="商品共有资料" onClose={() => setEdit(false)}>
            <div className="grouped">
              {(['product', 'clothing', 'device'] as TemplateId[]).map((t) => (
                <Row
                  key={t}
                  title={templateLabels[t]}
                  onClick={() => {
                    setEdit(false);
                    open({ kind: 'attributes', target: id, template: t });
                  }}
                />
              ))}
            </div>
          </ActionDrawer>
        )}
      </div>
    </>
  );
}
export function Settings({ section }: { section?: string }) {
  const { session, online, logout, storageError } = useSession();
  const { data, refresh, cacheWarning } = useInventory();
  const [install, setInstall] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (session.host === 'mcp')
    return (
      <>
        <header className="page-header large">
          <h1>设置</h1>
          <p>松仓 · {data.household.name}</p>
        </header>
        <div className="content stack">
          <Notice>
            {session.can_write ? '当前连接可查看和修改库存。' : '当前连接只有读取权限。'}
          </Notice>
          <p>账号、家庭和连接授权请在松仓网站及 ChatGPT 插件设置中管理。</p>
          <p>草稿保存在当前组件的宿主状态中；新对话或其他设备不保证恢复。</p>
          <Button
            onClick={() => void refresh().catch(() => setError('更新失败，请重试。'))}
            htmlType="button"
            type="primary"
          >
            刷新库存
          </Button>
          {error && <Notice danger>{error}</Notice>}
        </div>
      </>
    );
  if (session.mode === 'cloud' && (section === 'account' || section === 'households'))
    return (
      <>
        <header className="page-header">
          <a href="/settings">‹ 设置</a>
          <h1>{section === 'account' ? '账号与安全' : '家庭'}</h1>
        </header>
        <div className="content">
          {section === 'account' ? <AccountSettings /> : <HouseholdSettings />}
        </div>
      </>
    );
  return (
    <>
      <header className="page-header large">
        <h1>设置</h1>
        <p>松仓 · 家里的每一件，都有迹可循</p>
      </header>
      <div className="content">
        <Card className="card brand-card">
          <img src={appIcon} alt="松仓" width="56" height="56" />
          <div>
            <h2>{data.household.name}</h2>
            <p>{session.email ?? '本地所有者'}</p>
          </div>
        </Card>
        {session.mode === 'cloud' && (
          <>
            <p className="section-label">账号与家庭</p>
            <div className="grouped">
              <Row title="账号与安全" subtitle="通行密钥、密码与身份验证" to="/settings/account" />
              <Row title="家庭" subtitle="成员、邀请与家庭切换" to="/settings/households" />
            </div>
          </>
        )}
        <p className="section-label">本机缓存</p>
        <div className="grouped">
          <Row title="上次更新" detail={time(data.cached_at)} />
          <Row
            title="缓存范围"
            subtitle={`${data.catalog.length} 条目录、${data.items.length} 件实物、${data.notes.length} 条笔记；历史仅缓存打开过的最近记录。`}
          />
          <Row
            title="添加到主屏幕"
            subtitle="像 App 一样打开松仓"
            onClick={() => setInstall(true)}
          />
        </div>
        <Button
          disabled={!online || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await refresh();
              setError('');
            } catch {
              setError('更新失败，请检查连接后重试。');
            } finally {
              setBusy(false);
            }
          }}
          htmlType="button"
          type="default"
        >
          {busy ? '正在更新…' : '更新缓存'}
        </Button>
        {(storageError || cacheWarning) && <Notice danger>{storageError || cacheWarning}</Notice>}
        {error && <Notice danger>{error}</Notice>}
        {session.mode === 'cloud' && (
          <Button
            disabled={!online || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await logout();
              } catch {
                setError('退出失败，请联网后重试。');
                setBusy(false);
              }
            }}
            htmlType="button"
            type="primary"
            danger={true}
          >
            退出登录并清除本机缓存
          </Button>
        )}
        <p className="section-label">开发者工具</p>
        <a className="button secondary" href="/inspect">
          数据库检查器
        </a>
        <small>在线查看原始记录、关联与历史。修正库存请使用松仓的业务操作。</small>
        <small>离线可查看缓存内容，修改需要联网。缓存可能由浏览器清理，不替代云端库存。</small>
        {install && (
          <ActionDrawer title="添加到主屏幕" onClose={() => setInstall(false)}>
            <ol className="instructions">
              <li>在 iPhone 的 Safari 中打开松仓。</li>
              <li>打开页面菜单，轻点“分享”。</li>
              <li>选择“添加到主屏幕”。</li>
              <li>打开“作为 Web App 打开”，然后轻点“添加”。</li>
            </ol>
            <p>以后可以从主屏幕上的松鼠图标直接进入。</p>
            <a
              className="button secondary"
              href="https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios"
              target="_blank"
              rel="noreferrer"
            >
              查看 Apple 操作指引
            </a>
            <Button onClick={() => setInstall(false)} htmlType="button" type="primary">
              知道了
            </Button>
          </ActionDrawer>
        )}
      </div>
    </>
  );
}
