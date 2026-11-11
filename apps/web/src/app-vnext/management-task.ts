import type { AttributeBindingV2 } from '../../../../packages/contracts/src/read-v2';
import type { ManagementTask } from '../features/management/pages/models';
import {
  OperationSession,
  validateCommandAttempt,
  type OperationRecord,
} from './operation-session';
import type { CommandAttempt, OperationStorage } from './platform';
import type { ApplicationScope } from './scope';

const kinds = new Set([
  'item-save',
  'attribute-save',
  'item-move',
  'location-move',
  'bulk-move',
  'bulk-consume',
  'bulk-lifecycle',
]);
export const isSharedManagementTask = (task: ManagementTask | null | undefined) =>
  !!task && kinds.has(task.kind);

/** Captured bindings are read facts, including unknown fields and binding versions. */
export interface ManagementDraft {
  task: ManagementTask;
  bindings: Record<string, AttributeBindingV2 | null>;
  /** Changes only after an explicit reread/reconciliation of a rejected attempt. */
  requestKey?: string;
}
export interface ManagementAttempt {
  key: string;
  draft: ManagementDraft;
  command: CommandAttempt;
}
export interface ManagementResult {
  receipt: string;
}
export type ManagementRecord = OperationRecord<
  ManagementDraft,
  ManagementAttempt,
  ManagementResult
>;
export type ManagementSession = OperationSession<
  ManagementDraft,
  ManagementAttempt,
  ManagementResult
>;

export function managementValueAt(values: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      values,
    );
}

/** One reviewed task becomes one schema-valid command. There is no implicit splitting. */
export function freezeManagementAttempt(
  draft: ManagementDraft,
  revisions: Record<string, number>,
  key = draft.requestKey ?? draft.task.taskId,
): ManagementAttempt {
  const { task } = draft;
  if (!isSharedManagementTask(task)) throw Error('此管理任务尚未接入共享命令控制器。');
  if (!key || !task.taskId || key !== (draft.requestKey ?? task.taskId))
    throw Error('缺少原任务键，不能创建替代请求。');
  if (task.blockedReason) throw Error(task.blockedReason);
  if (
    !task.targetIds.length ||
    task.targetIds.length > 100 ||
    new Set(task.targetIds).size !== task.targetIds.length
  )
    throw Error('必须明确选择 1–100 个不同的完整物品 ID；不会隐式拆批。');
  if (!task.kind.startsWith('bulk-') && task.targetIds.length !== 1)
    throw Error('单件任务必须只有一个目标。');
  for (const id of task.targetIds) {
    if (!Number.isInteger(revisions[id]) || revisions[id] < 1)
      throw Error('缺少目标的真实版本，必须重新读取并核对。');
    if (task.snapshot.find((row) => row.id === id)?.revision !== revisions[id])
      throw Error('任务版本与已核对快照不一致。');
  }
  const expected_revisions = Object.fromEntries(task.targetIds.map((id) => [id, revisions[id]]));
  const base = { idempotency_key: key, expected_revisions };
  const values = Object.fromEntries(task.fields.map((field) => [field.key, field.value]));
  const item_id = task.targetIds[0];
  let command: CommandAttempt;
  if (task.kind === 'item-save') {
    const name = task.draft?.name;
    if (!name || name.mode === 'unchanged' || (name.mode === 'set' && !name.value.trim()))
      throw Error('请明确设置名称或清除名称覆盖。');
    command = {
      operation: 'update_item',
      payload: {
        ...base,
        item_id,
        display_name: name.mode === 'clear' ? null : name.value,
      },
    };
  } else if (task.kind.endsWith('move')) {
    if (!values.destination) throw Error('请选择明确位置或根级，未知位置不能视作根级。');
    command = {
      operation: task.kind === 'bulk-move' ? 'move_items' : 'move_item',
      payload: {
        ...base,
        ...(task.kind === 'bulk-move' ? { item_ids: [...task.targetIds] } : { item_id }),
        parent_id: values.destination === 'root' ? null : values.destination,
      },
    };
  } else if (task.kind === 'bulk-consume') {
    command = { operation: 'consume_items', payload: { ...base, item_ids: [...task.targetIds] } };
  } else if (task.kind === 'attribute-save') {
    const binding = task.draft?.binding;
    const paths = task.draft?.changedAttributes;
    if (
      !binding ||
      binding.status !== 'KNOWN' ||
      binding.template_id !== 'lifecycle' ||
      !paths?.length
    )
      throw Error('没有可核对的生命周期修改，未知绑定不能推断为默认模板。');
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const path of paths) {
      const value = managementValueAt(binding.values, path);
      if (value === undefined) unset.push(path);
      else set[path] = value;
    }
    command = {
      operation: 'update_attributes',
      payload: {
        ...base,
        target: { kind: 'ITEM', id: item_id },
        template_id: binding.template_id,
        template_version: binding.template_version,
        set,
        unset,
      },
    };
  } else {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(values.date || '')
      ? new Date(`${values.date}T00:00:00.000Z`)
      : null;
    if (
      !['set', 'clear'].includes(values.mode) ||
      (values.mode === 'set' &&
        (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== values.date))
    )
      throw Error('请选择明确设值或清空；保持未改不能生成批量写入。');
    command = {
      operation: 'update_items_lifecycle',
      payload: {
        ...base,
        items: task.targetIds.map((id) => {
          const binding = draft.bindings[id];
          if (!binding || binding.status !== 'KNOWN' || binding.template_id !== 'lifecycle')
            throw Error('部分物品没有已读取的生命周期绑定，不能推断绑定版本。');
          return {
            item_id: id,
            template_version: binding.template_version,
            set: values.mode === 'set' ? { 'acquisition.acquired_on': values.date } : {},
            unset: values.mode === 'clear' ? ['acquisition.acquired_on'] : [],
          };
        }),
      },
    };
  }
  return { key, draft: structuredClone(draft), command: validateCommandAttempt(command) };
}

