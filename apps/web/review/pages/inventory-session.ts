// Local review world only. Never import from production sources.
import { useSyncExternalStore } from 'react';
import Decimal from 'decimal.js';
import { itemFacts, history as baseHistory } from './fixtures';
import type { DailyTaskDraft, DailyTaskKind } from '../../src/features/daily/pages/daily-task';
import type { DailyItemFacts, DailyItemProps } from '../../src/features/daily/pages/models';
interface Snapshot {
  items: DailyItemFacts[];
  history: DailyItemProps['history'];
  receipts: Record<string, string[]>;
}
const storageKey = 'acornary-review-world-rc2';
let snapshot: Snapshot = {
  items: structuredClone(itemFacts),
  history: structuredClone(baseHistory),
  receipts: {},
};
let initialized = false;
const listeners = new Set<() => void>();
function initialize() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const value = JSON.parse(raw);
      if (Array.isArray(value.items) && Array.isArray(value.history) && value.receipts)
        snapshot = value;
    }
  } catch {
    /* storage failure is checked again before writes */
  }
}
export function getReviewWorld() {
  initialize();
  return snapshot;
}
export function useReviewWorld() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getReviewWorld,
    getReviewWorld,
  );
}
export function applyReviewTask(
  key: string,
  kind: DailyTaskKind,
  draft: DailyTaskDraft,
  target?: string,
): string[] {
  initialize();
  if (snapshot.receipts[key]) return snapshot.receipts[key];
  const next = structuredClone(snapshot);
  const targetId = target || itemFacts[0].item.id;
  const current = next.items.find((f) => f.item.id === targetId);
  const ids: string[] = [];
  const location =
    draft.location.kind === 'item'
      ? { id: draft.location.itemId, label: draft.location.name, path: [...draft.location.path] }
      : { id: null, label: '位置未记录', path: [] };
  if (kind === 'intake' || kind === 'new-product') {
    const prototype = next.items.find((f) => f.item.skuId === draft.catalog?.id) || itemFacts[0];
    for (let i = 0; i < Number(draft.count); i++) {
      const id = `item_${crypto.randomUUID()}`;
      ids.push(id);
      const facts: DailyItemFacts = {
        item: {
          ...structuredClone(prototype.item),
          id,
          skuId: kind === 'new-product' ? `catalog_node_${key}` : draft.catalog!.id,
          name:
            kind === 'new-product'
              ? draft.name
              : next.items.some((f) => f.item.skuId === draft.catalog?.id)
                ? prototype.item.name
                : draft.catalog!.name,
          subtitle: kind === 'new-product' ? '' : prototype.item.subtitle,
          profile: kind === 'new-product' ? null : prototype.item.profile,
          attention: [],
          attachmentCount: 0,
          voidedAt: null,
          recordState: 'VALID',
          revision: 1,
          location,
          status: { label: '开封状态未记录', tone: 'neutral' },
          facts: [],
          noteCount: 0,
        },
        quantity: { value: null, unit: '', accuracy: 'unknown' },
      };
      if (draft.dates[i])
        facts.date = {
          kind: 'EXPIRY',
          dateKind: 'BEST_BEFORE',
          dueOn: draft.dates[i],
          basis: '包装标注',
          source: 'LIFECYCLE',
          state:
            draft.dates[i] < '2026-11-07'
              ? 'OVERDUE'
              : draft.dates[i] === '2026-11-07'
                ? 'DUE'
                : 'UPCOMING',
          label: '最佳食用期',
        };
      next.items.push(facts);
    }
  } else {
    if (!current) throw Error('示例对象已不可用');
    ids.push(current.item.id);
    current.item.revision++;
    if (kind === 'move') current.item.location = location;
    else {
      current.quantity = {
        ...current.quantity,
        value: draft.finish
          ? '0'
          : new Decimal(current.quantity.value!).minus(draft.quantity.value!).toString(),
        accuracy: draft.quantity.accuracy,
      };
      if (draft.finish) current.item.status = { label: '已用完', tone: 'neutral' };
    }
  }
  for (const id of ids) {
    const f = next.items.find((f) => f.item.id === id)!;
    const before = snapshot.items.find((item) => item.item.id === id);
    next.history = [
      {
        ...baseHistory[0],
        operationLabel: {
          intake: '新增实物',
          'new-product': '新商品入库',
          consume: '记录使用',
          move: '移动物品',
        }[kind],
        objectLabel: f.item.name,
        event: {
          ...baseHistory[0].event!,
          id: `event_${crypto.randomUUID()}`,
          operation_id: `operation_${key}`,
          target_id: id,
          before_revision: kind === 'intake' || kind === 'new-product' ? 0 : f.item.revision - 1,
          after_revision: f.item.revision,
          occurred_at: '2026-11-07T08:00:00Z',
          recorded_at: '2026-11-07T08:00:00Z',
          reason: '隔离预览操作',
          changes: [
            {
              path:
                kind === 'move'
                  ? 'parent_item_id'
                  : kind === 'consume'
                    ? 'contents.remaining'
                    : 'catalog_node_id',
              before_present: Boolean(before),
              before:
                kind === 'move'
                  ? before?.item.location.id
                  : kind === 'consume'
                    ? before?.quantity
                    : undefined,
              after_present: true,
              after: kind === 'move' ? location.id : kind === 'consume' ? f.quantity : f.item.skuId,
            },
          ],
        },
      },
      ...next.history,
    ];
  }
  next.receipts[key] = ids;
  sessionStorage.setItem(storageKey, JSON.stringify(next));
  snapshot = next;
  listeners.forEach((fn) => fn());
  return ids;
}

