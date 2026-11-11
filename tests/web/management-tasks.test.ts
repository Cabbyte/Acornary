import { describe, expect, it, vi } from 'vitest';
import {
  createManagementSession,
  bindManagementApproval,
  prepareManagementCommand,
  freezeManagementAttempt,
  managementTaskView,
  validManagementRecord,
  type ManagementDraft,
  type ManagementRecord,
} from '../../apps/web/src/app-vnext/management-task';
import { catalogFixtures } from '../../apps/web/review/pages/management-fixtures';
import { itemFacts } from '../../apps/web/review/pages/fixtures';
import { OperationSessions } from '../../apps/web/src/app-vnext/operation-context';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope';
import type { OperationStorage } from '../../apps/web/src/app-vnext/platform';

const id = (n: number) => `item_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope: ApplicationScope = {
  environment: 'test',
  accountId: 'a',
  householdId: 'h',
  datasetId: 'd',
  clientId: 'web',
  generation: 1,
};
function draft(kind = 'item-save', count = 1): ManagementDraft {
  const ids = Array.from({ length: count }, (_, index) => id(index + 1));
  return {
    task: {
      kind,
      taskId: 'original-management-key',
      title: '管理任务',
      description: '',
      phase: 'draft',
      confirmLabel: '提交',
      targetIds: ids,
      fields: [{ key: 'destination', label: '位置', value: id(999) }],
      impact: [],
      snapshot: ids.map((id) => ({ id, name: '原名', path: '', revision: 3 })),
      draft: {
        name: { mode: 'set', value: '新名' },
        binding: {
          template_id: 'lifecycle',
          template_version: 2,
          status: 'KNOWN',
          values: {
            expiry: { date: '2026-12-01', date_kind: 'BEST_BEFORE' },
            legacy: { untouched: true },
          },
        },
        changedAttributes: ['expiry.date'],
      },
    },
    bindings: Object.fromEntries(
      ids.map((id, index) => [
        id,
        {
          template_id: 'lifecycle',
          template_version: (index % 2) + 1,
          status: 'KNOWN',
          values: { legacy: { untouched: true } },
        },
      ]),
    ),
  };
}
const revisions = (d: ManagementDraft) =>
  Object.fromEntries(d.task.snapshot.map((row) => [row.id, row.revision]));
function memoryStorage() {
  let value: unknown = null;
  const saves: ManagementRecord[] = [];
  const storage: OperationStorage = {
    load: () => value,
    save: (_scope, _key, next) => {
      value = structuredClone(next);
      saves.push(value as ManagementRecord);
    },
  };
  return { storage, saves, read: () => value as ManagementRecord };
}

describe('management root tasks', () => {
  it('binds catalog approval to the exact payload, identity, revision and request key', () => {
    const d = draft('catalog-edit');
    const catalog = catalogFixtures(itemFacts.map((row) => row.item)).find(
      (row) => row.kind === 'SKU',
    )!;
    d.catalog = catalog;
    d.task.targetIds = [catalog.id];
    d.task.snapshot = [
      { id: catalog.id, revision: catalog.revision, name: catalog.name, path: '' },
    ];
    d.task.fields = [
      { key: 'name', label: '', value: 'reviewed name' },
      { key: 'profile', label: '', value: 'unknown' },
    ];
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow('审批');
    const approved = bindManagementApproval(
      d,
      revisions(d),
      '00000000-0000-4000-8000-000000000007',
    );
    expect(freezeManagementAttempt(approved, revisions(d)).command).toMatchObject({
      operation: 'update_catalog_node',
      payload: {
        profile: null,
        name: 'reviewed name',
        catalog_node_id: catalog.id,
        approval_id: '00000000-0000-4000-8000-000000000007',
      },
    });
    approved.task.fields = [{ key: 'name', label: '', value: 'changed after approval' }];
    expect(() => freezeManagementAttempt(approved, revisions(approved))).toThrow('审批');
  });

  it('creates directory objects with no invented target revision and refuses combined edit/move', () => {
    const create = draft('catalog-create-group', 0);
    create.task.fields = [
      { key: 'name', label: '', value: 'new group' },
      { key: 'parent', label: '', value: 'root' },
    ];
    expect(prepareManagementCommand(create, {})).toMatchObject({
      operation: 'create_catalog_node',
      payload: { kind: 'GROUP', parent_id: null, expected_revisions: {} },
    });
    const catalog = catalogFixtures(itemFacts.map((row) => row.item))[0];
    const edit = draft('catalog-edit');
    edit.catalog = catalog;
    edit.task.targetIds = [catalog.id];
    edit.task.snapshot = [
      { id: catalog.id, revision: catalog.revision, name: catalog.name, path: '' },
    ];
    edit.task.fields = [
      { key: 'parent', label: '', value: 'catalog_node_00000000-0000-4000-8000-000000000099' },
    ];
    expect(() => prepareManagementCommand(edit, revisions(edit))).toThrow('不能同时移动');
  });

  it.each([
    ['location-create', 'create_items'],
    ['location-edit', 'update_item'],
    ['void', 'void_item'],
    ['location-void', 'void_item'],
    ['restore', 'correct_item'],
    ['location-restore', 'correct_item'],
    ['dispose', 'dispose_item'],
  ])('maps %s to one supported %s command', (kind, operation) => {
    const d = draft(kind, kind === 'location-create' ? 0 : 1);
    d.creationCatalogId = 'catalog_node_00000000-0000-4000-8000-000000000800';
    d.task.fields = [
      { key: 'name', label: '', value: 'room' },
      { key: 'destination', label: '', value: 'root' },
      { key: 'reason', label: '', value: 'correct mistaken record' },
      { key: 'disposition', label: '', value: 'GIFT' },
      { key: 'date', label: '', value: '2026-11-11' },
      { key: 'recipient', label: '', value: '' },
    ];
    const command = freezeManagementAttempt(d, revisions(d)).command;
    expect(command.operation).toBe(operation);
    if (kind === 'dispose')
      expect(command.payload.disposition).not.toHaveProperty('recipient_name');
    if (kind === 'location-create')
      expect(command.payload).toMatchObject({
        count: 1,
        initial_attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
      });
  });

  it('requires exact decimal conservation and only explicit content facts for split children', () => {
    const d = draft('split');
    d.splitContentsVersion = 2;
    d.sourceQuantity = { value: '0.3', unit: 'g', accuracy: 'unknown' };
    d.task.fields = [
      { key: 'sku', label: '', value: 'catalog_node_00000000-0000-4000-8000-000000000100' },
      { key: 'count', label: '', value: '3' },
      { key: 'quantity', label: '', value: '0.1' },
      { key: 'unit', label: '', value: 'g' },
    ];
    const command = freezeManagementAttempt(d, revisions(d)).command;
    expect(command.operation).toBe('split_item');
    expect(command.payload.child_attributes).toEqual([
      {
        template_id: 'contents',
        template_version: 2,
        values: { remaining: { value: '0.1', unit: 'g' } },
      },
    ]);
    d.sourceQuantity.value = '0.31';
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow('守恒');
  });

  it('rejects unsupported correction and preserves unknown fields by refusing a lossy template upgrade', () => {
    expect(() => freezeManagementAttempt(draft('history-correct'), revisions(draft()))).toThrow(
      'correct_item',
    );
    const d = draft('template-upgrade');
    d.templateTargetVersion = 2;
    d.task.draft!.binding!.template_version = 1;
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow();
    expect(d.task.draft!.binding!.values.legacy).toEqual({ untouched: true });
    delete d.task.draft!.binding!.values.legacy;
    expect(freezeManagementAttempt(d, revisions(d)).command).toMatchObject({
      operation: 'upgrade_attributes',
      payload: { from_version: 1, to_version: 2 },
    });
  });

  it('uses one schema-valid command for all 100 explicit UUIDs, with no hidden selection loss', () => {
    const d = draft('bulk-move', 100);
    const attempt = freezeManagementAttempt(d, revisions(d));
    expect(attempt.command.operation).toBe('move_items');
    expect(attempt.command.payload.item_ids).toEqual(d.task.targetIds);
    expect(Object.keys(attempt.command.payload.expected_revisions as object)).toHaveLength(100);
    expect(() =>
      freezeManagementAttempt(draft('bulk-move', 101), revisions(draft('bulk-move', 101))),
    ).toThrow('1–100');
  });

  it('rejects duplicate identities, incomplete versions, malformed UUIDs, and unknown destinations', () => {
    const d = draft('bulk-move', 2);
    expect(() => freezeManagementAttempt(d, { [id(1)]: 3 })).toThrow('真实版本');
    d.task.targetIds = [id(1), id(1)];
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow('不同');
    const malformed = draft('item-move');
    malformed.task.targetIds = ['same-name'];
    malformed.task.snapshot = [{ id: 'same-name', revision: 3, name: '', path: '' }];
    expect(() => freezeManagementAttempt(malformed, { 'same-name': 3 })).toThrow();
    const unknown = draft('item-move');
    unknown.task.fields = [{ key: 'destination', label: '位置', value: '' }];
    expect(() => freezeManagementAttempt(unknown, revisions(unknown))).toThrow('未知位置');
    unknown.task.fields = [{ key: 'destination', label: '位置', value: 'root' }];
    expect(
      freezeManagementAttempt(unknown, revisions(unknown)).command.payload.parent_id,
    ).toBeNull();
  });

  it('distinguishes clearing an override from empty/unchanged input and captures exact attributes', () => {
    const d = draft();
    d.task.draft!.name = { mode: 'clear', value: 'irrelevant' };
    expect(freezeManagementAttempt(d, revisions(d)).command.payload.display_name).toBeNull();
    d.task.draft!.name = { mode: 'unchanged', value: 'original' };
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow('明确');
    const attrs = draft('attribute-save');
    attrs.task.draft!.changedAttributes = ['expiry.date', 'acquisition.acquired_on'];
    const attempt = freezeManagementAttempt(attrs, revisions(attrs));
    expect(attempt.command.payload).toMatchObject({
      target: { kind: 'ITEM', id: id(1) },
      template_version: 2,
      set: { 'expiry.date': '2026-12-01' },
      unset: ['acquisition.acquired_on'],
    });
    expect(attempt.draft.task.draft!.binding!.values.legacy).toEqual({ untouched: true });
    expect(attempt.command.payload.set).not.toHaveProperty('legacy');
  });

  it('retains per-object binding versions for bulk changes and never invents a missing binding', () => {
    const d = draft('bulk-lifecycle', 2);
    d.task.fields = [{ key: 'mode', label: '', value: 'clear' }];
    const items = freezeManagementAttempt(d, revisions(d)).command.payload.items;
    expect(items).toEqual(
      [1, 2].map((version, i) => ({
        item_id: id(i + 1),
        template_version: version,
        set: {},
        unset: ['acquisition.acquired_on'],
      })),
    );
    d.bindings[id(2)] = null;
    expect(() => freezeManagementAttempt(d, revisions(d))).toThrow('绑定版本');
  });

  it('sends zero requests when storage fails and keeps the original frozen request for recovery', async () => {
    const d = draft();
    const execute = vi.fn(async (_attempt: ReturnType<typeof freezeManagementAttempt>) => ({
      receipt: 'done',
    }));
    const session = createManagementSession(
      scope,
      d,
      {
        load: () => null,
        save: () => {
          throw Error('storage denied');
        },
      },
      () => scope,
    );
    await session.submit(freezeManagementAttempt(d, revisions(d)), execute);
    expect(execute).not.toHaveBeenCalled();
    expect(session.getSnapshot().attemptStatus).toBe('unsent');
    expect(session.getSnapshot().attempt!.key).toBe(d.task.taskId);
  });

  it('survives route remount and reload, recovering only the immutable original key/parameters', async () => {
    const memory = memoryStorage();
    const d = draft('bulk-move', 2);
    const roots = new OperationSessions();
    const session = roots.get(scope, d.task.taskId!, () =>
      createManagementSession(scope, d, memory.storage, () => scope),
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submitted = session.submit(freezeManagementAttempt(d, revisions(d)), async () => {
      await gate;
      throw Object.assign(Error('lost receipt'), { code: 'NETWORK' });
    });
    expect(roots.isSubmitting()).toBe(true);
    expect(
      roots.get(scope, d.task.taskId!, () => {
        throw Error('must reuse root task');
      }),
    ).toBe(session);
    finish();
    await submitted;
    const original = structuredClone(session.getSnapshot().attempt!);
    expect(await session.update({ draft: draft('bulk-consume', 2) })).toBe(false);
    const restored = createManagementSession(scope, d, memory.storage, () => scope);
    expect(managementTaskView(restored.getSnapshot()).phase).toBe('unknown');
    const execute = vi.fn(async (attempt) => {
      expect(attempt).toEqual(original);
      expect(Object.isFrozen(attempt.command.payload)).toBe(true);
      return { receipt: 'original receipt' };
    });
    await restored.submit(freezeManagementAttempt(draft('bulk-consume', 2), revisions(d)), execute);
    expect(execute).not.toHaveBeenCalled();
    await restored.recover(execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(memory.read().state).toBe('success');
  });

  it('keeps stale responses out of a new generation and recovers after returning to the original scope', async () => {
    const memory = memoryStorage();
    const d = draft();
    let active = scope;
    const session = createManagementSession(scope, d, memory.storage, () => active);
    await session.submit(freezeManagementAttempt(d, revisions(d)), async () => {
      active = { ...scope, householdId: 'other', generation: 2 };
      return { receipt: 'old household receipt' };
    });
    expect(session.getSnapshot().state).toBe('sessionChanged');
    expect(memory.saves.map((row) => row.state)).toEqual(['submitting']);
    active = { ...scope, generation: 3 };
    const restored = createManagementSession(active, d, memory.storage, () => active);
    await restored.recover(async (attempt) => {
      expect(attempt.key).toBe(d.task.taskId);
      return { receipt: 'found original' };
    });
    expect(restored.getSnapshot().state).toBe('success');
  });

  it('requires explicit conflict reconciliation and creates a new key only for the newly reviewed intent', async () => {
    const memory = memoryStorage();
    const d = draft();
    const session = createManagementSession(scope, d, memory.storage, () => scope);
    await session.submit(freezeManagementAttempt(d, revisions(d)), async () => {
      throw Object.assign(Error('changed'), { code: 'REVISION_CONFLICT' });
    });
    expect(session.getSnapshot().draft).toEqual(d);
    const execute = vi.fn(async (_attempt: ReturnType<typeof freezeManagementAttempt>) => ({
      receipt: 'done',
    }));
    await session.submit(freezeManagementAttempt(d, revisions(d)), execute);
    expect(execute).not.toHaveBeenCalled();
    const reconciled = structuredClone(d);
    reconciled.requestKey = 'explicitly-reconciled-key';
    reconciled.task.snapshot = [{ ...d.task.snapshot[0], revision: 4 }];
    await session.reconcile(reconciled, revisions(reconciled), reconciled);
    await session.submit(freezeManagementAttempt(reconciled, revisions(reconciled)), execute);
    expect(execute.mock.calls[0][0]).toMatchObject({
      key: 'explicitly-reconciled-key',
      command: { payload: { expected_revisions: { [id(1)]: 4 } } },
    });
  });

  it('preserves an unreadable original instead of overwriting it or replaying modified parameters', async () => {
    const memory = memoryStorage();
    const d = draft();
    const session = createManagementSession(scope, d, memory.storage, () => scope);
    await session.submit(freezeManagementAttempt(d, revisions(d)), async () => {
      throw Error('unknown');
    });
    const corrupt = structuredClone(memory.read());
    corrupt.attempt!.command.payload.display_name = 'tampered';
    expect(validManagementRecord(corrupt)).toBe(false);
    const save = vi.fn();
    const execute = vi.fn(async () => ({ receipt: '' }));
    const restored = createManagementSession(scope, d, { load: () => corrupt, save }, () => scope);
    await restored.submit(freezeManagementAttempt(d, revisions(d)), execute);
    expect(execute).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['task', 'target'])(
    'rejects a different saved %s even when the record is internally valid',
    async (mismatch) => {
      const memory = memoryStorage();
      const original = draft();
      const session = createManagementSession(scope, original, memory.storage, () => scope);
      await session.submit(freezeManagementAttempt(original, revisions(original)), async () => {
        throw Error('unknown');
      });
      const requested = draft();
      if (mismatch === 'task') requested.task.taskId = 'different-task';
      else {
        requested.task.targetIds = [id(99)];
        requested.task.snapshot = [{ ...requested.task.snapshot[0], id: id(99) }];
      }
      const saved = memory.read();
      const save = vi.fn();
      const execute = vi.fn(async () => ({ receipt: '' }));
      expect(validManagementRecord(saved)).toBe(true);
      const restored = createManagementSession(
        scope,
        requested,
        { load: () => saved, save },
        () => scope,
      );
      await restored.submit(freezeManagementAttempt(requested, revisions(requested)), execute);
      expect(restored.getSnapshot().state).toBe('validationError');
      expect(execute).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );
});
