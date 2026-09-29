const DATABASE = 'acornary-web-v1';
let epoch = 0;
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function stored<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
export async function persist(key: string, value: unknown): Promise<void> {
  const started = epoch;
  const db = await openDB();
  if (started !== epoch) {
    db.close();
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      if (value === undefined) tx.objectStore('records').delete(key);
      else tx.objectStore('records').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function invalidatePendingStorage() {
  epoch++;
}
export async function clearPrivateData() {
  invalidatePendingStorage();
  localStorage.removeItem('acornary-account');
  localStorage.removeItem('acornary-last-household');
  sessionStorage.removeItem('acornary-household');
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function clearHouseholdData(userId: string, householdId: string) {
  invalidatePendingStorage();
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'),
        store = tx.objectStore('records');
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const key = String(row.key);
        if (key.startsWith(`${userId}:${householdId}:`) || key === `session:${householdId}`)
          row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
