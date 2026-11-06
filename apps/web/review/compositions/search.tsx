import { useEffect, useState } from 'react';
import { Button } from '../../src/ui/components/ui/button';
import { Tabs } from '../../src/ui/components/ui/tabs';
import { InlineNotice } from '../../src/ui/components/ui/inline-notice';
import { PaginationControls } from '../../src/ui/components/ui/pagination-controls';
import { SearchBar } from '../../src/ui/patterns/search-bar';
import { FilterBar } from '../../src/ui/patterns/filter-bar';
import { PageHeader } from '../../src/ui/patterns/page-header';
import { ItemRow } from '../../src/ui/patterns/item-row';
import { ProductSummary } from '../../src/ui/patterns/product-summary';
import { EmptyState } from '../../src/ui/patterns/empty-state';
import { LoadingState } from '../../src/ui/patterns/loading-state';
import { items, searchItems, group, fridgeId } from '../fixtures';
import type { ReviewDemoProps } from '../types';
export function SearchComposition({ scenario }: ReviewDemoProps) {
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [located, setLocated] = useState(false);
  const [tab, setTab] = useState('items');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setQuery(scenario === 'empty' ? '不存在的物品' : '');
    setApplied(scenario === 'empty' ? '不存在的物品' : '');
    setPage(0);
    setMessage('');
  }, [scenario]);
  const pageSize = 6;
  const filtered = searchItems.filter(
    (i) =>
      `${i.name} ${i.subtitle} ${i.location.path.join(' ')}`.includes(applied) &&
      (!located || i.location.id === fridgeId),
  );
  const pageItems = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const loading = scenario === 'loading';
  const itemList = (
    <div className="vn-stack">
      {loading ? (
        <LoadingState label="正在查找物品" />
      ) : pageItems.length ? (
        pageItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            quantity={
              item.id === items[0].id
                ? { value: '310.0', unit: 'mL', accuracy: 'estimated' }
                : item.skuId === group.id
                  ? { value: null, unit: 'mL', accuracy: 'unknown' }
                  : undefined
            }
            date={
              item.id === items[0].id
                ? {
                    kind: 'EXPIRY',
                    dateKind: 'BEST_BEFORE',
                    dueOn: '2026-11-10',
                    basis: '包装标注',
                    state: 'UPCOMING',
                    source: 'LIFECYCLE',
                    label: '最佳食用期',
                  }
                : undefined
            }
            onOpen={(id) => setMessage(`已选中物品 ${id}。此组合不进入完整档案页。`)}
            onOpenLocation={(id) => setMessage(`查看位置意图：${id}`)}
            actions={[
              {
                kind: item.profile === 'CONSUMABLE' ? 'consume' : 'move',
                label: item.profile === 'CONSUMABLE' ? '使用' : '移动',
                availability:
                  scenario === 'offline'
                    ? { kind: 'offline', reason: '离线时仅可查看已有缓存。' }
                    : { kind: 'available' },
              },
            ]}
            onAction={(kind, id) =>
              setMessage(`已记录 ${kind} 意图，目标为 ${id}；未发送业务请求。`)
            }
          />
        ))
      ) : (
        <EmptyState
          reason="no-match"
          recoveryAction={
            <Button
              variant="secondary"
              onClick={() => {
                setQuery('');
                setApplied('');
                setLocated(false);
                setPage(0);
              }}
            >
              清除查询
            </Button>
          }
        />
      )}
      <PaginationControls
        pageIndex={page}
        pageSize={pageSize}
        loadedCount={pageItems.length}
        knownTotal={scenario === 'offline' ? null : filtered.length}
        hasPrevious={page > 0}
        hasNext={(page + 1) * pageSize < filtered.length}
        onPageChange={setPage}
        loading={loading}
      />
    </div>
  );
  return (
    <div className="vn-stack review-composition review-composition--wide">
      <PageHeader title="我的物品" />
      <div className="review-search-tools">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSearch={(q) => {
            setApplied(q);
            setPage(0);
          }}
          loading={loading}
          scanCapability={{ available: false, reason: '当前预览不支持扫码。' }}
        />
        <FilterBar
          scopeLabel={
            scenario === 'offline' ? '已缓存的示例物品' : `共 ${searchItems.length} 件物品`
          }
          filters={located ? [{ id: 'location', label: '位置', valueLabel: '厨房 / 冰箱' }] : []}
          onRemove={() => {
            setLocated(false);
            setPage(0);
          }}
          onClear={() => {
            setLocated(false);
            setPage(0);
          }}
          onOpenFilters={() => {
            setLocated(!located);
            setPage(0);
          }}
        />
      </div>
      {scenario === 'offline' && (
        <InlineNotice tone="warning" title="缓存范围有限">
          这里只显示已提供的缓存示例，总库存数量未知。
        </InlineNotice>
      )}
      <Tabs
        value={tab}
        onValueChange={setTab}
        label="结果种类"
        items={[
          { value: 'items', label: '物品', content: itemList },
          {
            value: 'products',
            label: '商品摘要',
            content: filtered.some((i) => i.skuId === group.id) ? (
              <ProductSummary
                group={group}
                coverage={scenario === 'offline' ? 'cached-subset' : 'live'}
                knownItemCount={scenario === 'offline' ? null : group.count}
                onOpenItems={() => {
                  setTab('items');
                  setQuery('燕麦饮');
                  setApplied('燕麦饮');
                  setPage(0);
                }}
                onIntake={(id) => setMessage(`已记录商品 ${id} 的入库入口意图；没有创建库存。`)}
              />
            ) : (
              <EmptyState reason="no-match" />
            ),
          },
        ]}
      />
      {message && (
        <InlineNotice tone="info" title="预览反馈">
          {message}
        </InlineNotice>
      )}
    </div>
  );
}
