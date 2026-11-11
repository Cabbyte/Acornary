import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyItemFacts } from '../../apps/web/src/features/daily/pages/models';
import type { ManagementDraft } from '../../apps/web/src/app-vnext/management-task';
import {
  createManagementSession,
  freezeManagementAttempt,
  managementTaskView,
} from '../../apps/web/src/app-vnext/management-task';
import {
  createManagementFixtureSession,
  executeManagementFixtureAttempt,
} from '../../apps/web/review/pages/management-task-adapter';
import { itemFacts } from '../../apps/web/review/pages/fixtures';

const f = vi.hoisted(() => ({
  scope: {
    environment: 'isolated-trial',
    accountId: 'a',
    householdId: 'h',
    datasetId: 'd',
    clientId: 'web',
    generation: 1,
  },
  state: {} as Record<string, unknown>,
  world: { items: [] as DailyItemFacts[], receipts: {} as Record<string, string[]> },
  saveFailure: false,
  writes: 0,
  savedOperation: null as unknown,
}));
vi.mock('../../apps/web/review/trial/application', () => ({ getFixtureScope: () => f.scope }));
vi.mock('../../apps/web/review/trial/session', () => ({
  isTrial: () => true,
  getTrialScope: () => ({ role: 'member' }),
}));
vi.mock('../../apps/web/review/trial/storage', () => ({
  flushReviewStorage: async () => {},
  reviewStorage: {
    getItem: () => (f.savedOperation ? JSON.stringify(f.savedOperation) : null),
    setItem: (_key: string, value: string) => {
      f.savedOperation = JSON.parse(value);
    },
  },
  runReviewTransaction: (fn: () => unknown) => {
    const world = structuredClone(f.world);
    const state = structuredClone(f.state);
    try {
      return fn();
    } catch (error) {
      f.world = world;
      f.state = state;
      throw error;
    }
  },
}));
vi.mock('../../apps/web/review/pages/management-storage', () => ({
  readManagementState: () => f.state,
  writeManagementState: (state: Record<string, unknown>) => {
    if (f.saveFailure) throw Error('journal failure');
    f.state = structuredClone(state);
  },
}));
vi.mock('../../apps/web/review/pages/inventory-session', () => ({
  getReviewWorld: () => f.world,
  updateReviewItems: (rows: DailyItemFacts[], metadata: { requestKey: string }) => {
    f.writes++;
    f.world.items = f.world.items.map(
      (row) => rows.find((value) => value.item.id === row.item.id) || row,
    );
    f.world.receipts[metadata.requestKey] = rows.map((row) => row.item.id);
  },
}));

