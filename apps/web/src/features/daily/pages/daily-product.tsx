import { useRef } from 'react';
import { PageHeader } from '../../../ui/patterns/page-header';
import { ProductSummary } from '../../../ui/patterns/product-summary';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { PaginationControls } from '../../../ui/components/ui/pagination-controls';
import { DailyItemList } from './browse-content';
import { ReadContent } from './read-content';
import type { DailyProductProps } from './models';

export function DailyProduct(props: DailyProductProps) {
  const list = useRef<HTMLElement>(null);
  return (
    <section className="vn-daily-page">
      <PageHeader title="商品资料" onBack={props.onBack} />
      <ReadContent state={props.state} onRetry={props.onRetry}>
        {props.product && (
          <>
            <div className="vn-daily-product-heading">
              <p>{props.product.subtitle}</p>
              <p className="vn-muted">分类 · {props.product.catalogPath.join(' › ') || '未记录'}</p>
            </div>
            <ProductSummary
              group={props.product.group}
              nextDate={props.product.date ?? null}
              coverage={props.state === 'offline-partial' ? 'cached-subset' : 'live'}
              knownItemCount={props.state === 'offline-partial' ? null : props.product.group.count}
              onIntake={props.onTask ? (id) => props.onTask?.('intake', id) : undefined}
              onOpenItems={() => {
                list.current?.scrollIntoView({ block: 'nearest' });
                list.current?.focus({ preventScroll: true });
              }}
            />
            <section
              ref={list}
              tabIndex={-1}
              className="vn-daily-section"
              aria-label="这款商品的物品"
            >
              <h2>这款商品的物品</h2>
              {props.items.length ? (
                <>
                  <DailyItemList items={props.items} onOpen={props.onOpenItem} />
                  <PaginationControls {...props.pagination} />
                </>
              ) : (
                <EmptyState reason="empty" title="尚未记录这款商品的实物" />
              )}
            </section>
          </>
        )}
      </ReadContent>
    </section>
  );
}
