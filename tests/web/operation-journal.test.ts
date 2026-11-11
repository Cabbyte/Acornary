import { describe, expect, it } from 'vitest';
import {
  openOperationJournal,
  type DurableOperationRecords,
  type JournalEntry,
} from '../../apps/web/src/app-vnext/operation-journal';
import { scopeKey, type ApplicationScope } from '../../apps/web/src/app-vnext/scope';

const scope: ApplicationScope = {
  environment: 'https://cf.example.test',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web',
  datasetId: 'stable-dataset',
  generation: 1,
};
function records() {
  const rows = new Map<string, JournalEntry>();
  const key = (s: string, id: string) => JSON.stringify([s, id]);
  const port: DurableOperationRecords = {
    async readAll(s) {
      return [...rows.values()].filter((row) => row.scope === s);
    },
    async read(s, id) {
      return structuredClone(rows.get(key(s, id)));
    },
    async compareAndSet(entry, expected) {
      if ((rows.get(key(entry.scope, entry.taskId))?.stamp ?? null) !== expected)
        throw Error('concurrent task');
      rows.set(key(entry.scope, entry.taskId), structuredClone(entry));
    },
  };
  return { port, rows };
}
describe('scope-bound durable task journal', () => {
  it('never interprets an existing null payload as a missing task', async () => {
    const { port } = records();
    await port.compareAndSet(
      { format: 1, scope: scopeKey(scope), taskId: 't', stamp: 'existing', value: null },
      null,
    );
    await expect(openOperationJournal(scope, () => scope, port)).rejects.toThrow('原记录已保留');
    expect((await port.read(scopeKey(scope), 't'))?.stamp).toBe('existing');
    const fresh = records();
    const journal = await openOperationJournal(scope, () => scope, fresh.port);
    await expect(journal.save(scope, 't', null)).rejects.toThrow('原记录已保留');
    expect(await fresh.port.read(scopeKey(scope), 't')).toBeUndefined();
  });
  it('captures ownership before hydration even if the caller mutates the same scope object', async () => {
    const mutable = structuredClone(scope);
    const { port } = records();
    await expect(
      openOperationJournal(mutable, () => mutable, {
        ...port,
        readAll: async () => {
          mutable.householdId = 'different';
          return [];
        },
      }),
    ).rejects.toThrow('SESSION_CHANGED');
    const current = structuredClone(scope);
    const journal = await openOperationJournal(current, () => current, port);
    current.generation++;
    await expect(journal.save(current, 't', {})).rejects.toThrow('SESSION_CHANGED');
    expect(() => journal.entries()).toThrow('SESSION_CHANGED');
  });
  it('hydrates the original request after a new login generation without using a deployment SHA', async () => {
    const { port } = records();
    const journal = await openOperationJournal(scope, () => scope, port);
    const value = { state: 'networkUnknown', key: 'original', amount: '1.00' };
    await journal.save(scope, 'consume:1', value);
    const later = { ...scope, generation: 3 };
    const restored = await openOperationJournal(later, () => later, port);
    expect(restored.load(later, 'consume:1')).toEqual(value);
    const leaked = restored.load(later, 'consume:1') as typeof value;
    leaked.key = 'mutated';
    expect(restored.load(later, 'consume:1')).toEqual(value);
  });
  it.each(['environment', 'accountId', 'householdId', 'clientId', 'datasetId'] as const)(
    'isolates %s in both storage and the memory view',
    async (dimension) => {
      const { port } = records();
      const journal = await openOperationJournal(scope, () => scope, port);
      await journal.save(scope, 'same-task', { private: true });
      const other = { ...scope, [dimension]: 'other' };
      const isolated = await openOperationJournal(other, () => other, port);
      expect(isolated.load(other, 'same-task')).toBeNull();
      expect(() => journal.load(other, 'same-task')).toThrow('SESSION_CHANGED');
      expect(isolated.entries()).toEqual([]);
    },
  );
  it('rejects a stale tab rather than overwriting a newer frozen attempt', async () => {
    const { port } = records();
    const first = await openOperationJournal(scope, () => scope, port);
    const stale = await openOperationJournal(scope, () => scope, port);
    await first.save(scope, 't', { key: 'first' });
    await expect(stale.save(scope, 't', { key: 'second' })).rejects.toThrow('concurrent task');
    expect(first.load(scope, 't')).toEqual({ key: 'first' });
  });
  it('does not acknowledge a dropped write or corrupt readback', async () => {
    const { port } = records();
    const journal = await openOperationJournal(scope, () => scope, {
      ...port,
      compareAndSet: async () => {},
    });
    await expect(journal.save(scope, 't', { key: 'frozen' })).rejects.toThrow('保存后无法确认');
    expect(journal.load(scope, 't')).toBeNull();
  });
  it('rejects old-generation hydration and writes after identity change', async () => {
    let current = scope;
    const { port } = records();
    const journal = await openOperationJournal(scope, () => current, port);
    current = { ...scope, generation: 2 };
    await expect(journal.save(scope, 't', {})).rejects.toThrow('SESSION_CHANGED');
    expect(() => journal.entries()).toThrow('SESSION_CHANGED');
    await expect(openOperationJournal(scope, () => current, port)).rejects.toThrow(
      'SESSION_CHANGED',
    );
  });
  it('preserves malformed storage rather than overwriting it with a fresh task', async () => {
    const { port } = records();
    const malformed = { format: 2, scope: scopeKey(scope), taskId: 't', stamp: 'v2', value: {} };
    await expect(
      openOperationJournal(scope, () => scope, {
        ...port,
        readAll: async () => [malformed as JournalEntry],
      }),
    ).rejects.toThrow('原记录已保留');
    expect(malformed.format).toBe(2);
  });
});
