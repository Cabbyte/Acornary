import { useEffect, useState } from 'react';
import { Button } from '../../src/ui/components/ui/button';
import { TreeView } from '../../src/ui/components/ui/tree-view';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSorting,
} from '../../src/ui/components/ui/data-table';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { ItemIdentity } from '../../src/ui/patterns/item-identity';
import { LocationPath } from '../../src/ui/patterns/location-path';
import { BatchSelectionBar } from '../../src/ui/patterns/batch-selection-bar';
import { PageHeader } from '../../src/ui/patterns/page-header';
import type { ItemView, SelectionSnapshot } from '../../src/ui/patterns/types';
import { items, skuId, householdId } from '../fixtures';
import type { ReviewDemoProps } from '../types';
const foodId = 'catalog_node_00000000-0000-4000-8000-000000000010';
const selectionIds = Array.from(
  { length: 101 },
  (_, i) => `item_00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
);
export function ManagementComposition({ scenario }: ReviewDemoProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [expandedTree, setExpandedTree] = useState<readonly string[]>([foodId]);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<DataTableSorting>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expandedRows, setExpandedRows] = useState<readonly string[]>([]);
  const [showIds, setShowIds] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSelected(
      scenario === 'over-limit' ? selectionIds : scenario === 'hidden' ? [items[2].id] : [],
    );
    setPage(0);
    setMessage('');
  }, [scenario]);
  // The isolated adapter owns query/page simulation. Production DataTable never filters or sorts a server page.
  const all = items.filter((i) => (!category || i.skuId === skuId) && i.name.includes(query));
  const sorted = [...all].sort((a, b) =>
    sort[0] ? a.name.localeCompare(b.name, 'zh-CN') * (sort[0].desc ? -1 : 1) : 0,
  );
  const loaded = sorted.slice(page * 2, page * 2 + 2);
  const snapshot: SelectionSnapshot = {
    scope: `示例家庭 ${householdId}`,
    ids: selected,
    visibleIds: loaded.map((i) => i.id),
    revisions: Object.fromEntries(
      items.filter((i) => selected.includes(i.id)).map((i) => [i.id, i.revision]),
    ),
    limit: 100,
  };
  const columns: DataTableColumn<ItemView>[] = [
    { id: 'name', label: '物品', sortable: true, cell: (item) => <ItemIdentity item={item} /> },
    {
      id: 'location',
      label: '位置',
      cell: (item) => (
        <LocationPath location={item.location} state={item.location.id ? 'known' : 'unknown'} />
      ),
    },
    { id: 'revision', label: '版本', cell: (item) => item.revision },
  ];
  return (
    <div className="vn-stack review-composition review-composition--wide">
      <PageHeader
        title="管理选择场景"
        context="测试数据 · 分类树、逐件选择与已加载页面是不同范围"
      />
      <div className="review-management-layout">
        <section aria-label="商品分类">
          <Button
            variant="quiet"
            onClick={() => {
              setCategory(null);
              setPage(0);
            }}
          >
            所有分类
          </Button>
          <TreeView
            label="商品目录"
            nodes={[{ id: foodId, label: '食品', children: [{ id: skuId, label: '燕麦饮' }] }]}
            selectedId={category}
            onSelectionChange={(id) => {
              setCategory(id);
              setPage(0);
            }}
            expandedIds={expandedTree}
            onExpandedChange={setExpandedTree}
          />
        </section>
        <DataTable
          rows={loaded}
          columns={columns}
          caption="具体物品 · 隔离示例"
          getRowLabel={(i) => i.name}
          sorting={sort}
          onSortingChange={(next) => {
            setSort(next);
            setPage(0);
          }}
          filterValue={query}
          onFilterChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
          selectedIds={selected}
          onSelectionChange={setSelected}
          onOpen={(id) => setMessage(`查看物品：${id}`)}
          pagination={{
            pageIndex: page,
            pageSize: 2,
            knownTotal: scenario === 'unknown-total' ? null : all.length,
            hasPrevious: page > 0,
            hasNext: (page + 1) * 2 < all.length,
          }}
          onPageChange={setPage}
          expandedIds={expandedRows}
          onExpandedChange={setExpandedRows}
        />
      </div>
      <BatchSelectionBar
        selection={snapshot}
        expanded={showIds}
        onExpandedChange={setShowIds}
        onRemove={(id) => setSelected(selected.filter((value) => value !== id))}
        onClear={() => setSelected([])}
        onReview={() => {
          setShowIds(true);
          setMessage('身份清单已展开。请核对隐藏选择和版本。');
        }}
        actionLabel="预览移动范围"
        onStartAction={(selection) => {
          setShowIds(true);
          setMessage(`已核对 ${selection.ids.length} 个明确 Item UUID。仅展示范围，没有执行移动。`);
        }}
      />
      {message && (
        <InlineNotice tone="info" title="预览反馈">
          {message}
        </InlineNotice>
      )}
    </div>
  );
}
