import { describe, expect, it } from 'vitest';
import {
  DailyTaskController,
  dailyCommand,
  type DailyCommandInput,
} from '../../apps/web/src/app-vnext/daily-tasks.js';
import { OperationSessions } from '../../apps/web/src/app-vnext/operation-context.js';
import type { OperationRecord } from '../../apps/web/src/app-vnext/operation-session.js';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope.js';
import type { CommandAttempt } from '../../apps/web/src/app-vnext/platform.js';

const itemId = 'item_00000000-0000-4000-8000-000000000001';
const skuId = 'catalog_node_00000000-0000-4000-8000-000000000002';
const noteId = 'note_00000000-0000-4000-8000-000000000003';
const deadlineId = 'deadline_00000000-0000-4000-8000-000000000004';
const scope: ApplicationScope = {
  environment: 'test',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web',
  datasetId: 'fixture',
  generation: 1,
};
const date: DailyCommandInput = {
  kind: 'dates',
  itemId,
  templateVersion: 2,
  originalBasis: null,
  creating: false,
  fact: {
    kind: 'EXPIRY',
    source: 'LIFECYCLE',
    dueOn: null,
    dateKind: null,
    basis: null,
    label: '包装日期',
    state: 'UNKNOWN',
  },
};
const opening: DailyCommandInput = {
  kind: 'opening',
  itemId,
  templateVersion: 2,
  correction: false,
  openedAt: '2026-11-11T12:30:00+08:00',
};

describe('daily command contract mapping', () => {
  it('makes unknown opening explicit using correction and never defaults to now', () => {
    const command = dailyCommand(
      { ...opening, openedAt: null, reason: '时间未知' },
      { [itemId]: 5 },
      'original',
    );
    expect(command.operation).toBe('correct_item');
    expect(command.payload.attributes).toEqual([
      {
        template_id: 'lifecycle',
        template_version: 2,
        set: { 'opening.state': 'OPENED' },
        unset: ['opening.opened_at'],
      },
    ]);
    expect(() =>
      dailyCommand(
        { ...opening, correction: true, reason: '纠错', openedAt: 'bad' },
        { [itemId]: 5 },
        'key',
      ),
    ).toThrow('有效时间');
  });
  it('preserves null expiry facts using explicit unset and rejects unsupported basis writes', () => {
    const command = dailyCommand(date, { [itemId]: 5 }, 'key');
    expect(command.payload.unset).toEqual(['expiry.date', 'expiry.date_kind']);
    expect(() =>
      dailyCommand({ ...date, fact: { ...date.fact, basis: '推测' } }, { [itemId]: 5 }, 'key'),
    ).toThrow('不支持修改日期依据');
    expect(() =>
      dailyCommand(
        { ...date, fact: { ...date.fact, dueOn: '2026-02-30' } },
        { [itemId]: 5 },
        'key',
      ),
    ).toThrow('有效日期');
  });
  it('requires stable deadline IDs and never uses index identity or infers recurrence from prose', () => {
    const input = {
      ...date,
      fact: {
        ...date.fact,
        kind: 'SERVICE_DUE' as const,
        source: 'DEADLINE' as const,
        dueOn: '2026-12-10',
        basis: '每30天',
      },
    };
    expect(() => dailyCommand(input, { [itemId]: 5 }, 'key')).toThrow('稳定条目 ID');
    const added = dailyCommand({ ...input, creating: true }, { [itemId]: 5 }, 'key');
    expect(added.operation).toBe('add_deadline');
    expect(added.payload.entry).not.toHaveProperty('recurrence_days');
    const completed = dailyCommand(
      { ...input, entryId: deadlineId, completedOn: '2026-11-10' },
      { [itemId]: 5 },
      'key',
    );
    expect(completed.payload).toMatchObject({ entry_id: deadlineId, completed_on: '2026-11-10' });
  });
  it('uses the note target revision, preserves whitespace, and rejects hidden content', () => {
    const note: DailyCommandInput = {
      kind: 'notes',
      target: { kind: 'CATALOG_NODE', id: skuId },
      noteId,
      body: '  原文\n',
      title: null,
    };
    const command = dailyCommand(note, { [itemId]: 100, [skuId]: 7 }, 'key');
    expect(command).toMatchObject({
      operation: 'update_note',
      payload: { body: '  原文\n', expected_revisions: { [skuId]: 7 }, target: note.target },
    });
    expect(() => dailyCommand(note, { [itemId]: 100 }, 'key')).toThrow('当前版本');
    expect(() => dailyCommand({ ...note, redacted: true }, { [skuId]: 7 }, 'key')).toThrow('隐藏');
  });
});

type Record = OperationRecord<DailyCommandInput, CommandAttempt, string>;
const initial = (): Record => ({
  version: 1,
  scope,
  taskId: 'opening',
  targetIds: [itemId],
  original: opening,
  draft: opening,
  revisions: { [itemId]: 5 },
  attempt: null,
  result: null,
  state: 'draft',
  reviewing: false,
  approval: null,
  error: '',
});
function setup(options: { failStorage?: boolean; lost?: boolean } = {}) {
  let current = scope;
  const events: string[] = [];
  let saved: unknown;
  const task = new DailyTaskController(initial(), {
    currentScope: () => current,
    storage: {
      load: () => null,
      save: (_scope, _key, record) => {
        if (options.failStorage) throw Error('disk full');
        saved = structuredClone(record);
        events.push((record as Record).state);
      },
    },
    validateSaved: (value): value is Record => !!value,
    freeze: (record) => dailyCommand(record.draft, record.revisions, 'original'),
    execute: async () => {
      events.push('send');
      if (options.lost) throw Object.assign(Error('lost'), { code: 'NETWORK' });
      return 'receipt';
    },
    recover: async (seenScope, attempt) => {
      expect(seenScope).toEqual(scope);
      expect(attempt.payload.idempotency_key).toBe('original');
      events.push('recover');
      return 'receipt';
    },
  });
  return {
    task,
    events,
    saved: () => saved,
    changeScope: () => {
      current = { ...scope, generation: 2 };
    },
  };
}
describe('root daily task lifetime and durability', () => {
  it('persists before sending, persists receipt before success, and survives registry reopen', async () => {
    const { task, events } = setup();
    const registry = new OperationSessions();
    expect(registry.get(scope, 'opening', () => task)).toBe(task);
    await task.submitDraft();
    expect(events).toEqual(['submitting', 'send', 'success']);
    expect(
      registry.get(scope, 'opening', () => {
        throw Error('route remount');
      }),
    ).toBe(task);
  });
  it('does not send when durable storage fails', async () => {
    const { task, events } = setup({ failStorage: true });
    await task.submitDraft();
    expect(events).not.toContain('send');
    expect(task.getSnapshot().attemptStatus).toBe('unsent');
  });
  it('keeps the unknown original through editing and repeated submit and recovers only that request', async () => {
    const { task, events } = setup({ lost: true });
    await task.submitDraft();
    const original = task.getSnapshot().attempt;
    expect(await task.update({ draft: { ...opening, openedAt: null } })).toBe(false);
    await task.submitDraft();
    expect(task.getSnapshot().attempt).toEqual(original);
    expect(events.filter((event) => event === 'send')).toHaveLength(1);
    await task.recoverOriginal();
    expect(task.getSnapshot().state).toBe('success');
  });
  it('rejects dispatch after session generation changes', async () => {
    const { task, changeScope, events } = setup();
    changeScope();
    await task.submitDraft();
    expect(events).not.toContain('send');
    expect(task.getSnapshot().state).toBe('sessionChanged');
  });
});
