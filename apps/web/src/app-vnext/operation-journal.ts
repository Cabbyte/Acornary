import type { OperationStorage } from './platform';
import { sameGeneration, scopeKey, type ApplicationScope } from './scope';

/** A separate vNext namespace. No legacy draft is migrated, removed, or reinterpreted. */
export const operationJournalNamespace = 'acornary-operation-journal-v1';
export interface JournalEntry {
  format: 1;
  scope: string;
  taskId: string;
  stamp: string;
  value: unknown;
}
export interface DurableOperationRecords {
  readAll(scope: string): Promise<readonly JournalEntry[]>;
  /** Atomic comparison and write. Must reject a concurrent replacement/deletion. */
  compareAndSet(entry: JournalEntry, expectedStamp: string | null): Promise<void>;
  read(scope: string, taskId: string): Promise<JournalEntry | undefined>;
}
export function isJournalEntry(value: unknown, expectedScope: string): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as JournalEntry;
  return (
    entry.format === 1 &&
    entry.scope === expectedScope &&
    typeof entry.taskId === 'string' &&
    entry.taskId.length > 0 &&
    typeof entry.stamp === 'string' &&
    entry.stamp.length > 0 &&
    Object.hasOwn(entry, 'value') &&
    entry.value != null
  );
}

/** Hydrate before creating any OperationSession; load is deliberately synchronous.
 * Cache publication requires transaction completion AND an exact readback. */
export async function openOperationJournal(
  scope: ApplicationScope,
  currentScope: () => ApplicationScope,
  records: DurableOperationRecords,
  newStamp: () => string = () => crypto.randomUUID(),
): Promise<OperationStorage & { entries(): readonly { taskId: string; value: unknown }[] }> {
  const owner = Object.freeze(structuredClone(scope));
  const identity = scopeKey(owner);
  const assertScope = (requested = owner) => {
    if (!sameGeneration(owner, requested) || !sameGeneration(owner, currentScope()))
      throw Error('SESSION_CHANGED');
  };
  assertScope();
  const saved = await records.readAll(identity);
  assertScope();
  const cache = new Map<string, JournalEntry>();
  for (const entry of saved) {
    if (!isJournalEntry(entry, identity) || cache.has(entry.taskId))
      throw Error('保存的任务索引无法安全读取，原记录已保留。');
    cache.set(entry.taskId, structuredClone(entry));
  }
  let writes: Promise<void> = Promise.resolve();
  return {
    load(requested, taskId) {
      assertScope(requested);
      return structuredClone(cache.get(taskId)?.value ?? null);
    },
    entries() {
      assertScope();
      return [...cache.values()].map(({ taskId, value }) => ({
        taskId,
        value: structuredClone(value),
      }));
    },
    save(requested, taskId, value) {
      if (!taskId) return Promise.reject(Error('任务 ID 不能为空。'));
      if (value == null) return Promise.reject(Error('任务记录不能为空，原记录已保留。'));
      // Clone now: changing the caller's object while queued must not change the write.
      const snapshot = structuredClone(value);
      const requestedScope = structuredClone(requested);
      const work = writes.then(async () => {
        assertScope(requestedScope);
        const prior = cache.get(taskId);
        const entry: JournalEntry = {
          format: 1,
          scope: identity,
          taskId,
          stamp: newStamp(),
          value: snapshot,
        };
        if (!entry.stamp || entry.stamp === prior?.stamp) throw Error('任务保存版本无效。');
        await records.compareAndSet(entry, prior?.stamp ?? null);
        assertScope(requestedScope);
        const confirmed = await records.read(identity, taskId);
        assertScope(requestedScope);
        if (
          !isJournalEntry(confirmed, identity) ||
          JSON.stringify(confirmed) !== JSON.stringify(entry)
        )
          throw Error('任务保存后无法确认原记录，请重新打开任务核对，未发送请求。');
        cache.set(taskId, structuredClone(entry));
      });
      writes = work.catch(() => {});
      return work;
    },
  };
}
