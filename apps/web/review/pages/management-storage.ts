// Trial-only persistence/projection bridge. Production pages never import this adapter.
import type { ManagedCatalog, ManagementTask } from '../../src/features/management/pages/models';
import { reviewStorage } from '../trial/storage';
import { getTrialScope, isTrial } from '../trial/session';

export const managementStorageKey = 'management-state-v1';
export interface ManagementEnvelope<T> {
  schemaVersion: 1;
  dataset: 'trial-rc1';
  accountId: string;
  householdId: string;
  generation: number;
  state: T;
}
export function readManagementState<T>(): T | null {
  if (!isTrial()) return null;
  const raw = reviewStorage.getItem(managementStorageKey);
  if (!raw) return null;
  const envelope = JSON.parse(raw) as ManagementEnvelope<T>;
  const scope = getTrialScope();
  if (envelope.schemaVersion !== 1 || envelope.dataset !== 'trial-rc1')
    throw Error('管理任务存储版本不兼容；原数据已保留，请到试用工具选择重置。');
  if (envelope.accountId !== scope.accountId || envelope.householdId !== scope.householdId)
    return null;
  return envelope.state;
}
export function writeManagementState<T>(state: T) {
  if (!isTrial()) return;
  const existing = reviewStorage.getItem(managementStorageKey);
  if (existing) {
    const stored = JSON.parse(existing);
    if (stored.schemaVersion !== 1 || stored.dataset !== 'trial-rc1')
      throw Error('管理任务存储版本不兼容；原数据已保留，请到试用工具选择重置。');
  }
  const scope = getTrialScope();
  const envelope: ManagementEnvelope<T> = {
    schemaVersion: 1,
    dataset: 'trial-rc1',
    accountId: scope.accountId,
    householdId: scope.householdId,
    generation: scope.generation,
    state,
  };
  reviewStorage.setItem(managementStorageKey, JSON.stringify(envelope));
}
/** Catalog names are independent of individual display-name overrides. */
export function getManagementCatalogs(): readonly ManagedCatalog[] {
  try {
    return readManagementState<{ catalogs: ManagedCatalog[] }>()?.catalogs || [];
  } catch {
    return [];
  }
}
/** Root recovery surface may link directly to the original management route. */
export function getManagementTask(): ManagementTask | null {
  try {
    const state = readManagementState<{
      task: ManagementTask | null;
      retainedTask: ManagementTask | null;
    }>();
    return state?.task || state?.retainedTask || null;
  } catch {
    return null;
  }
}
