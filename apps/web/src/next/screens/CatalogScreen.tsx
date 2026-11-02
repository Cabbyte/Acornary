import { useInventory } from '../../lib/inventory.js';
import { Drawer } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../lib/session.js';
import { CatalogTree, UNCATEGORIZED } from '../../ui/catalog-tree.js';
import {
  InventoryColumns,
  useContentWidth,
  useLocationPanelWidth,
} from '../../ui/inventory-layout.js';
import { keySpec, categoryPath } from '../../features/items/selectors/catalog.js';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { readCoreSearch } from '../../app/search.js';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useCatalogQuery } from '../../features/api/query.js';
import { adaptCatalog } from '../../features/inventory/adapters/index.js';
import type { CatalogView } from '../../features/inventory/model/types.js';
import { useInventoryView } from '../../features/inventory/view.js';
import type { Action } from '../../ui/forms';
import { Icon } from '../../ui/icons/Icon.js';
import { categoryIcon, categoryTone } from '../../ui/icons/category.js';
import { Button, EmptyState, PageHeader } from '../../ui/primitives/index.js';
import styles from './CatalogScreen.module.css';

export function CatalogScreen({ id, open }: { id?: string; open: (action: Action) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = readCoreSearch(location.searchStr);
  const search = params.q ?? '';
  const setSearch = (q: string) =>
    void navigate({ to: location.pathname, search: { ...params, q: q || undefined } });
  const view = useInventoryView();
  const { data: inventory } = useInventory();
  const { session } = useSession();
  const client = useQueryClient();
  const browseKey = ['catalog-browse', session.cache_key, view.household.id];
  const saved = client.getQueryData<{ query: string; expanded: string[] }>(browseKey);
  const [categoryQuery, setCategoryQuery] = useState(saved?.query ?? '');
  const [expanded, setExpanded] = useState<string[]>(saved?.expanded ?? []);
  const [treeOpen, setTreeOpen] = useState(false);
  const measurement = useContentWidth();
  const panel = useLocationPanelWidth('catalog');
  const inline = measurement.width >= 900;
  const selected = id ? view.catalog.find((node) => node.id === id) : undefined;
  const active = selected?.kind === 'GROUP' ? selected.id : (params.category ?? '');
  const category = view.catalog.find((node) => node.id === active && node.kind === 'GROUP');
  useEffect(() => {
    client.setQueryData(browseKey, { query: categoryQuery, expanded });
  }, [client, session.cache_key, view.household.id, categoryQuery, expanded]);
  useEffect(() => {
    if (active && active !== UNCATEGORIZED && !category)
      void navigate({ to: '/catalog', search: { ...params, category: undefined } });
  }, [active, category]);
  const chooseCategory = (category: string) => {
    setTreeOpen(false);
    void navigate({ to: '/catalog', search: { ...params, category: category || undefined } });
  };
  const tree = (
    <CatalogTree
      active={active}
      query={categoryQuery}
      expanded={expanded}
      onChoose={chooseCategory}
      onQuery={setCategoryQuery}
      onExpand={setExpanded}
    />
  );

  const catalogQuery = useCatalogQuery({
    kind: 'SKU',
    limit: 100,
    ...(selected?.kind === 'SKU'
      ? { catalog_subtree_id: id }
      : category
        ? { catalog_subtree_id: category.id }
        : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });

  const nodes = useMemo(
    () =>
      (active === UNCATEGORIZED
        ? view.catalog.filter(
            (node) =>
              node.kind === 'SKU' &&
              node.id !== inventory.container_catalog_id &&
              node.parentId === null &&
              !node.attributes.some(
                (a) => a.template_id === 'catalog' && a.values.visibility === 'HIDDEN',
              ),
          )
        : catalogQuery.nodes.map(adaptCatalog)
      )
        .filter(
          (node) =>
            active !== UNCATEGORIZED ||
            !search.trim() ||
            [
              node.name,
              keySpec(node),
              ...node.attributes
                .filter((a) => a.template_id === 'product')
                .map((a) => String(a.values.brand ?? '')),
            ]
              .join(' ')
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()),
        )
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    [catalogQuery.nodes, active, search, view.catalog, inventory.container_catalog_id],
  );
  const groups = useMemo(
    () => new Map(view.groups.map((group) => [group.id, group])),
    [view.groups],
  );
  const catalogById = useMemo(
    () => new Map(view.catalog.map((node) => [node.id, node])),
    [view.catalog],
  );
  const entries = useMemo(
    () =>
      nodes.map((node) => {
        const path = categoryPath(node, catalogById);
        const spec = keySpec(node);
        const category = path[0] ?? '其他';
        return {
          node,
          spec,
          pathLabel: path.length > 0 ? path.join(' / ') : '未分类',
          icon: categoryIcon(node.name, spec, category),
          tone: categoryTone(category),
          group: groups.get(node.id),
        };
      }),
    [nodes, catalogById, groups],
  );
  const filtered = entries;

  const total = active === UNCATEGORIZED ? nodes.length : catalogQuery.matchingCount;
  const ready = !catalogQuery.isLoading && !catalogQuery.isError;
  const searching = search.trim().length > 0;
  const subtitle = catalogQuery.isLoading
    ? '正在读取商品目录…'
    : catalogQuery.isError
      ? '暂时无法读取'
      : `${total} 款商品`;

  return (
    <div className={styles.page} ref={measurement.ref}>
      <PageHeader
        back={
          selected?.kind === 'SKU'
            ? {
                label: '返回商品目录',
                href: (() => {
                  const value = new URLSearchParams(location.searchStr).get('returnTo');
                  return value?.startsWith('/catalog?') ? value : '/catalog';
                })(),
              }
            : undefined
        }
        title={selected?.name ?? '商品目录'}
        subtitle={subtitle}
        actions={
          <Button variant="primary" onClick={() => open({ kind: 'catalog' })}>
            <Icon name="plus" size={15} />
            新增商品
          </Button>
        }
      />

      {selected?.kind === 'SKU' && (
        <section aria-label="商品共有资料">
          <p>{keySpec(selected) || '尚未补充规格'}</p>
          <Button variant="secondary" onClick={() => open({ kind: 'rename', target: selected.id })}>
            编辑商品定义
          </Button>{' '}
          <Button
            variant="secondary"
            onClick={() => open({ kind: 'attributes', target: selected.id, template: 'product' })}
          >
            编辑商品共有资料
          </Button>{' '}
          {selected.kind === 'SKU' && (
            <Button onClick={() => open({ kind: 'intake', target: selected.id })}>新增实物</Button>
          )}
          <p>
            <Link to={`/items/group/${selected.id}`} search={{ ui: 'next' }}>
              查看实物
            </Link>
          </p>
        </section>
      )}
      {selected?.kind !== 'SKU' && (
        <>
          <p aria-label="当前商品分类">
            {category
              ? [...categoryPath(category, catalogById), category.name].join(' / ')
              : active === UNCATEGORIZED
                ? '未分类'
                : '全部商品'}
          </p>
          {!inline && (
            <Button variant="secondary" onClick={() => setTreeOpen(true)}>
              分类
            </Button>
          )}
          <Drawer
            title="选择分类"
            open={treeOpen && !inline}
            onClose={() => setTreeOpen(false)}
            width="min(360px, 100vw)"
          >
            {tree}
          </Drawer>
        </>
      )}
      <InventoryColumns
        inline={inline && selected?.kind !== 'SKU'}
        width={panel.width}
        max={320}
        onResize={panel.setWidth}
        onRemember={panel.remember}
        tree={tree}
        resizeLabel="调整分类栏宽度"
      >
        <div className={styles.toolbar}>
          <div className={styles.search} role="search">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索商品、品牌或分类"
              aria-label="搜索商品"
              enterKeyHint="search"
            />
            {search && (
              <button
                className={styles.clear}
                type="button"
                onClick={() => setSearch('')}
                aria-label="清除搜索"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          {ready && nodes.length > 0 && searching && (
            <p className={styles.resultCount} aria-live="polite">
              找到 {filtered.length} 款
            </p>
          )}
        </div>

        {ready && catalogQuery.stale && (
          <div className={styles.banner} role="status">
            <span>有新变更，刷新查看最新</span>
            <Button variant="secondary" size="sm" onClick={() => void catalogQuery.refetch()}>
              刷新
            </Button>
          </div>
        )}

        {catalogQuery.isLoading && (
          <div className={styles.ledger} role="status" aria-label="正在读取商品目录">
            <div className={styles.columns} aria-hidden="true">
              <span />
              <span>商品</span>
              <span>在库</span>
              <span>位置</span>
              <span />
            </div>
            <div className={styles.skeletonList} aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <div className={styles.skeletonRow} key={row}>
                  <span className={styles.skeletonGlyph} />
                  <span className={styles.skeletonIdentity}>
                    <span className={styles.skeletonLine} />
                    <span className={styles.skeletonLine} />
                  </span>
                  <span className={styles.skeletonMeta} />
                  <span className={styles.skeletonMeta} />
                  <span className={styles.skeletonChevron} />
                </div>
              ))}
            </div>
          </div>
        )}

        {catalogQuery.isError && (
          <EmptyState
            icon={<Icon name="circle-alert" size={20} />}
            title="商品目录暂时无法读取"
            description="请检查连接后重试。"
            action={
              <Button variant="secondary" onClick={() => void catalogQuery.refetch()}>
                重试
              </Button>
            }
          />
        )}

        {ready && nodes.length === 0 && (
          <EmptyState
            icon={<Icon name="library" size={20} />}
            title={searching ? '没有匹配的商品' : active ? '此分类下还没有商品' : '还没有商品'}
            description="新增第一件商品后，它会出现在这里。"
            action={
              <Button variant="primary" onClick={() => open({ kind: 'catalog' })}>
                新增商品
              </Button>
            }
          />
        )}

        {ready && nodes.length > 0 && filtered.length === 0 && (
          <EmptyState
            icon={<Icon name="search" size={20} />}
            title="没有匹配的商品"
            description={`没有找到包含“${search.trim()}”的商品，换个关键词或清除搜索。`}
            action={
              <Button variant="secondary" onClick={() => setSearch('')}>
                清除搜索
              </Button>
            }
          />
        )}

        {ready && filtered.length > 0 && (
          <div className={styles.ledger}>
            <div className={styles.columns} aria-hidden="true">
              <span />
              <span>商品</span>
              <span>在库</span>
              <span>位置</span>
              <span />
            </div>
            <ul className={styles.list}>
              {filtered.map((entry) => {
                const stock = entry.group?.currentCount;
                const locations = entry.group?.locations;
                const label = [
                  entry.node.name,
                  entry.spec,
                  entry.pathLabel,
                  stock === undefined ? '在库数未记录' : stock > 0 ? `${stock} 件在库` : '无在库',
                  locations === undefined
                    ? '位置数未记录'
                    : `${locations === undefined ? '位置数未记录' : `${locations} 个位置`}`,
                ]
                  .filter((part) => part.length > 0)
                  .join('，');
                return (
                  <li key={entry.node.id}>
                    <Link
                      className={styles.row}
                      aria-label={label}
                      to={`/catalog/${entry.node.id}`}
                      search={{ ui: 'next', returnTo: location.pathname + location.searchStr }}
                    >
                      <span className={styles.glyph} data-tone={entry.tone} aria-hidden="true">
                        <Icon name={entry.icon} size={18} />
                      </span>
                      <span className={styles.identity}>
                        <span className={styles.name}>{entry.node.name}</span>
                        <span className={styles.metaText}>
                          {entry.spec && (
                            <>
                              <span className={styles.spec}>{entry.spec}</span>
                              <span className={styles.separator} aria-hidden="true">
                                ·
                              </span>
                            </>
                          )}
                          <span className={styles.category}>{entry.pathLabel}</span>
                        </span>
                      </span>
                      <span className={styles.rowMeta}>
                        <span
                          className={styles.stock}
                          data-empty={stock === 0 ? 'true' : undefined}
                        >
                          {stock === undefined
                            ? '在库数未记录'
                            : stock > 0
                              ? `${stock} 件在库`
                              : '无在库'}
                        </span>
                        <span className={styles.locations}>
                          {locations === undefined ? '位置数未记录' : `${locations} 个位置`}
                        </span>
                      </span>
                      <Icon name="chevron-right" size={16} className={styles.chevron} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {active !== UNCATEGORIZED && catalogQuery.hasNextPage && (
          <Button
            variant="secondary"
            loading={catalogQuery.isFetchingNextPage}
            onClick={() => void catalogQuery.fetchNextPage()}
          >
            加载更多
          </Button>
        )}
      </InventoryColumns>
    </div>
  );
}
