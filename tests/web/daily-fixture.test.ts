import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyItemFacts } from '../../apps/web/src/features/daily/pages/models.js';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope.js';

const fake = vi.hoisted(() => ({
  values: new Map<string, string>(),
  scope: {
    environment: 'isolated-trial',
    accountId: 'a',
    householdId: 'h',
    clientId: 'web-review',
    datasetId: 'trial-rc1-v1',
    generation: 1,
  } as ApplicationScope,
  world: { items: [] as DailyItemFacts[], receipts: {} as Record<string, string[]> },
  catalogs: [] as { id: string; kind: 'SKU'; revision: number }[],
  writes: 0,
  failStorage: false,
}));
vi.mock('../../apps/web/review/trial/session', () => ({
  getTrialScope: () => ({ ...fake.scope, role: 'owner' }),
  isTrial: () => true,
  subscribeTrialScope: () => () => {},
}));
vi.mock('../../apps/web/review/trial/application', () => ({ getFixtureScope: () => fake.scope }));
vi.mock('../../apps/web/review/trial/clock', () => ({
  trialInstant: () => '2026-11-11T14:30:00+08:00',
  trialToday: () => '2026-11-11',
}));
vi.mock('../../apps/web/review/trial/storage', () => ({
  reviewStorage: {
    getItem: (key: string) => fake.values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fake.failStorage) throw Error('disk full');
      fake.values.set(key, value);
    },
  },
  flushReviewStorage: async () => {},
  assertTrialWrite: () => {},
  runReviewTransaction: (fn: () => void) => fn(),
}));
vi.mock('../../apps/web/review/pages/inventory-session', () => ({
  getReviewWorld: () => fake.world,
  appendReviewEvent: () => {},
  updateReviewItems: (patches: DailyItemFacts[], metadata: { requestKey: string }) => {
    if (fake.world.receipts[metadata.requestKey]) return;
    fake.writes++;
    for (const patch of patches)
      fake.world.items = fake.world.items.map((entry) =>
        entry.item.id === patch.item.id ? structuredClone(patch) : entry,
      );
    fake.world.receipts[metadata.requestKey] = patches.map((patch) => patch.item.id);
  },
}));
vi.mock('../../apps/web/review/pages/management-storage', () => ({
  getManagementCatalogs: () => fake.catalogs,
  updateManagementCatalogRevision: (id: string, expected: number, after: number) => {
    const item = fake.catalogs.find((entry) => entry.id === id);
    if (!item || item.revision !== expected)
      throw Object.assign(Error('changed'), { code: 'REVISION_CONFLICT' });
    item.revision = after;
  },
}));
import { itemFacts } from '../../apps/web/review/pages/fixtures.js';
import {
  createState,
  createDailyFixtureTask,
  dailyFixtureRequest,
  getExtraReviewNotes,
  fixtureDailyRevisions,
} from '../../apps/web/review/pages/daily-extras-fixture.js';

const target = itemFacts[0].item.id;
const key = `acornary-review-daily-extras-v1:${target}:trial`;
beforeEach(() => {
  fake.values.clear();
  fake.world = { items: structuredClone([...itemFacts]), receipts: {} };
  fake.writes = 0;
  fake.failStorage = false;
  fake.scope = { ...fake.scope, generation: fake.scope.generation + 1 };
  fake.catalogs = [{ id: fake.world.items[0].item.skuId, kind: 'SKU', revision: 12 }];
});
const initial = () => createState(fake.world.items[0], 'default', 'item');

