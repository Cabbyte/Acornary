import type { AttributeBindingV2 } from '../../../../packages/contracts/src/read-v2';
import Decimal from 'decimal.js';
import { validateValues } from '../../../../packages/contracts/src/registry';
import type { ManagedCatalog, ManagementTask } from '../features/management/pages/models';
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
  'catalog-create-group',
  'catalog-create-sku',
  'catalog-edit',
  'catalog-move',
  'catalog-void',
  'stock',
  'location-create',
  'location-edit',
  'location-void',
  'location-restore',
  'void',
  'restore',
  'dispose',
  'split',
  'template-add',
  'template-remove',
  'template-upgrade',
  'reassign',
  'history-correct',
  'reference',
]);
const creationKinds = new Set(['catalog-create-group', 'catalog-create-sku', 'location-create']);
export const isCatalogManagementTask = (kind: string) =>
  kind.startsWith('catalog-') || kind === 'stock';
export const requiresManagementApproval = (kind: string) =>
  isCatalogManagementTask(kind) || kind === 'reassign';
export const isSharedManagementTask = (task: ManagementTask | null | undefined) =>
  !!task && kinds.has(task.kind);

/** Captured bindings are read facts, including unknown fields and binding versions. */
export interface ManagementDraft {
  task: ManagementTask;
  bindings: Record<string, AttributeBindingV2 | null>;
  /** Changes only after an explicit reread/reconciliation of a rejected attempt. */
  requestKey?: string;
  /** Captured read facts; absence is never interpreted as a known default version. */
  catalog?: ManagedCatalog | null;
  creationCatalogId?: string;
  templateTargetVersion?: number;
  splitContentsVersion?: number;
  sourceQuantity?: {
    value: string | null;
    unit: string;
    accuracy: 'measured' | 'estimated' | 'unknown';
  };
  approvalReference?: { id: string; command: CommandAttempt };
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
export function prepareManagementCommand(
  draft: ManagementDraft,
  revisions: Record<string, number>,
  key = draft.requestKey ?? draft.task.taskId,
): CommandAttempt {
  const { task } = draft;
  if (!isSharedManagementTask(task)) throw Error('此管理任务尚未接入共享命令控制器。');
  if (!key || !task.taskId || key !== (draft.requestKey ?? task.taskId))
    throw Error('缺少原任务键，不能创建替代请求。');
  if (task.blockedReason) throw Error(task.blockedReason);
  if (
    (!creationKinds.has(task.kind) && !task.targetIds.length) ||
    task.targetIds.length > 100 ||
    new Set(task.targetIds).size !== task.targetIds.length
  )
    throw Error('必须明确选择 1–100 个不同的完整物品 ID；不会隐式拆批。');
  if (creationKinds.has(task.kind) && task.targetIds.length !== 0)
    throw Error('创建任务不能沿用已有对象作为修改目标。');
  if (
    !creationKinds.has(task.kind) &&
    !task.kind.startsWith('bulk-') &&
    task.targetIds.length !== 1
  )
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
  if (task.kind === 'history-correct' || task.kind === 'reference') {
    throw Error(
      task.kind === 'history-correct'
        ? '当前 correct_item 契约不能修改显示名称；草稿保留，不会冒充历史纠正。'
        : '缺少已读取的可编辑引用模板和路径；不会创建任意引用字段。',
    );
  } else if (isCatalogManagementTask(task.kind)) {
    const catalog = draft.catalog;
    if (
      !creationKinds.has(task.kind) &&
      (!catalog || catalog.id !== item_id || catalog.revision !== revisions[item_id])
    )
      throw Error('缺少已读取的目录对象和版本。');
    if (task.kind.startsWith('catalog-create')) {
      if (!values.parent) throw Error('请选择明确分类；不会推断根级。');
      command = {
        operation: 'create_catalog_node',
        payload: {
          ...base,
          kind: task.kind === 'catalog-create-group' ? 'GROUP' : 'SKU',
          name: values.name,
          parent_id: values.parent === 'root' ? null : values.parent,
          ...(task.kind === 'catalog-create-sku'
            ? { profile: values.profile === 'unknown' ? null : values.profile }
            : {}),
        },
      };
    } else if (task.kind === 'catalog-edit') {
      if (
        values.parent !== undefined &&
        (values.parent === 'root' ? null : values.parent) !== catalog!.parentId
      )
        throw Error('目录编辑不能同时移动归属；请使用独立的移动任务。');
      command = {
        operation: 'update_catalog_node',
        payload: {
          ...base,
          catalog_node_id: item_id,
          name: values.name,
          ...(catalog!.kind === 'SKU'
            ? { profile: values.profile === 'unknown' ? null : values.profile }
            : {}),
        },
      };
    } else if (task.kind === 'catalog-move') {
      if (!values.parent) throw Error('请选择明确分类或根级。');
      command = {
        operation: 'move_catalog_node',
        payload: {
          ...base,
          catalog_node_id: item_id,
          parent_id: values.parent === 'root' ? null : values.parent,
        },
      };
    } else if (task.kind === 'catalog-void') {
      command = {
        operation: 'void_catalog_node',
        payload: { ...base, catalog_node_id: item_id, reason: values.reason },
      };
    } else {
      if (catalog!.kind !== 'SKU') throw Error('补货策略只能绑定具体商品。');
      const binding = catalog!.attributes.find((row) => row.template_id === 'stock');
      if (binding && (binding.status !== 'KNOWN' || binding.template_version !== 1))
        throw Error('未知补货模板版本已保留，不能覆盖。');
      const stock = validateValues(
        'stock',
        {
          basis: values.mode,
          reorder_threshold: values.threshold,
          target: values.target,
          ...(values.mode === 'CONTENT' ? { content_unit: values.unit } : {}),
        },
        1,
      );
      if (new Decimal(values.target).lt(values.threshold)) throw Error('补货目标不能低于阈值。');
      command = {
        operation: binding ? 'update_attributes' : 'bind_attributes',
        payload: {
          ...base,
          target: { kind: 'CATALOG_NODE', id: item_id },
          template_id: 'stock',
          template_version: 1,
          ...(binding
            ? { set: stock, unset: values.mode === 'COUNT' ? ['content_unit'] : [] }
            : { values: stock }),
        },
      };
    }
  } else if (task.kind === 'location-create') {
    if (!draft.creationCatalogId || !values.destination)
      throw Error('缺少明确容器商品或上级位置，不能推断。');
    command = {
      operation: 'create_items',
      payload: {
        ...base,
        catalog_node_id: draft.creationCatalogId,
        count: 1,
        display_name: values.name,
        parent_id: values.destination === 'root' ? null : values.destination,
        initial_attributes: [
          { template_id: 'container', template_version: 1, values: { can_contain: true } },
        ],
      },
    };
  } else if (task.kind === 'location-edit') {
    command = {
      operation: 'update_item',
      payload: { ...base, item_id, display_name: values.name },
    };
  } else if (task.kind === 'void' || task.kind === 'location-void') {
    command = { operation: 'void_item', payload: { ...base, item_id, reason: values.reason } };
  } else if (task.kind === 'restore' || task.kind === 'location-restore') {
    command = {
      operation: 'correct_item',
      payload: { ...base, item_id, record_state: 'VALID', reason: values.reason },
    };
  } else if (task.kind === 'dispose') {
    command = {
      operation: 'dispose_item',
      payload: {
        ...base,
        item_id,
        disposition: {
          kind: values.disposition,
          date: values.date,
          ...(values.recipient ? { recipient_name: values.recipient } : {}),
          ...(values.note ? { note: values.note } : {}),
        },
      },
    };
  } else if (task.kind === 'reassign') {
    command = {
      operation: 'correct_item',
      payload: { ...base, item_id, reason: values.reason, core: { catalog_node_id: values.sku } },
    };
  } else if (task.kind === 'split') {
    const source = draft.sourceQuantity;
    const count = Number(values.count);
    if (
      !source?.value ||
      !draft.splitContentsVersion ||
      source.unit !== values.unit ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 100 ||
      !/^\d+(?:\.\d+)?$/.test(values.quantity) ||
      !new Decimal(values.quantity).gt(0) ||
      !new Decimal(source.value).eq(new Decimal(values.quantity).mul(count))
    )
      throw Error('拆包必须核对已知数量、原单位及 1–100 个子件的精确守恒。');
    const contents = validateValues(
      'contents',
      {
        remaining: { value: values.quantity, unit: values.unit },
        ...(source.accuracy === 'unknown' ? {} : { accuracy: source.accuracy.toUpperCase() }),
      },
      draft.splitContentsVersion,
    );
    command = {
      operation: 'split_item',
      payload: {
        ...base,
        source_item_id: item_id,
        target_catalog_node_id: values.sku,
        count,
        child_attributes: [
          {
            template_id: 'contents',
            template_version: draft.splitContentsVersion,
            values: contents,
          },
        ],
        ...(values.reason ? { reason: values.reason } : {}),
      },
    };
  } else if (task.kind.startsWith('template-')) {
    const binding = task.draft?.binding;
    if (task.kind === 'template-add') {
      if (binding || !draft.templateTargetVersion)
        throw Error('必须明确选择未绑定的已读取模板版本。');
      command = {
        operation: 'bind_attributes',
        payload: {
          ...base,
          target: { kind: 'ITEM', id: item_id },
          template_id: 'lifecycle',
          template_version: draft.templateTargetVersion,
          values: {},
        },
      };
    } else {
      if (!binding || binding.status !== 'KNOWN' || binding.template_id !== 'lifecycle')
        throw Error('未知或未读取的生命周期模板不能修改。');
      if (task.kind === 'template-remove') {
        command = {
          operation: 'remove_attributes',
          payload: {
            ...base,
            target: { kind: 'ITEM', id: item_id },
            template_id: binding.template_id,
            template_version: binding.template_version,
          },
        };
      } else {
        if (binding.template_version !== 1 || draft.templateTargetVersion !== 2)
          throw Error('仅已核对的 lifecycle 1 → 2 升级可执行；其他版本保留原记录。');
        const upgraded = Object.fromEntries(
          Object.entries(binding.values).filter(([key]) => key !== 'availability'),
        );
        // A strict target schema rejects unknown fields instead of silently dropping them.
        validateValues('lifecycle', upgraded, 2);
        command = {
          operation: 'upgrade_attributes',
          payload: {
            ...base,
            target: { kind: 'ITEM', id: item_id },
            template_id: 'lifecycle',
            from_version: 1,
            to_version: 2,
            values: upgraded,
          },
        };
      }
    }
  } else if (task.kind === 'item-save') {
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
  return validateCommandAttempt(command);
}

/** An adapter supplies the real approval ID after approval of this exact command. */
export function bindManagementApproval(
  draft: ManagementDraft,
  revisions: Record<string, number>,
  approvalId: string,
): ManagementDraft {
  const command = prepareManagementCommand(draft, revisions);
  if (!requiresManagementApproval(draft.task.kind)) throw Error('此任务没有目录审批步骤。');
  validateCommandAttempt({ ...command, payload: { ...command.payload, approval_id: approvalId } });
  return { ...structuredClone(draft), approvalReference: { id: approvalId, command } };
}
export function freezeManagementAttempt(
  draft: ManagementDraft,
  revisions: Record<string, number>,
  key = draft.requestKey ?? draft.task.taskId,
): ManagementAttempt {
  let command = prepareManagementCommand(draft, revisions, key);
  if (requiresManagementApproval(draft.task.kind)) {
    const approval = draft.approvalReference;
    if (!approval || JSON.stringify(approval.command) !== JSON.stringify(command))
      throw Error('审批未覆盖当前确切命令、原键及版本，请重新核对提案。');
    command = validateCommandAttempt({
      ...command,
      payload: { ...command.payload, approval_id: approval.id },
    });
  }
  return { key: key!, draft: structuredClone(draft), command };
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
  const unreadableLegacyAttempt =
    record.state === 'validationError' &&
    !record.attempt &&
    ['unknown', 'submitting', 'receipt'].includes(record.original.task.phase);
  return {
    ...record.draft.task,
    phase:
      record.state === 'success'
        ? 'receipt'
        : record.state === 'submitting'
          ? 'submitting'
          : unreadableLegacyAttempt ||
              record.state === 'networkUnknown' ||
              (record.state === 'sessionChanged' && record.attempt)
            ? 'unknown'
            : record.reviewing
              ? 'review'
              : 'draft',
    error: record.error || undefined,
    receipt: record.result?.receipt,
  };
}
