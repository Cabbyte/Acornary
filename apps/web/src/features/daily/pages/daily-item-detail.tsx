import { useState } from 'react';
import { Package } from 'lucide-react';
import { Button } from '../../../ui/components/ui/button';
import { Tabs } from '../../../ui/components/ui/tabs';
import { PageHeader } from '../../../ui/patterns/page-header';
import { ItemStatus } from '../../../ui/patterns/item-status';
import { QuantityValue } from '../../../ui/patterns/quantity-value';
import { DateFactValue } from '../../../ui/patterns/date-fact-value';
import { LocationPath } from '../../../ui/patterns/location-path';
import { HistoryEntry } from '../../../ui/patterns/history-entry';
import { EmptyState } from '../../../ui/patterns/empty-state';
import { ReadContent } from './read-content';
import type { DailyItemProps } from './models';
import './daily-pages.css';

export function DailyItemDetail(props: DailyItemProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const item = props.facts?.item;
  const canRead = props.state === 'ready' || props.state === 'offline-partial';
  return (
    <section className="vn-daily-page">
      <PageHeader
        title={
          canRead && item
            ? item.redactedPaths.includes('display_name') || item.redactedPaths.includes('name')
              ? '物品名称不可见'
              : item.name
            : '物品档案'
        }
        onBack={props.onBack}
        secondaryActions={
          canRead && item && props.onTask
            ? [
                {
                  id: 'move',
                  label: '移动',
                  availability: { kind: 'available' },
                  onAction: () => props.onTask?.('move', item.id),
                },
                ...(item.profile === 'CONSUMABLE'
                  ? [
                      {
                        id: 'consume',
                        label: '使用',
                        availability: { kind: 'available' as const },
                        onAction: () => props.onTask?.('consume', item.id),
                      },
                    ]
                  : []),
              ]
            : undefined
        }
        context={
          canRead && item ? (
            <>
              <span>{item.subtitle}</span>
              <ItemStatus status={item.status} recordState={item.recordState} />
            </>
          ) : undefined
        }
      />
      <ReadContent state={props.state} onRetry={props.onRetry}>
        {item && props.facts && (
          <>
            {props.onNavigate && (
              <div className="vn-row">
                {[
                  ['opening', '开封'],
                  ['dates', '日期'],
                  ['notes', '笔记'],
                  ['attachments', '附件'],
                  ['labels', '标签'],
                ].map(([route, label]) => (
                  <Button
                    variant="quiet"
                    key={route}
                    onClick={() => props.onNavigate?.(`/daily/${route}?target=${item.id}`)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  variant="quiet"
                  onClick={() => props.onNavigate?.(`/manage/edit?target=${item.id}`)}
                >
                  精确编辑
                </Button>
              </div>
            )}
            <div className="vn-daily-key-facts">
              <div>
                <h2>存放位置</h2>
                <LocationPath
                  location={item.location}
                  state={
                    item.redactedPaths.includes('parent_item_id')
                      ? 'redacted'
                      : item.location.id
                        ? 'known'
                        : 'unknown'
                  }
                />
              </div>
              <div>
                <h2>{item.profile === 'CONSUMABLE' ? '剩余数量' : '数量'}</h2>
                <QuantityValue quantity={props.facts.quantity} />
              </div>
              <div>
                <h2>
                  {props.facts.date?.dateKind === 'BEST_BEFORE'
                    ? '最佳食用期'
                    : props.facts.date?.dateKind === 'USE_BY'
                      ? '限用日期'
                      : props.facts.date?.label || '日期'}
                </h2>
                {props.facts.date ? (
                  <DateFactValue fact={props.facts.date} compact dateOnly />
                ) : (
                  <p className="vn-muted">未记录</p>
                )}
              </div>
            </div>
            <Tabs
              label="物品资料"
              variant="line"
              value={props.tab}
              onValueChange={(tab) => props.onTabChange(tab as DailyItemProps['tab'])}
              items={[
                {
                  value: 'overview',
                  label: '概览',
                  content: (
                    <div className="vn-daily-overview">
                      <section className="vn-daily-section">
                        <h2>商品资料</h2>
                        {props.product ? (
                          <>
                            <Button
                              variant="quiet"
                              className="vn-daily-product-link"
                              onClick={() => props.onOpenProduct(props.product!.group.id)}
                            >
                              <Package size={18} aria-hidden="true" />
                              {props.product.group.name}
                            </Button>
                            <p className="vn-muted">{props.product.subtitle}</p>
                            <p className="vn-muted">
                              分类 · {props.product.catalogPath.join(' › ') || '未记录'}
                            </p>
                          </>
                        ) : (
                          <p className="vn-muted">未取得商品资料</p>
                        )}
                      </section>
                      <section className="vn-daily-section">
                        <h2>单件资料</h2>
                        {item.facts
                          .filter((fact) => fact.kind !== 'remaining' && fact.kind !== 'expiry')
                          .map((fact) => (
                            <p key={`${fact.kind}:${fact.label}`}>
                              {fact.label} · {fact.value}
                            </p>
                          ))}
                        <details className="vn-daily-technical">
                          <summary>身份与版本</summary>
                          <dl>
                            <dt>物品 ID</dt>
                            <dd>{item.id}</dd>
                            <dt>商品 ID</dt>
                            <dd>{item.skuId}</dd>
                            <dt>版本</dt>
                            <dd>{item.revision}</dd>
                          </dl>
                        </details>
                      </section>
                      {props.facts.date && (
                        <section className="vn-daily-section">
                          <h2>日期依据</h2>
                          <DateFactValue fact={props.facts.date} presentation="detail" />
                        </section>
                      )}
                    </div>
                  ),
                },
                {
                  value: 'notes',
                  label: '笔记',
                  content: props.notes.length ? (
                    <div className="vn-daily-notes">
                      {props.notes.map((note) => (
                        <article key={note.id}>
                          <h2>{note.title || '笔记'}</h2>
                          <p>{note.body ?? note.excerpt}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState reason="empty" title="还没有笔记" />
                  ),
                },
                {
                  value: 'history',
                  label: '历史',
                  content: props.history.length ? (
                    <div className="vn-daily-history">
                      {props.history.map((entry, index) => {
                        const id = entry.event?.id || String(index);
                        return (
                          <HistoryEntry
                            key={id}
                            {...entry}
                            expanded={expanded.has(id)}
                            onExpandedChange={(open) =>
                              setExpanded((before) => {
                                const next = new Set(before);
                                if (open) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <EmptyState reason="empty" title="当前没有历史记录" />
                  ),
                },
              ]}
            />
          </>
        )}
      </ReadContent>
    </section>
  );
}
