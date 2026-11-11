import './daily-pages.css';
import type { ReactNode } from 'react';
import { Input } from '../../../ui/components/ui/input';
import { FormField } from '../../../ui/components/ui/form-field';
import { Select } from '../../../ui/components/ui/select';
import { Button } from '../../../ui/components/ui/button';
import { InlineNotice } from '../../../ui/components/ui/inline-notice';
import { PageHeader } from '../../../ui/patterns/page-header';
import { OperationSheet, type OperationSheetAction } from '../../../ui/patterns/operation-sheet';
import { QuantityInput } from '../../../ui/patterns/quantity-input';
import {
  LocationPicker,
  type LocationCandidate,
  type LocationSelection,
} from '../../../ui/patterns/location-picker';
import {
  CatalogPicker,
  type CatalogCandidate,
  type CatalogSelection,
} from '../../../ui/patterns/catalog-picker';
import type { OperationState, QuantityPresentation } from '../../../ui/patterns/types';
import type { DailyItemFacts } from './models';
export type DailyTaskKind = 'intake' | 'new-product' | 'consume' | 'move';
export interface DailyTaskDraft {
  name: string;
  count: string;
  catalog: CatalogSelection;
  location: LocationSelection;
  quantity: QuantityPresentation;
  finish: boolean;
  dates: string[];
}
export interface DailyTaskProps {
  kind: DailyTaskKind;
  title: string;
  taskId: string;
  state: OperationState;
  draft: DailyTaskDraft;
  onChange: (draft: DailyTaskDraft) => void;
  item: DailyItemFacts | null;
  catalogCandidates: readonly CatalogCandidate[];
  locations: readonly LocationCandidate[];
  catalogQuery: string;
  locationQuery: string;
  onCatalogQuery: (query: string) => void;
  onLocationQuery: (query: string) => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onBack: () => void;
  reviewing: boolean;
  error?: string;
  summary: readonly string[];
  actions: readonly OperationSheetAction[];
  onAction: (id: string) => void;
  recovery?: ReactNode;
}
/** Controlled task view. Commands, receipts, persistence and approval authority live outside UI. */
export function DailyTask(p: DailyTaskProps) {
  const intake = p.kind === 'intake' || p.kind === 'new-product';
  const change = (patch: Partial<DailyTaskDraft>) => p.onChange({ ...p.draft, ...patch });
  return (
    <section className="vn-daily-page">
      <PageHeader title={p.title} onBack={p.onBack} />
      <Button onClick={p.onOpen}>{p.state === 'success' ? '查看结果' : '继续任务'}</Button>
      <OperationSheet
        open={p.open}
        operation={{
          taskId: p.taskId,
          state: p.state,
          title: p.title,
          closePolicy: p.state === 'success' ? 'allow' : 'retain',
          scopeLabel:
            !intake && p.item ? `${p.item.item.name} · …${p.item.item.id.slice(-8)}` : undefined,
        }}
        onClose={p.onClose}
        onRetainAndClose={p.onClose}
        onAction={p.onAction}
        actions={p.actions}
        recoveryContent={p.recovery}
      >
        {p.error && <InlineNotice tone="danger" title={p.error} />}
        {p.reviewing || !['draft', 'validationError'].includes(p.state) ? (
          <div className="vn-daily-task-stack">
            {p.summary.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          <div className="vn-daily-task-stack">
            {p.kind === 'new-product' && (
              <FormField label="商品名称" required>
                <Input value={p.draft.name} onChange={(e) => change({ name: e.target.value })} />
              </FormField>
            )}
            {intake && (
              <>
                <CatalogPicker
                  value={p.draft.catalog}
                  onValueChange={(catalog) => change({ catalog })}
                  candidates={p.catalogCandidates}
                  allowedKinds={[p.kind === 'intake' ? 'SKU' : 'GROUP']}
                  query={p.catalogQuery}
                  onQueryChange={p.onCatalogQuery}
                />
                <FormField label="件数" required>
                  <Input
                    inputMode="numeric"
                    value={p.draft.count}
                    onChange={(e) => change({ count: e.target.value })}
                  />
                </FormField>
                <details>
                  <summary>逐件日期（可选）</summary>
                  <p>最佳食用期 · 包装标注。未填写保持未知。</p>
                  {Array.from(
                    { length: Math.min(100, Math.max(1, Number(p.draft.count) || 1)) },
                    (_, i) => (
                      <FormField key={i} label={`第 ${i + 1} 件`}>
                        <Input
                          type="date"
                          value={p.draft.dates[i] || ''}
                          onChange={(e) => {
                            const dates = [...p.draft.dates];
                            dates[i] = e.target.value;
                            change({ dates });
                          }}
                        />
                      </FormField>
                    ),
                  )}
                </details>
              </>
            )}
            {p.kind === 'consume' && (
              <>
                <p>
                  当前剩余：{p.item?.quantity.accuracy === 'estimated' ? '约 ' : ''}
                  {p.item?.quantity.value ?? '未知'} {p.item?.quantity.unit}
                </p>
                <Select
                  label="使用方式"
                  value={p.draft.finish ? 'finish' : 'partial'}
                  onValueChange={(v) => change({ finish: v === 'finish' })}
                  options={[
                    { value: 'partial', label: '部分使用' },
                    { value: 'finish', label: '整件用完' },
                  ]}
                />
                {!p.draft.finish && (
                  <QuantityInput
                    value={p.draft.quantity}
                    onChange={(quantity) => change({ quantity })}
                    units={[
                      {
                        value: p.item?.quantity.unit || 'mL',
                        label: p.item?.quantity.unit || 'mL',
                      },
                    ]}
                    maximum={p.item?.quantity.value ?? undefined}
                    label="本次使用"
                  />
                )}
              </>
            )}
            {(intake || p.kind === 'move') && (
              <LocationPicker
                value={p.draft.location}
                onValueChange={(location) => change({ location })}
                candidates={p.locations}
                query={p.locationQuery}
                onQueryChange={p.onLocationQuery}
                rootPolicy={{ allowed: true }}
                unknownPolicy={{ allowed: intake }}
              />
            )}
          </div>
        )}
      </OperationSheet>
    </section>
  );
}
