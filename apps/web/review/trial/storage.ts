import { getTrialScope, isTrial, setTrialNavigationGuard } from './session';
interface Envelope {
  version: 1;
  revision: number;
  values: Record<string, string>;
}
const journal = 'acornary-trial-journal-v1';
let state: Envelope = { version: 1, revision: 0, values: {} };
let database: IDBDatabase | null = null;
let pending: Promise<void> = Promise.resolve();
let stale = false;
let writer = false;
let releaseWriter: (() => void) | undefined;
import.meta.hot?.dispose(() => releaseWriter?.());
export let storageNotice = '';
function mirror(next: Envelope) {
  if (!database) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const tx = database!.transaction('world', 'readwrite');
    tx.objectStore('world').put(next, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function initializeTrialStorage() {
  if (navigator.locks) {
    await new Promise<void>((resolve) => {
      void navigator.locks
        .request('acornary-trial-world-writer', { ifAvailable: true }, async (lock) => {
          writer = !!lock;
          resolve();
          if (lock)
            await new Promise<void>((release) => {
              releaseWriter = release;
            });
        })
        .catch(() => resolve());
    });
  }
  if (!writer)
    storageNotice = '当前标签仅供读取。请关闭其他试用标签后刷新；无法取得写入锁时不提交任务。';
  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('acornary-trial-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('world');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    storageNotice = 'IndexedDB 不可用；使用本地持久日志恢复。';
  }
  let saved: Envelope | null = null;
  try {
    const raw = localStorage.getItem(journal);
    if (raw) saved = JSON.parse(raw);
  } catch {
    storageNotice = '无法保存本地任务；提交将被阻止。';
  }
  if (!saved && database)
    saved = await new Promise<Envelope | null>((resolve, reject) => {
      const req = database!.transaction('world').objectStore('world').get('current');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  if (saved) {
    if (saved.version !== 1) throw Error('试用存储版本不兼容，旧数据已保留。');
    state = saved;
    if (writer)
      for (const [key, value] of Object.entries(state.values)) {
        try {
          const parsed = JSON.parse(value);
          const normalized = JSON.stringify(parsed, (key, v) =>
            ['state', 'status', 'phase'].includes(key)
              ? v === 'submitting'
                ? 'networkUnknown'
                : v === 'sending'
                  ? 'unknown'
                  : v
              : v,
          );
          state.values[key] = normalized;
        } catch {}
      }
    try {
      if (writer) localStorage.setItem(journal, JSON.stringify(state));
    } catch {
      storageNotice = '无法保存本地任务；提交将被阻止。';
    }
  }
  setTrialNavigationGuard(trialSubmitting);
  window.addEventListener('storage', (event) => {
    if (event.key === journal) stale = true;
  });
}
function prefix(key: string) {
  const scope = getTrialScope();
  return key.startsWith('settings-state')
    ? `${scope.accountId}:global:`
    : `${scope.accountId}:${scope.householdId}:`;
}
let transactionDepth = 0;
let commitCallbacks: (() => void)[] = [];
export function afterReviewCommit(fn: () => void) {
  if (transactionDepth) commitCallbacks.push(fn);
  else fn();
}
function write(values: Record<string, string>) {
  if (transactionDepth) {
    state = { ...state, values };
    return;
  }
  if (!writer) throw Error('当前标签未持有试用写入锁，请关闭其他试用标签后刷新。');
  if (stale) throw Error('另一个标签已更新试用数据，请刷新后核对。');
  const raw = localStorage.getItem(journal);
  if (raw && JSON.parse(raw).revision !== state.revision)
    throw Error('试用数据版本已变化，请刷新后核对。');
  const next: Envelope = { version: 1, revision: state.revision + 1, values };
  localStorage.setItem(journal, JSON.stringify(next));
  state = next;
  pending = pending
    .then(() => mirror(next))
    .catch(() => {
      storageNotice = '数据库镜像保存失败；原请求已保留在本地持久日志。';
    });
}
export const reviewStorage = {
  getItem(key: string): string | null {
    return isTrial() ? (state.values[prefix(key) + key] ?? null) : sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (!isTrial()) {
      sessionStorage.setItem(key, value);
      return;
    }
    write({
      ...state.values,
      [prefix(key) + key]: value,
      [prefix(key) + '__route:' + key]: location.hash.slice(1) || '/items',
    });
  },
  removeItem(key: string) {
    if (!isTrial()) {
      sessionStorage.removeItem(key);
      return;
    }
    const next = { ...state.values };
    delete next[prefix(key) + key];
    write(next);
  },
  get length() {
    return isTrial()
      ? Object.keys(state.values).filter((key) => key.startsWith(prefix(''))).length
      : sessionStorage.length;
  },
  key(index: number) {
    return isTrial()
      ? (Object.keys(state.values)
          .filter((key) => key.startsWith(prefix('')))
          [index]?.slice(prefix('').length) ?? null)
      : sessionStorage.key(index);
  },
};
export async function flushReviewStorage() {
  await pending;
}
export async function resetTrialStorage() {
  if (trialSubmitting()) throw Error('任务正在提交，请等待结果后重置。');
  write({});
  await flushReviewStorage();
  location.reload();
}
export function assertTrialWrite() {
  if (isTrial() && getTrialScope().role === 'viewer') throw Error('当前示例身份只可读取。');
}
function includesState(value: unknown, states: string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, entry]) =>
      (['state', 'status', 'phase'].includes(key) &&
        typeof entry === 'string' &&
        states.includes(entry)) ||
      (typeof entry === 'object' && includesState(entry, states)),
  );
}
export function trialSubmitting() {
  if (!isTrial()) return false;
  for (let i = 0; i < reviewStorage.length; i++) {
    const key = reviewStorage.key(i)!;
    try {
      if (
        includesState(JSON.parse(reviewStorage.getItem(key) || 'null'), ['submitting', 'sending'])
      )
        return true;
    } catch {}
  }
  return false;
}
export function pendingTrialTasks() {
  const tasks: { key: string; route: string }[] = [];
  if (!isTrial()) return tasks;
  for (let i = 0; i < reviewStorage.length; i++) {
    const key = reviewStorage.key(i)!;
    try {
      if (
        includesState(JSON.parse(reviewStorage.getItem(key) || 'null'), [
          'networkUnknown',
          'unknown',
        ])
      ) {
        const route = reviewStorage.getItem('__route:' + key);
        if (route) tasks.push({ key, route });
      }
    } catch {}
  }
  return tasks;
}

export function runReviewTransaction<T>(fn: () => T): T {
  if (!isTrial() || transactionDepth) return fn();
  const previous = state;
  transactionDepth++;
  try {
    const result = fn();
    const values = state.values;
    state = previous;
    transactionDepth--;
    write(values);
    const callbacks = commitCallbacks;
    commitCallbacks = [];
    callbacks.forEach((callback) => callback());
    return result;
  } catch (error) {
    state = previous;
    transactionDepth = 0;
    commitCallbacks = [];
    throw error;
  }
}
