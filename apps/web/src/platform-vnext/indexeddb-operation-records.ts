import {
  operationJournalNamespace,
  isJournalEntry,
  type DurableOperationRecords,
  type JournalEntry,
} from '../app-vnext/operation-journal';

const objectStore = 'operations';
/** Dedicated store; existing production draft databases are neither opened nor changed.
 * Factory injection also lets a restricted MCP host decline this capability explicitly. */
export function createIndexedDBOperationRecords(factory: IDBFactory): DurableOperationRecords {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(operationJournalNamespace, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(objectStore, {
          keyPath: ['scope', 'taskId'],
        });
        store.createIndex('scope', 'scope');
      };
      request.onerror = () => reject(request.error ?? Error('任务存储不可用。'));
      request.onblocked = () => {
        blocked = true;
        reject(Error('任务存储升级被另一个窗口阻止。'));
      };
      request.onsuccess = () => {
        if (blocked) {
          request.result.close();
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  async function readRequest<T>(make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(objectStore, 'readonly');
        const request = make(tx.objectStore(objectStore));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? Error('无法读取任务。'));
        tx.onabort = () => reject(tx.error ?? Error('读取任务已中止。'));
      });
    } finally {
      db.close();
    }
  }
  return {
    readAll: (scope) => readRequest((store) => store.index('scope').getAll(scope)),
    read: (scope, taskId) => readRequest((store) => store.get([scope, taskId])),
    async compareAndSet(entry, expectedStamp) {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(objectStore, 'readwrite', { durability: 'strict' });
          const store = tx.objectStore(objectStore);
          const current = store.get([entry.scope, entry.taskId]);
          let conflict = false;
          current.onsuccess = () => {
            const prior = current.result as JournalEntry | undefined;
            if (
              prior === undefined
                ? expectedStamp !== null
                : !isJournalEntry(prior, entry.scope) ||
                  prior.taskId !== entry.taskId ||
                  expectedStamp === null ||
                  prior.stamp !== expectedStamp
            ) {
              conflict = true;
              tx.abort();
              return;
            }
            store.put(entry);
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? Error('保存任务失败。'));
          tx.onabort = () =>
            reject(
              conflict
                ? Error('任务已在另一个窗口改变，请重新读取原任务。')
                : (tx.error ?? Error('保存任务已中止。')),
            );
        });
      } finally {
        db.close();
      }
    },
  };
}