describe('daily isolated adapter recovery', () => {
  it('recovers the frozen opening key/time after remount with no repeated world write', async () => {
    const draft = initial();
    draft.opening = { intent: 'now', localTime: '', timezone: 'Asia/Shanghai' };
    const task = createDailyFixtureTask('opening', target, key, draft, 'unknown');
    await task.submitDraft();
    expect(task.getSnapshot().state).toBe('networkUnknown');
    const attempt = task.getSnapshot().attempt;
    const remounted = createDailyFixtureTask('opening', target, key, initial(), 'unknown');
    expect(remounted.getSnapshot().attempt).toEqual(attempt);
    await remounted.recoverOriginal();
    expect(remounted.getSnapshot().state).toBe('success');
    expect(remounted.getSnapshot().result?.openedAt).toBe('2026-11-11T14:30:00+08:00');
    expect(fake.writes).toBe(1);
  });
  it('does not send on storage failure and preserves malformed legacy input', async () => {
    fake.values.set(key, '{cannot recover');
    const task = createDailyFixtureTask('opening', target, key, initial(), 'default');
    await task.submitDraft();
    expect(fake.writes).toBe(0);
    expect(fake.values.get(key)).toBe('{cannot recover');
    expect(task.getSnapshot().state).toBe('validationError');
    fake.values.clear();
    fake.failStorage = true;
    await createDailyFixtureTask('opening', target, key, initial(), 'default').submitDraft();
    expect(fake.writes).toBe(0);
  });
  it('never overwrites newer item facts when recovering a legacy request without receipt', async () => {
    const draft = initial();
    draft.opening = {
      intent: 'backdate',
      localTime: '2026-11-01T10:00',
      timezone: 'Asia/Shanghai',
    };
    const request = dailyFixtureRequest(
      'opening',
      target,
      draft,
      fixtureDailyRevisions(target),
      'legacy-original',
    );
    draft.mutations.opening = { ...draft.mutations.opening, state: 'networkUnknown', request };
    fake.values.set(key, JSON.stringify(draft));
    fake.world.items[0].item.revision++;
    const task = createDailyFixtureTask('opening', target, key, initial(), 'default');
    await task.recoverOriginal();
    expect(task.getSnapshot().state).toBe('revisionConflict');
    expect(task.getSnapshot().attempt?.request.key).toBe('legacy-original');
    expect(fake.writes).toBe(0);
    expect(fake.values.get(key)).toBe(JSON.stringify(draft));
  });
  it('reads an old note receipt without replacing a later edit to the same note', async () => {
    const draft = initial();
    draft.noteDrafts['item:new-item'] = { title: null, body: 'first body' };
    const old = createDailyFixtureTask('notes', target, key, draft, 'unknown');
    await old.submitDraft();
    expect(old.getSnapshot().state).toBe('networkUnknown');
    const note = getExtraReviewNotes(target)!.find((entry) => entry.body === 'first body')!;
    expect(note).toBeDefined();
    const edited = initial();
    edited.selectedNotes.item = note.id;
    edited.noteDrafts[`item:${note.id}`] = { title: null, body: 'newer body' };
    const next = createDailyFixtureTask('notes', target, `${key}:later`, edited, 'default');
    await next.submitDraft();
    expect(next.getSnapshot().state).toBe('success');
    await old.recoverOriginal();
    expect(old.getSnapshot().state).toBe('success');
    expect(getExtraReviewNotes(target)!.find((entry) => entry.id === note.id)?.body).toBe(
      'newer body',
    );
    expect(fake.writes).toBe(2);
  });
  it('binds product note revision to the frozen SKU and recovers after item reclassification', async () => {
    const skuId = fake.world.items[0].item.skuId;
    const draft = initial();
    draft.scope = 'product';
    draft.noteDrafts['product:new-product'] = { title: null, body: 'shared body' };
    const task = createDailyFixtureTask('notes', target, key, draft, 'unknown');
    await task.submitDraft();
    expect(task.getSnapshot().state).toBe('networkUnknown');
    expect(task.getSnapshot().attempt?.command?.payload.expected_revisions).toEqual({
      [skuId]: 12,
    });
    expect(fake.catalogs[0].revision).toBe(13);
    fake.world.items[0].item.skuId = 'catalog_node_00000000-0000-4000-8000-000000000090';
    const restored = createDailyFixtureTask('notes', target, key, initial(), 'default');
    expect(restored.getSnapshot().state).toBe('networkUnknown');
    await restored.recoverOriginal();
    expect(restored.getSnapshot().state).toBe('success');
    expect(getExtraReviewNotes(skuId)?.some((entry) => entry.body === 'shared body')).toBe(true);
    expect(fake.catalogs[0].revision).toBe(13);
  });
  it('gates existing deadlines without a stable ID and SKU notes without a catalog read', async () => {
    const draft = initial();
    draft.dateDraft = {
      kind: 'SERVICE_DUE',
      source: 'DEADLINE',
      dueOn: '2026-12-01',
      basis: null,
      label: '保养',
      state: 'UPCOMING',
    };
    draft.dateIndex = 0;
    const dates = createDailyFixtureTask('dates', target, key, draft, 'default');
    await dates.submitDraft();
    expect(dates.getSnapshot().error).toContain('稳定条目 ID');
    fake.catalogs = [];
    draft.scope = 'product';
    draft.noteDrafts['product:new-product'] = { title: null, body: 'saved input' };
    const notes = createDailyFixtureTask('notes', target, key, draft, 'default');
    await notes.submitDraft();
    expect(notes.getSnapshot().error).toContain('商品当前版本');
    expect(notes.getSnapshot().draft.noteDrafts['product:new-product'].body).toBe('saved input');
    expect(fake.writes).toBe(0);
  });
});

