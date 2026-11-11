// Browser acceptance harness only; never imported by a production entry.
import {
  openOperationJournal,
  operationJournalNamespace,
} from '../src/app-vnext/operation-journal';
import { scopeKey, type ApplicationScope } from '../src/app-vnext/scope';
import { createIndexedDBOperationRecords } from '../src/platform-vnext/indexeddb-operation-records';

let scope: ApplicationScope;
let journal: Awaited<ReturnType<typeof openOperationJournal>>;
export async function open(accountId = 'acceptance-account', generation = 1) {
  scope = {
    environment: location.origin,
    accountId,
    householdId: 'acceptance-household',
    clientId: 'browser-test',
    datasetId: 'isolated-browser-journal-v1',
    generation,
  };
  journal = await openOperationJournal(
    scope,
    () => scope,
    createIndexedDBOperationRecords(indexedDB),
  );
}
export const save = (value: unknown) => journal.save(scope, 'consume:item-test', value);
export const load = () => journal.load(scope, 'consume:item-test');
export const raw = () =>
  createIndexedDBOperationRecords(indexedDB).read(scopeKey(scope), 'consume:item-test');
export async function seedMalformedAfterHydration() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(operationJournalNamespace, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      tx.objectStore('operations').put({
        format: 1,
        scope: scopeKey(scope),
        taskId: 'consume:item-test',
        value: { original: 'must-preserve' },
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
