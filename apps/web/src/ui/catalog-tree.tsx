import { Button, Input, Tree, Typography, type TreeDataNode } from 'antd';
import { FolderOutlined, SearchOutlined } from '@ant-design/icons';
import { useEffect, useMemo } from 'react';
import { ancestors, type CatalogRecord } from '../../../../packages/contracts/src/web';
import { visibleProducts } from '../lib/browse';
import { useInventory } from '../lib/inventory';

// A view-only filter, never a catalog node ID.
export const UNCATEGORIZED = 'uncategorized';

export function CatalogTree({
  active,
  query,
  expanded,
  onChoose,
  onQuery,
  onExpand,
}: {
  active: string;
  query: string;
  expanded: string[];
  onChoose: (id: string) => void;
  onQuery: (query: string) => void;
  onExpand: (ids: string[]) => void;
}) {
  const { data } = useInventory();
  const { groups, children, counts, total, unclassified } = useMemo(() => {
    const groups = data.catalog
      .filter((c) => c.kind === 'GROUP')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id));
    const children = new Map<string | null, CatalogRecord[]>();
    for (const group of groups)
      children.set(group.parent_id, [...(children.get(group.parent_id) ?? []), group]);
    const products = visibleProducts(data);
    const counts = new Map<string, number>();
    for (const product of products)
      for (const parent of ancestors(product.parent_id, data.catalog))
        counts.set(parent.id, (counts.get(parent.id) ?? 0) + 1);
    return {
      groups,
      children,
      counts,
      total: products.length,
      unclassified: products.filter((c) => !c.parent_id).length,
    };
  }, [data]);
  useEffect(() => {
    const parents = ancestors(active || null, data.catalog)
      .slice(0, -1)
      .map((c) => c.id);
    if (parents.some((id) => !expanded.includes(id)))
      onExpand([...new Set([...expanded, ...parents])]);
    // Expanding the selected path must not prevent manual collapsing afterwards.
  }, [active, data.catalog]);
  const needle = query.trim().toLocaleLowerCase();
  const path = (id: string) =>
    ancestors(id, data.catalog)
      .map((c) => c.name)
      .join(' / ');
  const node = (group: CatalogRecord): TreeDataNode => ({
    key: group.id,
    icon: <FolderOutlined aria-hidden="true" />,
    title: (
      <span className="wb-tree-title" title={path(group.id)}>
        <span className="wb-tree-name">{needle ? path(group.id) : group.name}</span>
        <Typography.Text type="secondary">{counts.get(group.id) ?? 0}</Typography.Text>
      </span>
    ),
    children: needle ? undefined : (children.get(group.id) ?? []).map(node),
  });
  const shortcut = (id: string, title: string, count: number) => (
    <Button
      type="text"
      block
      className={`wb-tree-root${active === id ? ' is-selected' : ''}`}
      aria-label={title}
      aria-pressed={active === id}
      icon={<FolderOutlined aria-hidden="true" />}
      onClick={() => onChoose(id)}
    >
      <span className="wb-tree-title">
        <span className="wb-tree-name">{title}</span>
        <Typography.Text type="secondary">{count}</Typography.Text>
      </span>
    </Button>
  );
  return (
    <div className="stack wb-location-tree">
      <Input
        className="ac-search"
        type="search"
        aria-label="搜索分类"
        placeholder="搜索分类"
        prefix={<SearchOutlined aria-hidden="true" />}
        allowClear
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      {shortcut('', '全部商品', total)}
      {unclassified > 0 && shortcut(UNCATEGORIZED, '未分类', unclassified)}
      <Tree
        aria-label="商品分类树"
        blockNode
        showIcon
        treeData={(needle
          ? groups.filter((g) => path(g.id).toLocaleLowerCase().includes(needle))
          : (children.get(null) ?? [])
        ).map(node)}
        expandedKeys={expanded}
        onExpand={(keys) => onExpand(keys.map(String))}
        selectedKeys={active ? [active] : []}
        onSelect={(_, { node }) => onChoose(String(node.key))}
      />
      {(!groups.length ||
        (needle && !groups.some((g) => path(g.id).toLocaleLowerCase().includes(needle)))) && (
        <Typography.Text type="secondary">{needle ? '没有找到分类' : '还没有分类'}</Typography.Text>
      )}
    </div>
  );
}