import {
  dailyJournalProjection,
  validDailyFixtureRecord,
} from '../../apps/web/review/pages/daily-extras-journal.js';
describe('daily legacy journal precedence', () => {
  it('keeps raw legacy data but lets a verified durable successor own its pending state', async () => {
    const draft = initial();
    draft.opening = {
      intent: 'backdate',
      localTime: '2026-11-01T10:00',
      timezone: 'Asia/Shanghai',
    };
    const request = dailyFixtureRequest(
      'opening',
      target,
      draft,
      fixtureDailyRevisions(target),
      'original-legacy',
    );
    draft.mutations.opening = { ...draft.mutations.opening, state: 'networkUnknown', request };
    fake.values.set(key, JSON.stringify(draft));
    const task = createDailyFixtureTask('opening', target, key, initial(), 'default');
    await task.recoverOriginal();
    expect(task.getSnapshot().state).toBe('success');
    const projected = dailyJournalProjection(
      key,
      draft,
      (id) => fake.values.get(id) ?? null,
      fake.scope,
    ) as typeof draft;
    expect(projected.mutations.opening).toBeUndefined();
    expect(fake.values.get(key)).toBe(JSON.stringify(draft));
    expect(task.getSnapshot().original.mutations.opening.state).toBe('draft');
  });
  it('does not hide legacy pending state for schema-valid but mismatched commands or target lists', async () => {
    const task = createDailyFixtureTask('opening', target, key, initial(), 'unknown');
    await task.submitDraft();
    const taskId = `${key}:task:opening`;
    const root = JSON.parse(fake.values.get(taskId)!);
    const legacy = initial();
    legacy.mutations.opening = {
      ...legacy.mutations.opening,
      state: 'networkUnknown',
      request: root.attempt.request,
    };
    root.predecessor = { key, kind: 'opening', request: root.attempt.request };
    fake.values.set(taskId, JSON.stringify(root));
    const project = () =>
      dailyJournalProjection(
        key,
        legacy,
        (id) => fake.values.get(id) ?? null,
        fake.scope,
      ) as typeof legacy;
    expect(project().mutations.opening).toBeUndefined();
    const changed = structuredClone(root);
    changed.attempt.command = {
      operation: 'move_item',
      payload: {
        idempotency_key: root.attempt.request.key,
        expected_revisions: { [target]: root.attempt.request.targetRevision },
        item_id: target,
        parent_id: null,
      },
    };
    fake.values.set(taskId, JSON.stringify(changed));
    expect(validDailyFixtureRecord(changed, taskId, target)).toBe(false);
    expect(project().mutations.opening.state).toBe('networkUnknown');
    root.targetIds.push('item_00000000-0000-4000-8000-000000000099');
    fake.values.set(taskId, JSON.stringify(root));
    expect(project().mutations.opening.state).toBe('networkUnknown');
    fake.values.set(taskId, 'broken');
    expect(project().mutations.opening.state).toBe('networkUnknown');
  });
});
