import { useRef, useState } from 'react';
import { Button } from '../../../ui/components/ui/button';
import { Select } from '../../../ui/components/ui/select';
import { Sheet } from '../../../ui/components/ui/sheet';
import { Tabs } from '../../../ui/components/ui/tabs';
import { PaginationControls } from '../../../ui/components/ui/pagination-controls';
import { SearchBar } from '../../../ui/patterns/search-bar';
import { FilterBar } from '../../../ui/patterns/filter-bar';
import { ItemRow } from '../../../ui/patterns/item-row';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { ProductSummary } from '../../../ui/patterns/product-summary';
import { ReadContent } from './read-content';
import type { DailyBrowseProps, DailyItemFacts } from './models';
import './daily-pages.css';

export function DailyItemList({
  items,
  onOpen,
  onTask,
}: {
  items: readonly DailyItemFacts[];
  onOpen: (id: string) => void;
  onTask?: DailyBrowseProps['onTask'];
}) {
  return (
    <div className="vn-item-list">
      {items.map(({ item, quantity, date }) => (
        <ItemRow
          key={item.id}
          item={item}
          quantity={quantity}
          date={date}
          onOpen={onOpen}
          actions={
            onTask
              ? [
                  {
                    kind: 'consume',
                    label: '使用',
                    availability:
                      item.profile === 'CONSUMABLE'
                        ? { kind: 'available' }
                        : { kind: 'blockedState', reason: '此物品不支持消耗' },
                  },
                  { kind: 'move', label: '移动', availability: { kind: 'available' } },
                ]
              : undefined
          }
          onAction={(kind, id) => onTask?.(kind === 'consume' ? 'consume' : 'move', id)}
        />
      ))}
    </div>
  );
}

/** Only local filter drafts live here. Query/paging and all domain facts remain controlled. */
export function BrowseContent(props: DailyBrowseProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locationDraft, setLocationDraft] = useState<string | null>(null);
  const filterAnchor = useRef<HTMLDivElement>(null);
  const location = props.locations.find((entry) => entry.id === props.locationId);
  const empty = props.view === 'items' ? props.items.length === 0 : props.products.length === 0;
  const results = (
    <ReadContent state={props.state} onRetry={props.onRetry}>
      {empty ? (
        <EmptyState
          reason={props.query || props.locationId ? 'no-match' : 'empty'}
          title={!props.query && !props.locationId ? '还没有物品' : undefined}
          recoveryAction={
            props.query || props.locationId ? (
              <Button variant="secondary" onClick={props.onResetQuery}>
                清除条件
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {props.view === 'items' ? (
            <DailyItemList items={props.items} onOpen={props.onOpenItem} onTask={props.onTask} />
          ) : (
            <div className="vn-daily-products">
              {props.products.map((product) => (
                <ProductSummary
                  key={product.group.id}
                  group={product.group}
                  nextDate={product.date ?? null}
                  coverage={props.state === 'offline-partial' ? 'cached-subset' : 'live'}
                  knownItemCount={props.state === 'offline-partial' ? null : product.group.count}
                  onOpenItems={props.onOpenProduct}
                  onIntake={props.onTask ? (id) => props.onTask?.('intake', id) : undefined}
                />
              ))}
            </div>
          )}
          <PaginationControls {...props.pagination} />
        </>
      )}
    </ReadContent>
  );
  return (
    <>
      <SearchBar
        value={props.queryDraft}
        onChange={props.onQueryChange}
        onSearch={props.onSearch}
        placeholder="搜索物品名称"
      />
      <div className="vn-daily-browse-toolbar" ref={filterAnchor} tabIndex={-1}>
        <FilterBar
          filters={
            location
              ? [{ id: 'location', label: '位置', valueLabel: `${location.label}及下级` }]
              : []
          }
          onRemove={() => props.onLocationChange(null)}
          onClear={() => props.onLocationChange(null)}
          onOpenFilters={() => {
            setLocationDraft(props.locationId);
            setFiltersOpen(true);
          }}
        />
      </div>
      <Tabs
        label="查看范围"
        variant="line"
        value={props.view}
        onValueChange={(value) => props.onViewChange(value as DailyBrowseProps['view'])}
        items={[
          { value: 'items', label: '物品', content: props.view === 'items' ? results : null },
          { value: 'products', label: '商品', content: props.view === 'products' ? results : null },
        ]}
      />
      <Sheet
        title="筛选物品"
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        finalFocus={filterAnchor}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLocationDraft(null)}>
              重置
            </Button>
            <Button
              onClick={() => {
                props.onLocationChange(locationDraft);
                setFiltersOpen(false);
              }}
            >
              应用
            </Button>
          </>
        }
      >
        <Select
          label="存放位置（含下级）"
          value={locationDraft ?? ''}
          onValueChange={(value) => setLocationDraft(value || null)}
          options={[
            { value: '', label: '全部位置' },
            ...props.locations.map((entry) => ({ value: entry.id, label: entry.label })),
          ]}
        />
      </Sheet>
    </>
  );
}
