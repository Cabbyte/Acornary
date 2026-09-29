import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
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
  type ItemRecord,
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
import { Button, Empty, Field, Notice, Row, Sheet } from './ui/components';
import { definitions, fieldValues, templateLabels } from './ui/fields';
import type { Action } from './ui/forms';

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
          <button
            className="icon-button"
            aria-label="入库"
            disabled={!online || stale}
            onClick={() => open({ kind: 'intake' })}
          >
            ＋
          </button>
        </div>
        <h1>我的物品</h1>
        <p>
          {groups.length} 种商品 · {groups.reduce((n, g) => n + g.count, 0)} 件实物
        </p>
      </header>
      <div className="content">
        <label className="search">
          <img src="/design/search.svg" alt="" />
          <input
            aria-label="搜索物品"
            placeholder="搜索物品、品牌或名称"
            value={filter.search}
            onChange={(e) => update('search', e.target.value)}
          />
          {filter.search && (
            <button aria-label="清除搜索" onClick={() => update('search', '')}>
              ×
            </button>
          )}
        </label>
        <div className="chips">
          <button className={!filter.category ? 'selected' : ''} onClick={() => setSheet(true)}>
            {filter.category ? '已选分类' : '全部物品'}
          </button>
          <button className={filter.location ? 'selected' : ''} onClick={() => setSheet(true)}>
            {filter.location ? '已选位置' : '存放位置'}
          </button>
          <button
            className={filter.state !== 'current' ? 'selected' : ''}
            onClick={() => setSheet(true)}
          >
            {filter.state === 'current' ? '状态筛选' : label(filter.state)}
          </button>
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
          <Sheet title="筛选物品" onClose={() => setSheet(false)}>
            <div className="stack">
              <Field label="分类">
                <select
                  value={filter.category}
                  onChange={(e) => update('category', e.target.value)}
                >
                  <option value="">全部分类</option>
                  {data.catalog
                    .filter((c) => c.kind === 'GROUP')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {ancestors(c.id, data.catalog)
                          .map((x) => x.name)
                          .join(' / ')}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="存放位置">
                <select
                  value={filter.location}
                  onChange={(e) => update('location', e.target.value)}
                >
                  <option value="">全部位置</option>
                  {data.items.filter(isContainer).map((i) => (
                    <option key={i.id} value={i.id}>
                      {ancestors(i.id, data.items)
                        .map((x) => itemName(x, data))
                        .join(' / ')}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="状态">
                <select value={filter.state} onChange={(e) => update('state', e.target.value)}>
                  {[
                    ['current', '当前库存（包含状态未记录）'],
                    ['all', '全部记录'],
                    ['OPENED', '已开封'],
                    ['SEALED', '未开封'],
                    ['unknown', '开封状态未记录'],
                    ['terminal', '已用完、丢弃或归档'],
                  ].map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Button onClick={() => setSheet(false)}>查看结果</Button>
              <Button
                variant="secondary"
                onClick={() => setFilter(inventoryFilterSchema.parse({}))}
              >
                重置筛选
              </Button>
            </div>
          </Sheet>
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
  return (
    <header className="page-header">
      <div className="toolbar">
        <Link to={back} className="icon-button" aria-label="返回">
          ‹
        </Link>
        <h1>{title}</h1>
        <span className="toolbar-spacer" />
      </div>
      {subtitle && <p>{subtitle}</p>}
    </header>
  );
}
export function ItemRow({ item }: { item: ItemRecord }) {
  const { data } = useInventory();
  const life = attr(item, 'lifecycle');
  return (
    <Row
      title={`${itemTitle(item, data)} · ${isTerminal(item) ? label(life?.state) : label(life?.opening?.state)}`}
      subtitle={`${life?.expiry?.date ? life.expiry.date + ' 到期' : '到期日期未记录'} · ${locationName(item, data)}`}
      detail={remaining(item)}
      to={`/items/${item.id}`}
    />
  );
}
export function Product({ id, open }: { id: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const sku = data.catalog.find((c) => c.id === id);
  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [showPast, setShowPast] = useState(false);
  if (!sku) return <Empty title="商品不可用">请返回物品列表刷新。</Empty>;
  const group = productGroups(data, inventoryFilterSchema.parse({})).find((g) => g.id === id);
  const items = data.items.filter((i) => i.catalog_node_id === id && (showPast || !isTerminal(i)));
  const paths = [...new Set(items.map((i) => locationName(i, data)))];
  return (
    <>
      <PageHeader
        title={sku.name}
        subtitle={`商品汇总 · ${attr(sku, 'product')?.specification ?? '包装规格未记录'}`}
      />
      <div className="content">
        <section className="card">
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
            variant="secondary"
            disabled={!online || stale}
            onClick={() => open({ kind: 'intake', target: id })}
          >
            再入库几件
          </Button>
        </section>
        <div className="split">
          <Button
            variant="secondary"
            onClick={() => {
              setSelecting(!selecting);
              setSelection([]);
            }}
          >
            {selecting ? '取消选择' : '选择实物'}
          </Button>
          <Button variant="secondary" onClick={() => setShowPast(!showPast)}>
            {showPast ? '仅看当前库存' : '包含已用完'}
          </Button>
        </div>
        {paths.map((path) => (
          <section key={path}>
            <p className="section-label">{path}</p>
            <div className="grouped">
              {items
                .filter((i) => locationName(i, data) === path)
                .map((item) => (
                  <div className="selectable-row" key={item.id}>
                    {selecting && !isTerminal(item) && (
                      <input
                        type="checkbox"
                        aria-label={`选择 ${itemTitle(item, data)}`}
                        checked={selection.includes(item.id)}
                        onChange={(e) =>
                          setSelection((s) =>
                            e.target.checked ? [...s, item.id] : s.filter((x) => x !== item.id),
                          )
                        }
                      />
                    )}
                    <ItemRow item={item} />
                  </div>
                ))}
            </div>
          </section>
        ))}
        {!items.length && <Empty title="这里还没有实物">入库后，每件实物会分别出现在这里。</Empty>}
        {selecting && (
          <Button
            disabled={!online || stale || !selection.length || selection.length > 100}
            onClick={() => open({ kind: 'finish', ids: selection.join(',') })}
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
  const { online } = useSession();
  const item = data.items.find((i) => i.id === id);
  const [edit, setEdit] = useState(false);
  const [correction, setCorrection] = useState(false);
  if (!item) return <Empty title="物品不可用">请返回列表刷新。</Empty>;
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
          <section className="card">
            <h2>这件的情况</h2>
            <p className="quantity">剩余 {remaining(item)}</p>
            <dl>
              <div>
                <dt>开封状态</dt>
                <dd>
                  {label(life?.opening?.state)}
                  {life?.opening?.opened_at && ` · ${time(life.opening.opened_at)}`}
                </dd>
              </div>
              <div>
                <dt>到期日期</dt>
                <dd>{life?.expiry?.date ?? '未记录'}</dd>
              </div>
              <div>
                <dt>可用状态</dt>
                <dd>{label(life?.availability)}</dd>
              </div>
              <div>
                <dt>生命周期</dt>
                <dd>{label(life?.state)}</dd>
              </div>
              <div>
                <dt>物品状况</dt>
                <dd>{label(life?.condition)}</dd>
              </div>
            </dl>
            <small className="identity">实物编号 {item.id.slice(-8)}</small>
          </section>
          {!isTerminal(item) && (
            <>
              {life?.opening?.state !== 'OPENED' && (
                <Button disabled={disabled} onClick={() => action('open')}>
                  记录开封
                </Button>
              )}
              <Button
                disabled={disabled || !attr(item, 'contents')?.remaining}
                onClick={() => action('consume')}
              >
                记录消耗
              </Button>
              {!attr(item, 'contents')?.remaining && (
                <small>剩余量未记录。请先在编辑资料中填写已知数量。</small>
              )}
            </>
          )}
          <div className="split">
            <Button variant="secondary" disabled={disabled} onClick={() => action('move')}>
              移动位置
            </Button>
            <Button variant="secondary" disabled={disabled} onClick={() => setEdit(true)}>
              编辑资料
            </Button>
          </div>
          {!isTerminal(item) && (
            <Button variant="secondary" disabled={disabled} onClick={() => action('finish')}>
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
          <Button variant="secondary" disabled={disabled} onClick={() => setCorrection(true)}>
            纠正记录
          </Button>
        </div>
        <aside className="desktop-context">
          <History id={id} compact />
        </aside>
      </div>
      {(edit || correction) && (
        <Sheet
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
        </Sheet>
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
    queryFn: ({ pageParam }) => history(id, kind, pageParam),
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
    <section className="card">
      <h2>变化历史</h2>
      {!events ? (
        <p role="status">
          {online && !q.error ? '正在读取…' : '这部分历史尚未缓存，请联网后查看。'}
        </p>
      ) : !events.length ? (
        <p>还没有变化记录。</p>
      ) : (
        events.map((e) => (
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
                    {fieldLabels[c.path] ?? (c.path.startsWith('notes.') ? '文字笔记' : '资料变更')}
                    ：{display(c.before)} → {display(c.after)}
                  </p>
                );
              })}
          </article>
        ))
      )}
      {q.error && <Notice danger>历史读取失败；显示已缓存内容。</Notice>}
      {q.hasNextPage && (
        <Button
          variant="secondary"
          disabled={!online || q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          加载更早记录
        </Button>
      )}
      {!online && cached?.next_cursor && <small>离线仅包含最近 30 条已缓存记录。</small>}
    </section>
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
        <Button disabled={!online || stale} onClick={() => open({ kind: 'note', target: id })}>
          添加笔记
        </Button>
        {notes.map((n) => (
          <article key={n.id} className="card">
            <h2>{n.title ?? '笔记'}</h2>
            <div className="markdown">
              <Markdown>{n.body}</Markdown>
            </div>
            <small>{time(n.updated_at)}</small>
            <Button
              variant="secondary"
              disabled={!online || stale}
              onClick={() => open({ kind: 'note', target: id, note: n.id })}
            >
              编辑笔记
            </Button>
          </article>
        ))}
        {!notes.length && (
          <Empty title="还没有笔记">记录使用方式、存放提醒，或任何值得记住的事。</Empty>
        )}
      </div>
    </>
  );
}
export function Places({ id, open }: { id?: string; open: OpenAction }) {
  const { data, stale } = useInventory();
  const { online } = useSession();
  const place = data.items.find((i) => i.id === id);
  const children = data.items.filter((i) => i.parent_id === (id ?? null));
  const unplaced = data.items.filter((i) => i.parent_id === null && !isContainer(i));
  if (id && !place) return <Empty title="位置不可用" />;
  return (
    <>
      {place ? (
        <PageHeader
          title={itemName(place, data)}
          subtitle={locationName(place, data)}
          back={place.parent_id ? `/places/${place.parent_id}` : '/places'}
        />
      ) : (
        <header className="page-header large">
          <h1>存放位置</h1>
          <p>{data.household.name} · 按实际位置找到物品</p>
        </header>
      )}
      <div className="content">
        <div className="grouped">
          {children.filter(isContainer).map((i) => (
            <Row
              key={i.id}
              title={itemName(i, data)}
              subtitle={
                data.items
                  .filter((x) => x.parent_id === i.id)
                  .slice(0, 3)
                  .map((x) => itemName(x, data))
                  .join('、') || '内部暂无物品'
              }
              detail={`${data.items.filter((x) => x.parent_id === i.id).length} 件`}
              to={`/places/${i.id}`}
            />
          ))}
        </div>
        {place && (
          <>
            <p className="section-label">这里的物品</p>
            <div className="grouped">
              {children
                .filter((i) => !isContainer(i))
                .map((i) => (
                  <ItemRow item={i} key={i.id} />
                ))}
            </div>
            {!children.length && (
              <Empty title="这里还是空的">可以创建下级位置，或把物品移入这里。</Empty>
            )}
            <div className="split">
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
            </div>
          </>
        )}
        {!place && !children.some(isContainer) && (
          <Empty title="给物品一个位置">从房间、柜子或收纳箱开始。</Empty>
        )}
        <Button disabled={!online || stale} onClick={() => open({ kind: 'place', parent: id })}>
          ＋ 新建{place ? '下级' : ''}位置
        </Button>
        {!place && unplaced.length > 0 && (
          <>
            <p className="section-label">位置未记录 · {unplaced.length} 件</p>
            <div className="grouped">
              {unplaced.map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </div>
          </>
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
                  <section className="card" key={t}>
                    <h2>{templateLabels[t]}</h2>
                    <dl>
                      {definitions[t]?.map((f) => {
                        const vs = fieldValues(attr(node, t), definitions[t]!);
                        return (
                          <div key={f.path}>
                            <dt>{f.label}</dt>
                            <dd>
                              {vs[f.path]
                                ? `${label(vs[f.path])}${f.type === 'measurement' ? ' ' + label(vs[`${f.path}.unit`]) : ''}`
                                : '未记录'}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </section>
                ))}
            </div>
            <Button disabled={!online || stale} onClick={() => setEdit(true)}>
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
            >
              ＋ 创建商品或分类
            </Button>
          </>
        )}
        {node && (
          <div className="split">
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
              调整分类
            </Button>
          </div>
        )}
        {edit && (
          <Sheet title="商品共有资料" onClose={() => setEdit(false)}>
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
          </Sheet>
        )}
      </div>
    </>
  );
}
export function Settings() {
  const { session, online, logout, storageError } = useSession();
  const { data, refresh, cacheWarning } = useInventory();
  const [install, setInstall] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <header className="page-header large">
        <h1>设置</h1>
        <p>松仓 · 家里的每一件，都有迹可循</p>
      </header>
      <div className="content">
        <section className="card brand-card">
          <img src="/app-icon.png" alt="松仓" width="56" height="56" />
          <div>
            <h2>{data.household.name}</h2>
            <p>{session.email ?? '本地所有者'}</p>
          </div>
        </section>
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
          variant="secondary"
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
        >
          {busy ? '正在更新…' : '更新缓存'}
        </Button>
        {(storageError || cacheWarning) && <Notice danger>{storageError || cacheWarning}</Notice>}
        {error && <Notice danger>{error}</Notice>}
        {session.mode === 'cloud' && (
          <Button
            variant="danger"
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
          <Sheet title="添加到主屏幕" onClose={() => setInstall(false)}>
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
            <Button onClick={() => setInstall(false)}>知道了</Button>
          </Sheet>
        )}
      </div>
    </>
  );
}