export function validManagementRecord(value: unknown): value is ManagementRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as ManagementRecord;
  if (
    record.version !== 1 ||
    !record.scope ||
    !record.taskId ||
    !record.original ||
    !record.draft?.task ||
    !record.draft.bindings ||
    !record.revisions ||
    !isSharedManagementTask(record.draft.task) ||
    record.taskId !== record.draft.task.taskId ||
    JSON.stringify(record.targetIds) !== JSON.stringify(record.draft.task.targetIds) ||
    ![
      'draft',
      'validationError',
      'approvalRequired',
      'submitting',
      'success',
      'networkUnknown',
      'revisionConflict',
      'offline',
      'forbidden',
      'sessionChanged',
    ].includes(record.state)
  )
    return false;
  if (['submitting', 'networkUnknown', 'success'].includes(record.state) && !record.attempt)
    return false;
  if (record.attempt) {
    try {
      const expected = freezeManagementAttempt(
        record.attempt.draft,
        record.revisions,
        record.attempt.key,
      );
      if (
        record.attempt.draft.task.taskId !== record.taskId ||
        JSON.stringify(expected.command) !== JSON.stringify(record.attempt.command) ||
        JSON.stringify(record.targetIds) !== JSON.stringify(record.attempt.draft.task.targetIds)
      )
        return false;
      if (
        JSON.stringify(
          freezeManagementAttempt(record.draft, record.revisions, record.attempt.key).command,
        ) !== JSON.stringify(record.attempt.command)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function createManagementSession(
  scope: ApplicationScope,
  draft: ManagementDraft,
  storage: OperationStorage,
  currentScope: () => ApplicationScope,
): ManagementSession {
  const { task } = draft;
  if (!task.taskId || !isSharedManagementTask(task)) throw Error('管理任务标识或类型无效。');
  const revisions = Object.fromEntries(task.snapshot.map((row) => [row.id, row.revision]));
  return new OperationSession(
    {
      version: 1,
      scope,
      taskId: task.taskId,
      targetIds: [...task.targetIds],
      original: structuredClone(draft),
      draft: structuredClone(draft),
      revisions,
      attempt: null,
      result: null,
      state: 'draft',
      reviewing: task.phase === 'review',
      approval: null,
      error: '',
    },
    storage,
    currentScope,
    (value): value is ManagementRecord =>
      validManagementRecord(value) &&
      value.taskId === task.taskId &&
      JSON.stringify(value.targetIds) === JSON.stringify(task.targetIds),
  );
}

export function managementTaskView(record: ManagementRecord): ManagementTask {
  return {
    ...record.draft.task,
    phase:
      record.state === 'success'
        ? 'receipt'
        : record.state === 'submitting'
          ? 'submitting'
          : record.state === 'networkUnknown' ||
              (record.state === 'sessionChanged' && record.attempt)
            ? 'unknown'
            : record.reviewing
              ? 'review'
              : 'draft',
    error: record.error || undefined,
    receipt: record.result?.receipt,
  };
}
