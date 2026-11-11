// Private isolated-world adapter. Production management controllers never import this module.
import type { AttributeBindingV2 } from '../../../../packages/contracts/src/read-v2';
import type {
  FieldDraft,
  ManagedCatalog,
  ManagedLocation,
  ManagementTask,
  ManagementModel,
} from '../../src/features/management/pages/models';
import {
  createManagementSession,
  bindManagementApproval,
  isCatalogManagementTask,
  freezeManagementAttempt,
  type ManagementAttempt,
  type ManagementDraft,
  type ManagementRecord,
  type ManagementResult,
} from '../../src/app-vnext/management-task';
import { sameGeneration, type ApplicationScope } from '../../src/app-vnext/scope';
import type { CommandAttempt } from '../../src/app-vnext/platform';
import { getFixtureScope } from '../trial/application';
import { getTrialScope, isTrial } from '../trial/session';
import { flushReviewStorage, reviewStorage, runReviewTransaction } from '../trial/storage';
import { getReviewWorld, updateReviewItems } from './inventory-session';
import { readManagementState, writeManagementState } from './management-storage';
import { bindingFromFacts, projectLifecycle } from './management-lifecycle-projection';
import {
  projectExtendedManagementCommand,
  usesExtendedManagementProjection,
} from './management-domain-adapter';
import { projectLocationChange } from './management-tree-projection';
import { getExtraReviewNotes, getExtraReviewAttachments } from './daily-extras-fixture';

export interface ManagementFixtureState {
  catalogs: ManagedCatalog[];
  extraHistory?: ManagementModel['history'];
  dispositions?: Record<string, Record<string, unknown>>;
  splits?: Record<string, { childItemIds: string[]; targetCatalogId: string }>;
  locations: ManagedLocation[];
  explicitNames: Record<string, boolean>;
  receipts: Record<string, string>;
  operationRequests?: Record<string, CommandAttempt>;
  bindings: Record<string, AttributeBindingV2 | null>;
  itemDrafts: Record<
    string,
    {
      nameDraft: FieldDraft;
      attributeDraft: AttributeBindingV2 | null;
      changedAttributes: string[];
    }
  >;
  nameDraft: FieldDraft;
  attributeDraft: AttributeBindingV2 | null;
  changedAttributes: string[];
  editId: string | null;
  task: ManagementTask | null;
  retainedTask: ManagementTask | null;
}
function fail(code: string, message: string): never {
  throw Object.assign(Error(message), { code });
}
function assertScope(scope: ApplicationScope) {
  if (!sameGeneration(scope, getFixtureScope())) fail('SESSION_CHANGED', '原任务身份已变化。');
}
export function createManagementFixtureSession(draft: ManagementDraft) {
  const scope = getFixtureScope();
  let loaded = false;
  const session = createManagementSession(
    scope,
    draft,
    {
      load(_scope, taskId) {
        assertScope(_scope);
        const raw = reviewStorage.getItem(`management-operation:${taskId}`);
        if (raw) {
          loaded = true;
          return JSON.parse(raw);
        }
        // RC1 only captured a display task. Adopt only inputs actually frozen there;
        // never invent original bulk binding versions from today's facts.
        if (['unknown', 'submitting', 'receipt'].includes(draft.task.phase)) {
          loaded = true;
          if (
            ![
              'item-save',
              'attribute-save',
              'item-move',
              'location-move',
              'bulk-move',
              'bulk-consume',
            ].includes(draft.task.kind)
          )
            throw Error('旧管理任务缺少原命令、审批或绑定版本；原记录保留，不能重新执行。');
          const revisions = Object.fromEntries(
            draft.task.snapshot.map((row) => [row.id, row.revision]),
          );
          const attempt = freezeManagementAttempt(draft, revisions);
          const committed = draft.task.phase === 'receipt';
          const record: ManagementRecord = {
            version: 1,
            scope,
            taskId,
            targetIds: [...draft.task.targetIds],
            original: structuredClone(draft),
            draft: structuredClone(draft),
            revisions,
            attempt,
            attemptStatus: committed ? 'committed' : 'uncertain',
            result: committed ? { receipt: draft.task.receipt || '已保存隔离回执。' } : null,
            state: committed ? 'success' : 'networkUnknown',
            reviewing: true,
            approval: null,
            error: '',
          };
          return record;
        }
        return null;
      },
      async save(_scope, taskId, value) {
        assertScope(_scope);
        reviewStorage.setItem(`management-operation:${taskId}`, JSON.stringify(value));
        if (isTrial()) await flushReviewStorage();
        assertScope(_scope);
      },
    },
    getFixtureScope,
  );
  if (!loaded && session.getSnapshot().state === 'draft') void session.update({ draft });
  return session;
}