/** Review adapters upsert explicit UUID facts; omitted records are preserved. */
export function updateReviewItems(
  items: readonly DailyItemFacts[],
  metadata: {
    operationLabel?: string;
    reason?: string;
    eventType?: NonNullable<DailyItemProps['history'][number]['event']>['event_type'];
  } = {},
) {
  initialize();
  const patches = new Map(items.map((item) => [item.item.id, structuredClone(item)]));
  const next = structuredClone(snapshot);
  const operationId = `operation_${crypto.randomUUID()}`;
  next.items = next.items.map((item) => {
    const patch = patches.get(item.item.id);
    patches.delete(item.item.id);
    if (!patch) return item;
    const paths = [
      ['display_name', item.item.name, patch.item.name],
      ['parent_item_id', item.item.location.id, patch.item.location.id],
      ['record_state', item.item.recordState, patch.item.recordState],
      ['status', item.item.status, patch.item.status],
      ['catalog_node_id', item.item.skuId, patch.item.skuId],
      [
        'lifecycle.opening',
        item.item.facts.find((fact) => fact.kind === 'opening'),
        patch.item.facts.find((fact) => fact.kind === 'opening'),
      ],
      ['note_count', item.item.noteCount, patch.item.noteCount],
      ['contents.remaining', item.quantity, patch.quantity],
      ['lifecycle.expiry', item.date, patch.date],
    ] as const;
    const changes = paths
      .filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after))
      .map(([path, before, after]) => ({
        path,
        before_present: before !== undefined,
        after_present: after !== undefined,
        before,
        after,
      }));
    if (changes.length) {
      patch.item.revision = Math.max(item.item.revision + 1, patch.item.revision);
      next.history = [
        {
          ...baseHistory[0],
          operationLabel: metadata.operationLabel ?? '修改物品资料',
          objectLabel: patch.item.name,
          event: {
            ...baseHistory[0].event!,
            event_type: metadata.eventType ?? 'ITEM_UPDATED',
            id: `event_${crypto.randomUUID()}`,
            operation_id: operationId,
            target_id: patch.item.id,
            before_revision: item.item.revision,
            after_revision: patch.item.revision,
            occurred_at: '2026-11-07T08:00:00Z',
            recorded_at: '2026-11-07T08:00:00Z',
            reason: metadata.reason ?? '隔离预览操作',
            changes,
          },
        },
        ...next.history,
      ];
    }
    return patch;
  });
  next.items.push(...patches.values());
  sessionStorage.setItem(storageKey, JSON.stringify(next));
  snapshot = next;
  listeners.forEach((fn) => fn());
}
