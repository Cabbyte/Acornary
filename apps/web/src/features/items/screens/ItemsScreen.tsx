import { useFeature } from '../../api/connection.js';
import { writeCapabilities } from '../../writes/selectors.js';
import { readCoreSearch, type CoreSearch } from '../../../app/search.js';
import { useSession } from '../../../lib/session.js';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useItemQuery } from '../../api/query.js';
import { adaptItem } from '../../inventory/adapters/index.js';
import type { CatalogView, ItemLocationView, ItemView } from '../../inventory/model/types.js';
import { useInventoryView } from '../../inventory/view.js';
import { useInventory } from '../../../lib/inventory.js';
import { ancestors, isContainer, itemName } from '../../../../../../packages/contracts/src/web.js';
import type { ItemQueryV2 } from '../../../../../../packages/contracts/src/read-v2.js';
import { Button, EmptyState } from '../../../ui/primitives/index.js';
import { Icon } from '../../../ui/icons/Icon.js';
import type { Action } from '../../../ui/forms.js';
import {
  enrichItem,
  groupByCategory,
  physicalItems,
  sortEnriched,
  todayFor,
  type EnrichedItem,
} from '../selectors/items.js';
import styles from './ItemsScreen.module.css';

const monthDay = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value);

function locationOf(
  parentId: string | null,
  byId: ReadonlyMap<string, ItemView>,
): ItemLocationView {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor = parentId;
  while (cursor && path.length < 3 && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    path.unshift(parent.name);
    cursor = parent.location.id;
  }
  return { id: parentId, path, label: path.length ? path.join(' / ') : '未记录位置' };
}

