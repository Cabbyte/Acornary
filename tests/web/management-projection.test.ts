import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagementDraft } from '../../apps/web/src/app-vnext/management-task';
const scope = vi.hoisted(() => ({
  environment: 'isolated-review',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web-review',
  datasetId: 'd',
  generation: 1,
}));
vi.mock('../../apps/web/review/trial/application', () => ({ getFixtureScope: () => scope }));
vi.mock('../../apps/web/review/trial/session', () => ({
  isTrial: () => false,
  getTrialScope: () => ({ ...scope, role: 'member' }),
}));
vi.mock('../../apps/web/review/pages/daily-extras-fixture', () => ({
  getExtraReviewNotes: () => [],
  getExtraReviewAttachments: () => [],
}));
beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal('window', {});
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  });
});
async function setup() {
  const inventory = await import('../../apps/web/review/pages/inventory-session');
  const fixtures = await import('../../apps/web/review/pages/management-fixtures');
  const storage = await import('../../apps/web/review/pages/management-storage');
  const controller = await import('../../apps/web/src/app-vnext/management-task');
  const adapter = await import('../../apps/web/review/pages/management-task-adapter');
  inventory.updateReviewItems(fixtures.containerFactsFor(inventory.getReviewWorld().items));
  const world = inventory.getReviewWorld();
  const catalogs = fixtures.catalogFixtures(world.items.map((row) => row.item));
  const locations = fixtures.locationFixtures(world.items.map((row) => row.item));
  const state = {
    catalogs,
    locations,
    receipts: {},
    explicitNames: {},
    bindings: {},
    itemDrafts: {},
    nameDraft: { mode: 'unchanged', value: '' },
    attributeDraft: null,
    changedAttributes: [],
    editId: null,
    task: null,
    retainedTask: null,
    extraHistory: [],
  };
  storage.writeManagementState(state, 'review');
  return { inventory, storage, controller, adapter, state, world };
}
function task(
  kind: string,
  id: string,
  revision: number,
  fields: Record<string, string>,
): ManagementDraft['task'] {
  return {
    kind,
    taskId: `${kind}-original-key`,
    targetIds: [id],
    title: kind,
    description: '',
    fields: Object.entries(fields).map(([key, value]) => ({ key, value, label: key })),
    phase: 'review',
    impact: [],
    snapshot: [{ id, revision, name: '', path: '' }],
    confirmLabel: '',
  };
}
describe('management projections through actual isolated inventory journal', () => {
  it('uses container UUID ancestry for identical names and slash-containing path labels when renaming and moving', async () => {
    const { inventory, storage, controller, adapter, state, world } = await setup();
    const a = 'item_00000000-0000-4000-8000-000000009901',
      b = 'item_00000000-0000-4000-8000-000000009902';
    const childA = 'item_00000000-0000-4000-8000-000000009903',
      childB = 'item_00000000-0000-4000-8000-000000009904';
    const label = '同名/容器';
    const prototype = world.items.find((row) => row.item.id === state.locations[0].id)!;
    const roots = [a, b].map((id) => ({
      ...structuredClone(prototype),
      item: {
        ...structuredClone(prototype.item),
        id,
        name: label,
        revision: 1,
        location: { id: null, path: [], label: '根级' },
      },
    }));
    const children = [
      [childA, a],
      [childB, b],
    ].map(([id, parent]) => ({
      ...structuredClone(world.items[0]),
      item: {
        ...structuredClone(world.items[0].item),
        id,
        revision: 1,
        location: { id: parent, path: [label], label },
      },
    }));
    inventory.updateReviewItems([...roots, ...children]);
    state.locations.push(
      ...[a, b].map((id) => ({
        ...state.locations[0],
        id,
        name: label,
        path: [label],
        parentId: null,
        revision: 1,
      })),
    );
    storage.writeManagementState(state, 'review');
    const untouched = structuredClone(
      inventory.getReviewWorld().items.find((row) => row.item.id === childB)!,
    );
    const historyLength = inventory.getReviewWorld().history.length;
    const rename = { task: task('location-edit', a, 1, { name: 'changed' }), bindings: {} };
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(rename, { [a]: 1 }),
      'review',
      'default',
    );
    expect(inventory.getReviewWorld().items.find((row) => row.item.id === childB)).toEqual(
      untouched,
    );
    expect(
      inventory.getReviewWorld().items.find((row) => row.item.id === childA)?.item.location.path,
    ).toEqual(['changed']);
    const move = { task: task('location-move', a, 2, { destination: b }), bindings: {} };
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(move, { [a]: 2 }),
      'review',
      'default',
    );
    expect(inventory.getReviewWorld().items.find((row) => row.item.id === childB)).toEqual(
      untouched,
    );
    expect(
      inventory.getReviewWorld().items.find((row) => row.item.id === childA)?.item.location.path,
    ).toEqual([label, 'changed']);
    expect(
      inventory.getReviewWorld().items.find((row) => row.item.id === childA)?.item.revision,
    ).toBe(1);
    expect(inventory.getReviewWorld().history).toHaveLength(historyLength + 2);
  });
  it('changes GROUP descendant paths by stable parent IDs without touching same-name sibling branches', async () => {
    const { storage, controller, adapter, state } = await setup();
    const group = state.catalogs.find((row) => row.kind === 'GROUP')!;
    const sku = state.catalogs.find((row) => row.kind === 'SKU')!;
    const a = 'catalog_node_00000000-0000-4000-8000-000000009901',
      b = 'catalog_node_00000000-0000-4000-8000-000000009902';
    const childA = 'catalog_node_00000000-0000-4000-8000-000000009903',
      childB = 'catalog_node_00000000-0000-4000-8000-000000009904';
    const roots = [a, b].map((id) => ({
      ...structuredClone(group),
      id,
      name: '同名/分类',
      path: ['同名/分类'],
      parentId: null,
    }));
    const children = [
      [childA, a],
      [childB, b],
    ].map(([id, parentId]) => ({
      ...structuredClone(sku),
      id,
      parentId,
      name: 'same product',
      path: ['同名/分类', 'same product'],
    }));
    state.catalogs.push(...roots, ...children);
    storage.writeManagementState(state, 'review');
    const draft = controller.bindManagementApproval(
      {
        task: task('catalog-edit', a, group.revision, { name: 'changed group' }),
        catalog: roots[0],
        bindings: {},
      },
      { [a]: group.revision },
      '00000000-0000-4000-8000-000000000099',
    );
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(draft, { [a]: group.revision }),
      'review',
      'default',
    );
    expect(storage.getManagementCatalogs().find((row) => row.id === childA)?.path).toEqual([
      'changed group',
      'same product',
    ]);
    expect(storage.getManagementCatalogs().find((row) => row.id === childB)).toEqual(children[1]);
  });
  it('renames a SKU without incrementing related Item revisions or creating Item write events', async () => {
    const { inventory, storage, controller, adapter, state, world } = await setup();
    const catalog = state.catalogs.find((row) => row.kind === 'SKU' && row.itemCount)!;
    const members = world.items.filter((row) => row.item.skuId === catalog.id);
    const beforeHistory = world.history.length;
    const draft = controller.bindManagementApproval(
      {
        task: task('catalog-edit', catalog.id, catalog.revision, {
          name: 'renamed SKU',
          profile: catalog.profile || 'unknown',
        }),
        catalog,
        bindings: {},
      },
      { [catalog.id]: catalog.revision },
      '00000000-0000-4000-8000-000000000099',
    );
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(draft, { [catalog.id]: catalog.revision }),
      'review',
      'default',
    );
    const after = inventory.getReviewWorld();
    for (const before of members) {
      const current = after.items.find((row) => row.item.id === before.item.id)!;
      expect(current.item.revision).toBe(before.item.revision);
      if (before.item.name === catalog.name) expect(current.item.name).toBe('renamed SKU');
    }
    expect(after.history).toHaveLength(beforeHistory);
    expect(storage.getManagementCatalogs().find((row) => row.id === catalog.id)?.revision).toBe(
      catalog.revision + 1,
    );
    const stored = storage.readManagementState<{ extraHistory: unknown[] }>('review');
    expect(stored?.extraHistory).toHaveLength(1);
  });
  it('renames a container and changes descendant path projections without editing descendant identity/revision/history', async () => {
    const { inventory, controller, adapter, state, world } = await setup();
    const container = state.locations.find((row) =>
      world.items.some((item) => item.item.location.id === row.id),
    )!;
    const original = world.items.find((row) => row.item.id === container.id)!;
    const descendants = world.items.filter(
      (row) =>
        row.item.location.path.join('/').startsWith(container.path.join('/')) &&
        row.item.id !== container.id,
    );
    expect(descendants.length).toBeGreaterThan(0);
    const historyLength = world.history.length;
    const draft = {
      task: task('location-edit', container.id, original.item.revision, {
        name: 'renamed container',
      }),
      bindings: {},
    };
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(draft, { [container.id]: original.item.revision }),
      'review',
      'default',
    );
    const after = inventory.getReviewWorld();
    for (const before of descendants) {
      const current = after.items.find((row) => row.item.id === before.item.id)!;
      expect(current.item.revision).toBe(before.item.revision);
      expect(current.item.location.id).toBe(before.item.location.id);
      expect(current.item.location.path).toContain('renamed container');
    }
    expect(after.items.find((row) => row.item.id === container.id)?.item.revision).toBe(
      original.item.revision + 1,
    );
    expect(after.history).toHaveLength(historyLength + 1);
    expect(after.history[0].event?.target_id).toBe(container.id);
  });
  it('splits once, preserves source terminal state on record restore, and does not copy private/date/opening facts to children', async () => {
    const { inventory, storage, controller, adapter, state, world } = await setup();
    const source = world.items.find(
      (row) =>
        row.quantity.value &&
        Number(row.quantity.value) > 0 &&
        row.quantity.unit !== 'percent' &&
        !state.locations.some((location) => location.id === row.item.id),
    )!;
    const catalog = state.catalogs.find((row) => row.id === source.item.skuId)!;
    const draft: ManagementDraft = {
      task: task('split', source.item.id, source.item.revision, {
        sku: catalog.id,
        count: '1',
        quantity: source.quantity.value!,
        unit: source.quantity.unit,
      }),
      bindings: {},
      sourceQuantity: source.quantity,
      splitContentsVersion: 2,
    };
    const attempt = controller.freezeManagementAttempt(draft, {
      [source.item.id]: source.item.revision,
    });
    await adapter.executeManagementFixtureAttempt(scope, attempt, 'review', 'default');
    const first = inventory.getReviewWorld();
    await adapter.executeManagementFixtureAttempt(scope, attempt, 'review', 'default', true);
    expect(inventory.getReviewWorld().items).toHaveLength(first.items.length);
    const stored = storage.readManagementState<{
      splits: Record<string, { childItemIds: string[] }>;
    }>('review')!;
    const child = first.items.find(
      (row) => row.item.id === stored.splits[source.item.id].childItemIds[0],
    )!;
    expect(child.item.id).not.toBe(source.item.id);
    expect(child.item.noteCount).toBe(0);
    expect(child.item.attachmentCount).toBe(0);
    expect(child.date).toBeUndefined();
    expect(child.dates).toBeUndefined();
    expect(child.item.status.label).toBe('开封状态未记录');
    const current = first.items.find((row) => row.item.id === source.item.id)!;
    const restore: ManagementDraft = {
      task: task('restore', source.item.id, current.item.revision, {
        reason: 'restore visibility',
      }),
      bindings: {},
    };
    await adapter.executeManagementFixtureAttempt(
      scope,
      controller.freezeManagementAttempt(restore, { [source.item.id]: current.item.revision }),
      'review',
      'default',
    );
    expect(
      inventory.getReviewWorld().items.find((row) => row.item.id === source.item.id)?.item.status
        .label,
    ).toBe('已拆包');
  });
});