const id = (n: number) => `item_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function make(kind: string, count = 1): ManagementDraft {
  const task: ManagementDraft['task'] = {
    taskId: 'key-1',
    kind,
    title: kind,
    description: '',
    phase: 'review',
    confirmLabel: '',
    fields: [{ key: 'destination', label: '', value: 'root' }],
    impact: [],
    targetIds: Array.from({ length: count }, (_, i) => id(i + 1)),
    snapshot: Array.from({ length: count }, (_, i) => ({
      id: id(i + 1),
      revision: 3,
      name: 'original',
      path: '',
    })),
    draft: {
      name: { mode: 'set', value: 'updated' },
      binding: {
        template_id: 'lifecycle',
        template_version: 2,
        status: 'KNOWN',
        values: { condition: 'GOOD' },
      },
      changedAttributes: ['condition'],
    },
  };
  return { task, bindings: {} };
}
const freeze = (draft: ManagementDraft) =>
  freezeManagementAttempt(
    draft,
    Object.fromEntries(draft.task.snapshot.map((row) => [row.id, row.revision])),
  );
const run = (draft: ManagementDraft, scenario = 'default', recovering = false) =>
  executeManagementFixtureAttempt(f.scope, freeze(draft), 'trial', scenario, recovering);

beforeEach(() => {
  f.writes = 0;
  f.savedOperation = null;
  f.saveFailure = false;
  f.world = {
    items: [1, 2].map((n) => ({
      ...structuredClone(itemFacts[0]),
      item: {
        ...structuredClone(itemFacts[0].item),
        id: id(n),
        revision: 3,
        profile: 'CONSUMABLE',
        recordState: 'VALID',
        name: `item ${n}`,
        status: { label: '未开封', tone: 'neutral' },
      },
    })),
    receipts: {},
  };
  f.state = {
    catalogs: [],
    locations: [],
    explicitNames: {},
    receipts: {},
    bindings: {},
    itemDrafts: {},
    editId: null,
    nameDraft: { mode: 'unchanged', value: '' },
    attributeDraft: null,
    changedAttributes: [],
    task: null,
    retainedTask: null,
  };
});

describe('isolated management adapter', () => {
  it('keeps unsupported legacy uncertain tasks visibly uncertain instead of converting them into a fresh editable draft', () => {
    const legacy = make('bulk-lifecycle');
    legacy.task.phase = 'unknown';
    const session = createManagementFixtureSession(legacy);
    expect(session.getSnapshot().state).toBe('validationError');
    expect(managementTaskView(session.getSnapshot()).phase).toBe('unknown');
    expect(f.savedOperation).toBeNull();
  });
  it('loads the root draft without overwriting reconciled versions and key with an older page snapshot', async () => {
    const old = make('item-save');
    const root = createManagementSession(
      f.scope,
      old,
      { load: () => null, save: () => {} },
      () => f.scope,
    );
    await root.update({ state: 'revisionConflict' });
    const reconciled = structuredClone(old);
    reconciled.requestKey = 'reviewed-new-intent';
    reconciled.task.snapshot = [{ ...old.task.snapshot[0], revision: 4 }];
    await root.reconcile(reconciled, { [id(1)]: 4 }, reconciled);
    f.savedOperation = root.getSnapshot();
    const reloaded = createManagementFixtureSession(old);
    expect(reloaded.getSnapshot().draft).toEqual(reconciled);
    expect(reloaded.getSnapshot().revisions[id(1)]).toBe(4);
  });
  it('returns the original receipt after a lost response without mutating revisions twice', async () => {
    const draft = make('bulk-consume', 2);
    await expect(run(draft, 'network-unknown')).rejects.toMatchObject({ code: 'NETWORK' });
    expect(f.world.items.map((row) => row.item.revision)).toEqual([4, 4]);
    await expect(run(draft, 'network-unknown', true)).resolves.toHaveProperty('receipt');
    expect(f.writes).toBe(1);
    expect(f.world.items.map((row) => row.item.revision)).toEqual([4, 4]);
  });

  it('rejects same-key changed parameters even when both payloads satisfy the schema', async () => {
    const draft = make('item-save');
    await run(draft);
    draft.task.draft!.name.value = 'different but valid';
    await expect(run(draft, 'default', true)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(f.world.items[0].item.name).toBe('updated');
    expect(f.writes).toBe(1);
  });

  it('rejects an entire stale or mixed-capability batch before any update', async () => {
    const draft = make('bulk-consume', 2);
    f.world.items[1].item.revision = 4;
    await expect(run(draft)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(f.writes).toBe(0);
    f.world.items[1].item.revision = 3;
    f.world.items[1].item.profile = 'DURABLE';
    await expect(run(draft)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(f.writes).toBe(0);
    expect(f.world.receipts).toEqual({});
  });

  it('rolls back both facts and receipt when the management journal fails', async () => {
    const before = structuredClone(f.world);
    f.saveFailure = true;
    await expect(run(make('bulk-consume', 2))).rejects.toThrow('journal failure');
    expect(f.world).toEqual(before);
    expect(f.state.receipts).toEqual({});
  });

  it('preserves unknown current attributes and typed date facts when applying a narrow patch', async () => {
    f.state.bindings = {
      [id(1)]: {
        template_id: 'lifecycle',
        template_version: 2,
        status: 'KNOWN',
        values: {
          legacy: { untouched: true },
          expiry: { date: '2026-12-01', date_kind: 'USE_BY' },
        },
      },
    };
    await run(make('attribute-save'));
    expect(f.state.bindings).toMatchObject({
      [id(1)]: {
        values: {
          legacy: { untouched: true },
          expiry: { date: '2026-12-01', date_kind: 'USE_BY' },
          condition: 'GOOD',
        },
      },
    });
    expect(f.world.items[0].date?.dateKind).toBe('USE_BY');
  });

  it('never interprets an unavailable destination as root', async () => {
    const draft = make('item-move');
    draft.task.fields = [{ key: 'destination', label: '', value: id(999) }];
    await expect(run(draft)).rejects.toMatchObject({ code: 'INVALID_PARENT' });
    expect(f.writes).toBe(0);
  });

  it('recovers an older receipt only when the retained original parameters match', async () => {
    const draft = make('item-save');
    f.state.receipts = { 'key-1': 'legacy receipt' };
    f.state.task = structuredClone(draft.task);
    await expect(run(draft, 'default', true)).resolves.toEqual({ receipt: 'legacy receipt' });
    draft.task.draft!.name.value = 'different';
    await expect(run(draft, 'default', true)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    expect(f.writes).toBe(0);
  });
});