/** A UUID-shaped approval only for the isolated world; never a backend approval. */
export function approveManagementFixtureDraft(
  draft: ManagementDraft,
  revisions: Record<string, number>,
) {
  return bindManagementApproval(draft, revisions, crypto.randomUUID());
}

function replaceAt(
  values: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...tail] = path.split('.');
  const next = { ...values };
  if (tail.length)
    next[head] = replaceAt((values[head] as Record<string, unknown>) || {}, tail.join('.'), value);
  else if (value === undefined) delete next[head];
  else next[head] = value;
  return next;
}

export async function executeManagementFixtureAttempt(
  scope: ApplicationScope,
  attempt: ManagementAttempt,
  stateKey: string,
  scenario: string,
  recovering = false,
): Promise<ManagementResult> {
  assertScope(scope);
  if (isTrial() && getTrialScope().role === 'viewer') fail('FORBIDDEN', '当前示例身份只可读取。');
  const task = attempt.draft.task;
  const revisions = attempt.command.payload.expected_revisions as Record<string, number>;
  const projected = freezeManagementAttempt(attempt.draft, revisions, attempt.key);
  if (JSON.stringify(projected.command) !== JSON.stringify(attempt.command))
    fail('IDEMPOTENCY_CONFLICT', '原请求参数与冻结任务不一致。');
  const state = readManagementState<ManagementFixtureState>(stateKey);
  if (!state) fail('STATE_CONFLICT', '原管理作用域不可读取，未执行。');
  const world = getReviewWorld();
  const known = state.receipts[attempt.key];
  const fingerprint = state.operationRequests?.[attempt.key];
  if (fingerprint && JSON.stringify(fingerprint) !== JSON.stringify(attempt.command))
    fail('IDEMPOTENCY_CONFLICT', '此原键已用于不同参数，未重复执行。');
  if ((known || world.receipts[attempt.key]) && !fingerprint) {
    // Older isolated receipts have no wire fingerprint. Only a still-retained
    // original task can justify the schema projection used to recover it.
    const legacy = [state.task, state.retainedTask].find((row) => row?.taskId === attempt.key);
    if (!legacy) fail('IDEMPOTENCY_CONFLICT', '旧回执缺少可核对的原参数，原记录保留。');
    const original = freezeManagementAttempt(
      { ...attempt.draft, task: legacy },
      Object.fromEntries(legacy.snapshot.map((row) => [row.id, row.revision])),
    );
    if (JSON.stringify(original.command) !== JSON.stringify(attempt.command))
      fail('IDEMPOTENCY_CONFLICT', '旧回执与保留的原任务参数不一致。');
  }
  if (known || world.receipts[attempt.key])
    return { receipt: known || '已找到原任务回执，相关物品已更新；没有重复执行。' };
  const catalogTask = isCatalogManagementTask(task.kind);
  const targets = (catalogTask ? [] : task.targetIds).map((id) => {
    const facts = world.items.find((row) => row.item.id === id);
    if (!facts || facts.item.revision !== revisions[id])
      fail('REVISION_CONFLICT', '对象版本已变化或不可访问，整批未执行；输入和原版本已保留。');
    return facts;
  });
  const values = Object.fromEntries(task.fields.map((field) => [field.key, field.value]));
  const destination = state.locations.find((row) => row.id === values.destination);
  if (
    !catalogTask &&
    task.kind.endsWith('move') &&
    values.destination !== 'root' &&
    (!destination || !destination.canContain || destination.recordState !== 'VALID')
  )
    fail('INVALID_PARENT', '目标不是当前可访问的有效容器，不能推断为根级。');
  if (!catalogTask && task.kind.endsWith('move')) {
    let parent = destination?.id;
    const seen = new Set<string>();
    while (parent) {
      if (task.targetIds.includes(parent) || seen.has(parent))
        fail('CYCLE_DETECTED', '不能移动到自身或后代。');
      seen.add(parent);
      parent = state.locations.find((row) => row.id === parent)?.parentId || undefined;
    }
    if (
      task.kind === 'bulk-move' &&
      task.targetIds.some((id) => state.locations.some((row) => row.id === id))
    )
      fail('INVALID_TRANSITION', '批量范围包含容器，请逐件核对子内容影响。');
  }
  if (
    task.kind === 'bulk-consume' &&
    targets.some(
      ({ item }) =>
        item.profile !== 'CONSUMABLE' ||
        item.recordState !== 'VALID' ||
        ['已用完', '已处置', '已拆包'].includes(item.status.label),
    )
  )
    fail('INVALID_TRANSITION', '范围含非消耗品或已结束记录，整个批次未执行。');
  let next = structuredClone(state);
  let changed = targets.map((facts) => structuredClone(facts));
  const payload = attempt.command.payload;
  let receipt = '隔离样例已更新。正式家庭未发生写入。';
  let eventType = task.kind.endsWith('move') ? 'ITEM_MOVED' : 'ITEM_UPDATED';
  const extended = usesExtendedManagementProjection(task.kind);
  if (extended) {
    const referenceId = task.targetIds[0];
    const references =
      !!getExtraReviewNotes(referenceId)?.length ||
      !!getExtraReviewAttachments(referenceId)?.length;
    const projected = projectExtendedManagementCommand(attempt, state, world, references);
    next = projected.next;
    changed = projected.changed;
    receipt = projected.receipt;
    eventType = projected.eventType;
  } else if (task.kind === 'item-save') {
    const item = changed[0].item;
    const catalog = state.catalogs.find((row) => row.id === item.skuId);
    if (payload.display_name === null && !catalog)
      fail('MISSING_FACTS', '商品名称不可读取，不能推断清除覆盖后的名称。');
    item.name = payload.display_name === null ? catalog!.name : String(payload.display_name);
    next.explicitNames[item.id] = payload.display_name !== null;
    const nameDraft: FieldDraft = { mode: 'unchanged', value: item.name };
    next.itemDrafts[item.id] = {
      nameDraft,
      attributeDraft: next.itemDrafts[item.id]?.attributeDraft || null,
      changedAttributes: [],
    };
    if (next.editId === item.id) next.nameDraft = nameDraft;
  } else if (!catalogTask && task.kind.endsWith('move')) {
    const targetLocation = destination
      ? { id: destination.id, path: [...destination.path], label: destination.name }
      : { id: null, path: [], label: '位置未记录' };
    changed.forEach((row) => {
      row.item.location = structuredClone(targetLocation);
    });
    if (task.kind === 'location-move') {
      const projection = projectLocationChange(next.locations, world.items, task.targetIds[0], {
        parentId: targetLocation.id,
      });
      next.locations = projection.locations;
      changed = projection.items;
    }
  } else if (task.kind === 'bulk-consume') {
    changed.forEach((row) => {
      row.quantity = { ...row.quantity, value: '0' };
      row.item.status = { label: '已用完', tone: 'neutral' };
    });
  } else {
    changed = changed.map((facts) => {
      const current =
        state.bindings[facts.item.id] === undefined
          ? bindingFromFacts(facts)
          : state.bindings[facts.item.id];
      const patch =
        task.kind === 'attribute-save'
          ? payload
          : (payload.items as Array<Record<string, unknown>>).find(
              (row) => row.item_id === facts.item.id,
            )!;
      if (!current || current.template_version !== patch.template_version)
        fail('REVISION_CONFLICT', '生命周期绑定版本已变化，整批未执行。');
      let values = structuredClone(current.values);
      for (const [path, value] of Object.entries(patch.set as Record<string, unknown>))
        values = replaceAt(values, path, value);
      for (const path of patch.unset as string[]) values = replaceAt(values, path, undefined);
      const binding = { ...current, values };
      next.bindings[facts.item.id] = binding;
      if (next.editId === facts.item.id) {
        next.attributeDraft = binding;
        next.changedAttributes = [];
      }
      return projectLifecycle(facts, binding);
    });
  }
  if (!extended)
    changed.forEach((facts) => {
      const before = world.items.find((row) => row.item.id === facts.item.id)!;
      facts.item.revision = before.item.revision + (task.targetIds.includes(facts.item.id) ? 1 : 0);
    });
  const projectionOnlyIds = changed
    .filter((facts) =>
      world.items.some(
        (before) =>
          before.item.id === facts.item.id && before.item.revision === facts.item.revision,
      ),
    )
    .map((facts) => facts.item.id);
  next.receipts[attempt.key] = receipt;
  next.operationRequests = {
    ...next.operationRequests,
    [attempt.key]: structuredClone(attempt.command),
  };
  runReviewTransaction(() => {
    updateReviewItems(changed, {
      requestKey: attempt.key,
      operationLabel: task.title,
      reason: String(payload.reason || '隔离管理任务'),
      eventType,
      projectionOnlyIds,
    });
    writeManagementState(next, stateKey);
  });
  if (isTrial()) await flushReviewStorage();
  assertScope(scope);
  if (!recovering && ['unknown', 'network-unknown'].includes(scenario))
    fail('NETWORK', '隔离回执丢失样例，请使用原请求核对结果。');
  return { receipt };
}