export function ItemsScreen({
  open,
  locationId,
  catalogId,
  searchMode = false,
}: {
  open: (action: Action) => void;
  locationId?: string;
  catalogId?: string;
  searchMode?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const view = useInventoryView();
  const { data: inventory } = useInventory();
  const params = readCoreSearch(location.searchStr);
  locationId = locationId ?? params.location;
  catalogId = catalogId ?? params.category;
  const search = params.q ?? '';
  const sort = params.sort ?? 'attention';
  function updateSearch(patch: Partial<CoreSearch>) {
    void navigate({ to: location.pathname, search: { ...params, ...patch } });
  }
  const setSearch = (q: string) => updateSearch({ q: q || undefined });
  const searchRef = useRef<HTMLInputElement>(null);
  const { session, online } = useSession();
  const writable = online && session.can_write !== false;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const deferredSearch = useDeferredValue(search);
  const attentionOnly = params.view === 'attention';

  const catalogById = useMemo(
    () => new Map(view.catalog.map((node) => [node.id, node])),
    [view.catalog],
  );
  const itemById = useMemo(() => new Map(view.items.map((item) => [item.id, item])), [view.items]);
  const containerIds = useMemo(
    () => new Set(inventory.items.filter(isContainer).map((item) => item.id)),
    [inventory.items],
  );
  const locations = useMemo(() => {
    const options = inventory.items
      .filter((item) => isContainer(item) && !!item.display_name)
      .map((item) => ({
        id: item.id,
        label: [
          ...ancestors(item.parent_id, inventory.items).map((parent) =>
            itemName(parent, inventory),
          ),
          itemName(item, inventory),
        ].join(' / '),
      }));
    return [...new Map(options.map((option) => [option.id, option])).values()].sort((a, b) =>
      a.label.localeCompare(b.label, 'zh-CN'),
    );
  }, [inventory]);
  const catalogKind = catalogId ? (catalogById.get(catalogId)?.kind ?? 'SKU') : undefined;

  const input = useMemo<Omit<ItemQueryV2, 'cursor'>>(() => {
    const scope: Omit<ItemQueryV2, 'cursor'> = catalogId
      ? catalogKind === 'GROUP'
        ? { catalog_subtree_id: catalogId }
        : { catalog_node_ids: [catalogId] }
      : {};
    return {
      ...scope,
      ...(locationId ? { within_item_id: locationId } : {}),
      ...(deferredSearch.trim() ? { search: deferredSearch.trim() } : {}),
      limit: 50,
      sort:
        sort === 'name'
          ? { field: 'name', direction: 'asc' }
          : { field: 'created_at', direction: 'desc' },
    };
  }, [catalogId, catalogKind, locationId, deferredSearch, sort]);

  const {
    items: rawItems,
    stale,
    invalidCursor,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useItemQuery(input, { scopeKey: attentionOnly ? 'attention' : 'all' });

  const today = todayFor(inventory.household.timezone ?? 'Asia/Shanghai');

  const allItems = useMemo(
    () =>
      physicalItems(
        rawItems.map((raw) => {
          const catalog = catalogById.get(raw.catalog_node_id);
          return adaptItem(raw, [], {
            catalogName: catalog?.name,
            profile: catalog?.profile ?? null,
            location: locationOf(raw.parent_id, itemById),
          });
        }),
        containerIds,
      ),
    [rawItems, catalogById, itemById, containerIds],
  );
  const enriched = useMemo(
    () => allItems.map((item) => enrichItem(item, catalogById, today)),
    [allItems, catalogById, today],
  );
  const attentionItems = enriched.filter((entry) => entry.attention);
  // Search is entirely server-side (including matches in notes and barcodes).
  const visible = attentionOnly ? attentionItems : enriched;
  const sorted = sort === 'created' ? visible : sortEnriched(visible, sort);
  const groups = groupByCategory(sorted);
  const productCount = new Set(enriched.map((entry) => entry.item.skuId)).size;

  const cursorResetRan = useRef(false);
  useEffect(() => {
    if (!invalidCursor) {
      cursorResetRan.current = false;
      return;
    }
    if (cursorResetRan.current) return;
    cursorResetRan.current = true;
    void client.resetQueries({ queryKey: ['items'] });
  }, [client, invalidCursor]);

  function toggleAttention() {
    updateSearch({ view: attentionOnly ? undefined : 'attention' });
  }
  function clearFilters() {
    void navigate({ to: '/items', search: { ui: params.ui } });
  }

  function toggleSelection(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function endSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  function retry() {
    if (invalidCursor) void client.resetQueries({ queryKey: ['items'] });
    else void refetch();
  }

  const title = searchMode ? '搜索' : catalogId ? '商品实物' : locationId ? '当前位置' : '我的物品';
  const subtitle = isPending
    ? '正在读取物品…'
    : `${visible.length} 件（当前结果） · ${productCount} 种商品${
        attentionItems.length ? ` · ${attentionItems.length} 件需留意` : ''
      }`;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{title}</h1>
          <p>
            {subtitle}
            {hasNextPage && !isPending ? ' · 还有更多' : ''}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="quiet" onClick={() => (selecting ? endSelection() : setSelecting(true))}>
            {selecting ? '取消选择' : '选择'}
          </Button>
          <Button
            variant="primary"
            disabled={!writable}
            className={styles.add}
            onClick={() => open({ kind: 'intake', parent: locationId })}
          >
            <Icon name="plus" size={15} />
            添加物品
          </Button>
        </div>
      </header>

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索物品、品牌或规格"
            aria-label="搜索物品"
            autoFocus={searchMode}
          />
        </label>
        <button
          className={styles.filter}
          type="button"
          data-active={attentionOnly ? 'true' : undefined}
          onClick={toggleAttention}
        >
          <Icon name="filter" size={15} />
          需留意
          {attentionItems.length > 0 && <b>{attentionItems.length}</b>}
        </button>
        {locations.length > 0 && !locationId && <LocationMenu locations={locations} />}
        <button
          className={styles.filter}
          type="button"
          onClick={() => updateSearch({ sort: sort === 'attention' ? 'name' : 'attention' })}
        >
          {sort === 'attention' ? '按关注度' : sort === 'name' ? '按名称' : '按创建时间'}
          <Icon name="arrow-up-down" size={14} />
        </button>
      </div>

      {stale && (
        <div className={styles.banner} role="status">
          <span>有新变更，刷新查看最新</span>
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            刷新
          </Button>
        </div>
      )}

      {isPending ? (
        <div className={styles.ledger} aria-label="正在读取物品" role="status">
          {[0, 1, 2, 3].map((row) => (
            <div className={styles.skeletonRow} key={row} />
          ))}
        </div>
      ) : isError ? (
        <div className={styles.error} role="alert">
          <Icon name="circle-alert" size={20} />
          <div>
            <strong>{invalidCursor ? '列表已更新' : '物品列表读取失败'}</strong>
            <p>{invalidCursor ? '正在从第一页重新读取。' : '请检查连接后重试。'}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={retry}>
            重试
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          title={attentionOnly ? '没有需要留意的物品' : '没有匹配的物品'}
          description={attentionOnly ? '所有物品都在正常状态。' : '换个关键词，或清除筛选后再试。'}
          action={
            <Button variant="secondary" onClick={clearFilters}>
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className={styles.ledger} data-selecting={selecting ? 'true' : undefined}>
          <div className={styles.columns} aria-hidden="true">
            {selecting && <span />}
            <span />
            <span>物品</span>
            <span>位置</span>
            <span>关键信息</span>
            <span>状态</span>
            <span />
          </div>
          {groups.map(([category, entries]) => (
            <section key={category} className={styles.section}>
              <div className={styles.sectionHead}>
                <span>{category}</span>
                <span>{entries.length} 件</span>
              </div>
              {entries.map((entry) => (
                <Row
                  key={entry.item.id}
                  entry={entry}
                  open={open}
                  selecting={selecting}
                  selected={selected.has(entry.item.id)}
                  onSelect={() => toggleSelection(entry.item.id)}
                />
              ))}
            </section>
          ))}
        </div>
      )}

      {!isPending && !isError && hasNextPage && (
        <div className={styles.loadMore}>
          <Button
            variant="secondary"
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            加载更多
          </Button>
        </div>
      )}
      <footer className={styles.footer}>
        <span>共 {visible.length} 件 · 当前结果</span>
        <span>家庭时区 {inventory.household.timezone ?? 'Asia/Shanghai'}</span>
      </footer>

      {selecting && selected.size > 0 && (
        <div className={styles.batchBar} role="region" aria-label="批量操作">
          <span>已选 {selected.size} 件</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!writable}
            onClick={() => open({ kind: 'move', ids: [...selected].join(',') })}
          >
            移动
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => open({ kind: 'print', ids: [...selected].join(',') })}
          >
            打印
          </Button>
          <Button variant="quiet" size="sm" onClick={endSelection}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

function LocationMenu({ locations }: { locations: Array<{ id: string; label: string }> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className={styles.menuWrap} ref={ref}>
      <button
        className={styles.filter}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="map-pin" size={15} />
        位置
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {locations.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false);
                void navigate({ to: `/places/${entry.id}`, search: { ui: 'next' } });
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  open,
  selecting,
  selected,
  onSelect,
}: {
  entry: EnrichedItem;
  open: (action: Action) => void;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { item, product, attention, remaining, expiry } = entry;
  const label = [item.name, item.location.label, attention?.label ?? '在库'].join('，');
  return (
    <div className={styles.row} data-selected={selected ? 'true' : undefined}>
      {selecting ? (
        <input
          className={styles.selectBox}
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`选择 ${item.name}`}
        />
      ) : null}
      {
        <Link
          to={`/items/${item.id}`}
          search={{ ui: 'next' }}
          className={styles.rowOpen}
          aria-label={label}
        />
      }
      <span className={styles.glyph} data-tone={entry.tone}>
        <Icon name={entry.icon} size={18} />
      </span>
      <span className={styles.itemName}>
        <strong>{item.name}</strong>
        {product && product !== item.name && <small>{product}</small>}
      </span>
      <span className={styles.location}>{item.location.label}</span>
      <span className={styles.facts}>
        {expiry ? <span>{monthDay(expiry)} 到期</span> : null}
        {remaining ? <span>{remaining}</span> : null}
        {!expiry && !remaining ? <span className={styles.muted}>未记录</span> : null}
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
      {!selecting && <RowActions item={item} open={open} />}
    </div>
  );
}

function RowActions({ item, open }: { item: ItemView; open: (action: Action) => void }) {
  const { session, online } = useSession();
  const { data } = useInventory();
  const profile = useFeature('profile_capabilities');
  const capabilities = writeCapabilities(
    data.items.find((record) => record.id === item.id),
    profile,
  );
  const writable = online && session.can_write !== false;
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [show]);
  const action = (kind: Action['kind']) => {
    setShow(false);
    open({ kind, target: item.id });
  };
  return (
    <div className={styles.moreWrap} ref={ref}>
      <button
        className={styles.more}
        type="button"
        aria-label={`${item.name} 的更多操作`}
        aria-haspopup="menu"
        aria-expanded={show}
        onClick={() => setShow((value) => !value)}
      >
        <Icon name="more" size={17} />
      </button>
      {show && (
        <div className={styles.rowMenu} role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={!writable || !capabilities.consume}
            onClick={() => action('consume')}
          >
            记录消耗
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!writable || !capabilities.active}
            onClick={() => action('move')}
          >
            移动位置
          </button>
          <button type="button" role="menuitem" disabled={!writable} onClick={() => action('edit')}>
            编辑物品
          </button>
          <button type="button" role="menuitem" onClick={() => action('print')}>
            打印标签
          </button>
        </div>
      )}
    </div>
  );
}
