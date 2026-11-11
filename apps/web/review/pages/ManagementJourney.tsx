import type { BeginExport } from '../../../../packages/contracts/src/export';
import {
  runManagementExportStep,
  recoverManagementExportStep,
} from '../../src/app-vnext/management-export';
import {
  createManagementExportFixtureSession,
  managementExportFixtureView,
  managementFixtureExportPort,
} from './management-export-adapter';
// Isolated review controller. All reading, filtering and mutation simulation stays here.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOperationSessions } from '../../src/app-vnext/operation-context';
import { getFixtureScope } from '../trial/application';
import {
  freezeManagementAttempt,
  isCatalogManagementTask,
  requiresManagementApproval,
  isSharedManagementTask,
  managementTaskView,
} from '../../src/app-vnext/management-task';
import {
  createManagementFixtureSession,
  approveManagementFixtureDraft,
  executeManagementFixtureAttempt,
} from './management-task-adapter';
import type { AttributeFieldEdit } from '../../src/ui/patterns/attribute-fields';
import type { ItemView } from '../../src/ui/patterns/types';
import type { TreeViewNode } from '../../src/ui/components/ui/tree-view';
import {
  ManagementItems,
  ManagementCatalog,
  ManagementLocations,
  ManagementEdit,
  ManagementBulk,
  ManagementHistory,
} from '../../src/features/management/pages/ManagementPages';
import type {
  ManagementModel,
  ManagementTask,
  ManagementField,
  ManagedCatalog,
  ManagedLocation,
} from '../../src/features/management/pages/models';
import { householdId } from './fixtures';
import { useReviewWorld, getReviewWorld } from './inventory-session';
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import { getTrialScope, isTrial } from '../trial/session';
import { readManagementState, writeManagementState } from './management-storage';
import { managementItemFromFacts } from './management-item-projection';
import { bindingFromFacts } from './management-lifecycle-projection';
import {
  catalogFixtures,
  locationFixtures,
  lifecycleTemplate,
  lifecycleBinding,
  unknownBinding,
  largeSelectionItems,
  containerCatalog,
  gid,
  iid,
} from './management-fixtures';

type LocalState = {
  explicitNames: Record<string, boolean>;
  receipts: Record<string, string>;
  storageError: string;
  itemDrafts: Record<
    string,
    {
      nameDraft: ManagementModel['nameDraft'];
      attributeDraft: typeof lifecycleBinding | null;
      changedAttributes: string[];
    }
  >;
  query: string;
  sorting: ManagementModel['sorting'];
  page: number;
  locationFilter: string | null;
  categoryFilter: string | null;
  includeVoid: boolean;
  includeHidden: boolean;
  includeOneOff: boolean;
  showDetails: boolean;
  selectedIds: string[];
  revisions: Record<string, number>;
  selectionExpanded: boolean;
  expandedRows: string[];
  catalogExpanded: string[];
  locationExpanded: string[];
  treeOpen: boolean;
  catalogId: string | null;
  locationId: string | null;
  catalogs: ManagedCatalog[];
  locations: ManagedLocation[];
  feedback: string;
  task: ManagementTask | null;
  retainedTask: ManagementTask | null;
  savedTasks?: ManagementTask[];
  export: ManagementModel['export'];
  exportSession?: { taskId: string; selection: BeginExport; label: string };
  exportRows: ItemView[];
  nameDraft: ManagementModel['nameDraft'];
  bindings: Record<string, typeof lifecycleBinding | null>;
  attributeDraft: typeof lifecycleBinding | null;
  changedAttributes: string[];
  historyExpanded: string[];
  historyEvent: string;
  historyOperation: string;
  historyTarget: string;
  historyFrom: string;
  historyTo: string;
  completedOperations: string[];
  conflict: ManagementModel['conflict'];
  recovered: boolean;
  extraHistory: ManagementModel['history'];
  editId: string | null;
  templateRemoved: string[];
};
const noOperationSubscription = () => () => {};
const noOperationSnapshot = () => null;
const specialLimit = (scenario: string) =>
  ['limit', 'over-limit', '100-items', 'selection-limit'].includes(scenario);
function makeInitial(scenario: string, items: readonly ItemView[]): LocalState {
  const locations =
    scenario === 'empty' || (isTrial() && !items.length) ? [] : locationFixtures(items);
  return {
    explicitNames: {},
    receipts: {},
    storageError: '',
    itemDrafts: {},
    query: '',
    sorting: [],
    page: 0,
    locationFilter: null,
    categoryFilter: null,
    includeVoid: false,
    includeHidden: false,
    includeOneOff: false,
    showDetails: false,
    selectedIds: specialLimit(scenario)
      ? items.slice(0, 100).map((item) => item.id)
      : scenario === 'hidden'
        ? [items[items.length - 1]?.id].filter(Boolean)
        : [],
    revisions: Object.fromEntries(items.map((item) => [item.id, item.revision])),
    selectionExpanded: false,
    expandedRows: [],
    catalogExpanded: [gid(10), gid(20), gid(30)],
    locationExpanded: locations.map((row) => row.id),
    treeOpen: false,
    catalogId: null,
    locationId: locations.find((row) => row.name === '冰箱')?.id || locations[0]?.id || null,
    catalogs: scenario === 'empty' || (isTrial() && !items.length) ? [] : catalogFixtures(items),
    locations,
    feedback: '',
    task: null,
    retainedTask: null,
    export: null,
    exportRows: [],
    nameDraft: { mode: 'unchanged', value: items[0]?.name || '' },
    bindings: {},
    attributeDraft: null,
    changedAttributes: [],
    historyExpanded: [],
    historyEvent: '',
    historyOperation: '',
    historyTarget: '',
    historyFrom: '',
    historyTo: '',
    completedOperations: [],
    conflict: null,
    recovered: false,
    extraHistory: [],
    editId: null,
    templateRemoved: [],
  };
}
function tree(
  rows: readonly { id: string; parentId: string | null; name: string; path: string[] }[],
  parent: string | null = null,
  ancestors: readonly string[] = [],
): TreeViewNode[] {
  return rows
    .filter((row) => row.parentId === parent && !ancestors.includes(row.id))
    .map((row) => ({
      id: row.id,
      label: row.name,
      description: row.path.join(' › '),
      children: tree(rows, row.id, [...ancestors, row.id]),
    }));
}
function field(
  key: string,
  label: string,
  value = '',
  extra: Partial<ManagementField> = {},
): ManagementField {
  return { key, label, value, ...extra };
}
function withValues(task: ManagementTask): Record<string, string> {
  return Object.fromEntries(task.fields.map((row) => [row.key, row.value]));
}
function atPath(values: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      values,
    );
}
function patchAt(
  values: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...tail] = path.split('.');
  if (!tail.length) {
    const next = { ...values };
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  return {
    ...values,
    [head]: patchAt((values[head] as Record<string, unknown>) || {}, tail.join('.'), value),
  };
}
function vIgnored(values: Record<string, string>): boolean {
  return values.mode === 'CONTENT'
    ? !['mL', 'L', 'g', 'kg', 'count'].includes(values.unit)
    : !['件', 'count'].includes(values.unit);
}
function describe(value: unknown): string {
  return value === undefined
    ? '未记录'
    : value === null
      ? '明确清空'
      : typeof value === 'string'
        ? value || '空文本'
        : JSON.stringify(value);
}

function hasAncestor(
  rows: readonly { id: string; parentId: string | null }[],
  candidateId: string,
  ancestorId: string,
): boolean {
  let id: string | null = candidateId;
  const seen = new Set<string>();
  while (id) {
    if (id === ancestorId) return true;
    if (seen.has(id)) return true;
    seen.add(id);
    id = rows.find((row) => row.id === id)?.parentId || null;
  }
  return false;
}

export function ManagementJourney({
  path,
  scenario,
  navigate,
}: {
  path: string;
  scenario: string;
  navigate: (path: string) => void;
}) {
  const world = useReviewWorld();
  const url = new URL(path, 'https://review.invalid');
  const route = url.pathname;
  const baseItems = world.items.map(managementItemFromFacts);
  const availableItems = specialLimit(scenario) ? largeSelectionItems() : baseItems;
  const scope = getTrialScope();
  const scopeKey = isTrial()
    ? `${scope.accountId}:${scope.householdId}:${scope.generation}`
    : `review:${scenario}`;
  const load = (): LocalState => {
    const initial = makeInitial(scenario, availableItems);
    try {
      const stored = readManagementState<LocalState>(scopeKey);
      if (!stored) return initial;
      const recover = (task: ManagementTask | null) => {
        if (task && ['submitting', 'networkUnknown'].includes(task.phase))
          return {
            ...task,
            phase: 'unknown' as const,
            error: '上次提交被中断，先按原任务核对结果；不会自动重发。',
          };
        if (
          task &&
          task.scopeGeneration !== scope.generation &&
          !['unknown', 'receipt'].includes(task.phase)
        )
          return {
            ...task,
            phase: 'draft' as const,
            scopeGeneration: scope.generation,
            approval: task.approval ? { ...task.approval, status: 'awaiting' as const } : undefined,
          };
        return task;
      };
      return {
        ...initial,
        ...stored,
        task: recover(stored.task),
        retainedTask: recover(stored.retainedTask),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '管理草稿读取失败，暂不能提交。';
      return { ...initial, storageError: message, feedback: message };
    }
  };
  const [storedLocal, setLocal] = useState(() => ({ key: scopeKey, value: load() }));
  const rawLocal = storedLocal.key === scopeKey ? storedLocal.value : load();
  const sessions = useOperationSessions();
  const sessionFor = (task: ManagementTask) =>
    sessions.get(getFixtureScope(), task.taskId!, () =>
      createManagementFixtureSession({
        task,
        catalog: rawLocal.catalogs.find((row) => row.id === task.targetIds[0]) || null,
        creationCatalogId: rawLocal.catalogs.find(
          (row) => row.id === containerCatalog.id && row.recordState === 'VALID',
        )?.id,
        templateTargetVersion: 2,
        splitContentsVersion: 2,
        sourceQuantity: world.items.find((row) => row.item.id === task.targetIds[0])?.quantity,
        bindings: Object.fromEntries(
          task.targetIds.map((id) => [
            id,
            rawLocal.bindings[id] === undefined
              ? bindingFromFacts(world.items.find((row) => row.item.id === id))
              : rawLocal.bindings[id],
          ]),
        ),
      }),
    );
  const activeTask = rawLocal.task || rawLocal.retainedTask;
  const operation =
    activeTask && isSharedManagementTask(activeTask) && activeTask.taskId
      ? sessionFor(activeTask)
      : null;
  const operationRecord = useSyncExternalStore(
    operation?.subscribe || noOperationSubscription,
    operation?.getSnapshot || noOperationSnapshot,
  );
  const exportPointer = rawLocal.exportSession;
  const exportSession = exportPointer
    ? sessions.get(getFixtureScope(), exportPointer.taskId, () =>
        createManagementExportFixtureSession(
          exportPointer.taskId,
          exportPointer.selection,
          exportPointer.label,
        ),
      )
    : null;
  const exportRecord = useSyncExternalStore(
    exportSession?.subscribe || noOperationSubscription,
    exportSession?.getSnapshot || noOperationSnapshot,
  );
  const projectedTask = operationRecord ? managementTaskView(operationRecord) : null;
  const local = projectedTask
    ? {
        ...rawLocal,
        task: rawLocal.task ? projectedTask : null,
        retainedTask:
          rawLocal.retainedTask && !rawLocal.task ? projectedTask : rawLocal.retainedTask,
      }
    : rawLocal;
  const localRef = useRef(local);
  localRef.current = local;
  const set = (updater: (state: LocalState) => LocalState): boolean => {
    if (isTrial()) {
      const latest = getTrialScope();
      if (
        latest.accountId !== scope.accountId ||
        latest.householdId !== scope.householdId ||
        latest.generation !== scope.generation
      )
        return false;
    }
    const previous = localRef.current;
    let next = updater(previous);
    if (next.editId)
      next = {
        ...next,
        itemDrafts: {
          ...next.itemDrafts,
          [next.editId]: {
            nameDraft: next.nameDraft,
            attributeDraft: next.attributeDraft,
            changedAttributes: next.changedAttributes,
          },
        },
      };
    try {
      if (
        next.task &&
        next.task !== previous.task &&
        isSharedManagementTask(next.task) &&
        next.task.taskId
      ) {
        const session = sessionFor(next.task);
        const record = session.getSnapshot();
        // View phase and messages are projected from the root session; only changed
        // reviewed inputs replace its draft. Frozen uncertain requests reject edits.
        const input = (task: ManagementTask) => ({
          ...task,
          phase: 'draft',
          error: undefined,
          receipt: undefined,
        });
        if (JSON.stringify(input(next.task)) !== JSON.stringify(input(record.draft.task))) {
          let draft = {
            ...record.draft,
            task: next.task,
            ...(record.attemptStatus === 'rejected' ? { requestKey: crypto.randomUUID() } : {}),
          };
          if (requiresManagementApproval(next.task.kind)) {
            draft = { ...draft, approvalReference: undefined };
            if (next.task.approval?.status === 'approved')
              draft = approveManagementFixtureDraft(draft, record.revisions);
          }
          const reviewing = next.task.phase === 'review';
          void session
            .update({ draft, state: 'draft', error: next.task.error || '' })
            .then((saved) => {
              const latest = session.getSnapshot();
              if (
                saved &&
                reviewing &&
                !latest.attempt &&
                JSON.stringify(latest.draft) === JSON.stringify(draft)
              )
                return session.update({ reviewing: true });
            });
        } else if (
          ![
            'submitting',
            'networkUnknown',
            'success',
            'revisionConflict',
            'sessionChanged',
          ].includes(record.state)
        )
          void session.update({
            reviewing: next.task.phase === 'review',
            error: next.task.error || '',
          });
      }
      writeManagementState(next, scopeKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : '草稿持久化失败，当前输入仍保留。';
      next = { ...next, storageError: message, feedback: message };
      localRef.current = next;
      setLocal({ key: scopeKey, value: next });
      return false;
    }
    localRef.current = next;
    setLocal({ key: scopeKey, value: next });
    return true;
  };
  useEffect(() => {
    if (storedLocal.key !== scopeKey) setLocal({ key: scopeKey, value: load() });
  }, [scopeKey]);
  useEffect(() => {
    if (operationRecord && ['success', 'networkUnknown'].includes(operationRecord.state)) {
      const saved = readManagementState<LocalState>(scopeKey);
      if (saved) setLocal({ key: scopeKey, value: saved });
    }
  }, [operationRecord?.state, operationRecord?.taskId]);
  const state: ManagementModel['state'] = local.recovered
    ? 'ready'
    : scenario === 'loading'
      ? 'loading'
      : scenario === 'error'
        ? 'error'
        : scenario === 'forbidden'
          ? 'forbidden'
          : scenario === 'session-changed'
            ? 'session-changed'
            : scenario.startsWith('offline')
              ? 'offline'
              : 'ready';
  const available =
    state === 'ready' && (!isTrial() || scope.role !== 'viewer') && !local.storageError;
  const writeAvailability: ManagementModel['writeAvailability'] = available
    ? { kind: 'available' }
    : {
        kind:
          state === 'offline'
            ? 'offline'
            : state === 'forbidden' || (isTrial() && scope.role === 'viewer')
              ? 'forbidden'
              : 'blockedState',
        reason:
          local.storageError || (isTrial() && scope.role === 'viewer')
            ? local.storageError || '当前为只读成员，可以查看记录，不能提交修改。'
            : state === 'offline'
              ? '离线时保留草稿，恢复连接后重新核对。'
              : '当前身份或读取状态不允许提交。',
      };
  const items =
    state === 'session-changed' ||
    state === 'forbidden' ||
    (scenario === 'empty' && !local.recovered)
      ? []
      : availableItems;
  const itemId = url.searchParams.get('id') || items[0]?.id || '';
  const item = items.find((row) => row.id === itemId) || null;
  const dynamicCatalogs = [
    ...local.catalogs,
    ...(items.length ? catalogFixtures(items) : []).filter(
      (row) => !local.catalogs.some((existing) => existing.id === row.id),
    ),
  ].map((row) =>
    row.kind === 'SKU'
      ? { ...row, itemCount: items.filter((item) => item.skuId === row.id).length }
      : row,
  );
  const catalogId = url.searchParams.get('id') || local.catalogId || local.categoryFilter;
  const selectedCatalog = dynamicCatalogs.find((row) => row.id === catalogId) || null;
  const dynamicLocations = local.locations.map((stored) => {
    const actual = items.find((item) => item.id === stored.id);
    const location = actual
      ? {
          ...stored,
          name: actual.name,
          parentId: actual.location.id,
          path: [...actual.location.path, actual.name],
          revision: actual.revision,
          recordState: actual.recordState,
        }
      : stored;
    return {
      ...location,
      contentCount: items.filter(
        (item) => !!item.location.id && hasAncestor(local.locations, item.location.id, location.id),
      ).length,
    };
  });
  const selectedLocation =
    dynamicLocations.find(
      (row) => row.id === local.locationId && (local.includeVoid || row.recordState === 'VALID'),
    ) || null;
  const skuFilter = url.searchParams.get('catalog');
  let filtered = items.filter(
    (row) =>
      (local.includeVoid || row.recordState === 'VALID') &&
      (!local.query || `${row.name} ${row.subtitle || ''} ${row.id}`.includes(local.query)) &&
      (!local.locationFilter ||
        row.location.id === local.locationFilter ||
        row.location.path
          .join('/')
          .startsWith(
            local.locations
              .find((location) => location.id === local.locationFilter)
              ?.path.join('/') + '/',
          )) &&
      (!local.categoryFilter ||
        dynamicCatalogs.some(
          (catalog) => catalog.id === row.skuId && catalog.parentId === local.categoryFilter,
        )) &&
      (!skuFilter || row.skuId === skuFilter),
  );
  if (local.sorting[0])
    filtered = [...filtered].sort(
      (a, b) => a.name.localeCompare(b.name, 'zh-CN') * (local.sorting[0].desc ? -1 : 1),
    );
  const pageSize = 6;
  const page =
    route === '/manage/bulk'
      ? Math.min(local.page, Math.max(0, Math.ceil(local.selectedIds.length / 10) - 1))
      : Math.min(local.page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const shown = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const selectedIds = state === 'session-changed' || state === 'forbidden' ? [] : local.selectedIds;
  const selection = {
    scope: isTrial() ? scope.householdId : householdId,
    ids: selectedIds,
    visibleIds: shown.map((row) => row.id),
    revisions: local.revisions,
    limit: 100,
    unavailableIds: selectedIds.filter((id) => !items.some((row) => row.id === id)),
  };
  const itemBinding = item
    ? local.attributeDraft && local.editId === item.id
      ? local.attributeDraft
      : local.bindings[item.id] === undefined
        ? bindingFromFacts(world.items.find((row) => row.item.id === item.id))
        : local.bindings[item.id]
    : null;
  useEffect(() => {
    if (route === '/manage/edit' && item && local.editId !== item.id)
      set((current) => ({
        ...current,
        editId: item.id,
        nameDraft: current.itemDrafts[item.id]?.nameDraft || {
          mode: 'unchanged',
          value: item.name,
        },
        attributeDraft:
          current.itemDrafts[item.id]?.attributeDraft ??
          (current.bindings[item.id] === undefined
            ? bindingFromFacts(world.items.find((row) => row.item.id === item.id))
            : current.bindings[item.id]),
        changedAttributes: current.itemDrafts[item.id]?.changedAttributes || [],
        conflict: null,
      }));
  }, [route, item?.id]);
  useEffect(() => {
    if (scenario === 'session-changed') {
      set((current) => ({
        ...current,
        selectedIds: [],
        revisions: {},
        task: null,
        retainedTask: null,
        nameDraft: { mode: 'unchanged', value: '' },
        attributeDraft: null,
        changedAttributes: [],
        feedback: '',
      }));
    }
  }, [scenario]);
  const historyTarget = url.searchParams.get('target') || local.historyTarget;
  const history = [
    ...local.extraHistory,
    ...world.history.map((entry) => ({
      ...entry,
      operationComplete:
        scenario !== 'partial-history' ||
        local.completedOperations.includes(entry.event!.operation_id),
    })),
  ].filter(
    (entry) =>
      !!entry.event &&
      (!local.historyEvent || entry.event.event_type === local.historyEvent) &&
      (!historyTarget || entry.event.target_id === historyTarget) &&
      (!local.historyOperation || entry.event.operation_id === local.historyOperation) &&
      (!local.historyFrom ||
        entry.event.recorded_at >= new Date(`${local.historyFrom}T00:00:00+08:00`).toISOString()) &&
      (!local.historyTo ||
        entry.event.recorded_at <
          new Date(
            new Date(`${local.historyTo}T00:00:00+08:00`).getTime() + 86400000,
          ).toISOString()),
  );
  const model: ManagementModel = {
    ...local,
    export: managementExportFixtureView(exportRecord),
    state,
    writeAvailability,
    items: shown,
    allItems: items,
    total: filtered.length,
    page,
    pageSize,
    selection,
    catalogs: dynamicCatalogs,
    catalogTree: tree(local.catalogs.filter((row) => row.kind === 'GROUP')),
    selectedCatalog,
    locations: dynamicLocations,
    locationTree: tree(
      dynamicLocations.filter((row) => local.includeVoid || row.recordState === 'VALID'),
    ),
    selectedLocation,
    item,
    itemCatalog: dynamicCatalogs.find((row) => row.id === item?.skuId) || null,
    lifecycle: itemBinding,
    lifecycleTemplate:
      itemBinding?.template_version === 1
        ? lifecycleTemplate
        : itemBinding?.template_version === 2
          ? {
              ...lifecycleTemplate,
              version: 2,
              paths: lifecycleTemplate.paths.filter((path) => path !== 'availability'),
              fields: lifecycleTemplate.fields,
            }
          : null,
    unknownBinding: scenario === 'unknown-template' ? unknownBinding : null,
    history: scenario === 'empty' ? [] : history,
    historyTarget,
  };
  function baseTask(kind: string, id?: string): ManagementTask {
    const targets = kind.startsWith('bulk-') ? selectedIds : id ? [id] : [];
    const snapshot = targets.flatMap((id) => {
      if (isCatalogManagementTask(kind)) {
        const catalog = local.catalogs.find((row) => row.id === id);
        return catalog
          ? [{ id, name: catalog.name, path: catalog.path.join(' › '), revision: catalog.revision }]
          : [];
      }
      const item = items.find((row) => row.id === id);
      return item
        ? [
            {
              id,
              name: item.name,
              path: item.location.path.join(' › ') || '位置未记录',
              revision: item.revision,
            },
          ]
        : [];
    });
    return {
      kind,
      title: '核对操作',
      description: '以下输入只在隔离预览中生效。',
      targetIds: [...targets],
      fields: [],
      impact: [],
      phase: 'draft',
      taskId: `management_${crypto.randomUUID()}`,
      returnPath: path,
      scopeGeneration: scope.generation,
      draft: {
        name: structuredClone(local.nameDraft),
        binding: structuredClone(itemBinding),
        changedAttributes: [...local.changedAttributes],
      },
      confirmLabel: '确认隔离预览',
      snapshot,
    };
  }
  function createTask(kind: string, id?: string) {
    if (kind === 'item-move' && local.locations.some((row) => row.id === (id || itemId)))
      kind = 'location-move';
    const targetItem = items.find((row) => row.id === (id || itemId));
    const catalog = dynamicCatalogs.find((row) => row.id === (id || selectedCatalog?.id));
    const location = dynamicLocations.find((row) => row.id === (id || selectedLocation?.id));
    const task = baseTask(kind, id);
    const stock = catalog?.attributes.find((binding) => binding.template_id === 'stock')?.values;
    const locationOptions = dynamicLocations
      .filter((row) => row.canContain && row.recordState === 'VALID')
      .map((row) => ({
        value: row.id,
        label: row.path.join(' › '),
        disabled: !!location && hasAncestor(dynamicLocations, row.id, location.id),
        description: '容器不能移动到自身或下级',
      }));
    const groups = local.catalogs
      .filter((row) => row.kind === 'GROUP')
      .map((row) => ({ value: row.id, label: row.path.join(' › ') }));
    if (kind === 'catalog-create-group' || catalog?.kind === 'GROUP')
      groups.unshift({ value: 'root', label: '根级分类（本次审批）' });
    const reason = field('reason', '操作原因', '', { required: true });
    const move = kind === 'item-move' || kind === 'bulk-move' || kind === 'location-move';
    if (move) {
      task.title = kind === 'location-move' ? '移动容器' : `移动 ${task.targetIds.length} 件物品`;
      task.fields = [
        field('destination', '目标物理位置', '', {
          required: true,
          options: [{ value: 'root', label: '未指定位置（根级）' }, ...locationOptions],
        }),
      ];
      task.description = '改变物理位置。容器的子内容保持原归属，完整路径随容器更新。';
    } else if (kind === 'item-save') {
      task.title = '核对此件名称';
      task.fields = [];
      task.impact = [
        {
          label: '此件显示名称',
          before: targetItem?.name || '未知',
          after:
            local.nameDraft.mode === 'clear'
              ? dynamicCatalogs.find((row) => row.id === targetItem?.skuId)?.name || '商品名称'
              : local.nameDraft.value || '空文本',
        },
      ];
    } else if (kind === 'attribute-save') {
      task.title = '核对生命周期属性';
      task.impact = local.changedAttributes.map((path) => ({
        label: path,
        before: describe(
          atPath(
            (
              local.bindings[itemId] ||
              bindingFromFacts(world.items.find((row) => row.item.id === itemId))
            ).values,
            path,
          ),
        ),
        after: describe(itemBinding ? atPath(itemBinding.values, path) : undefined),
      }));
      task.description = `仅此物品，绑定版本 ${itemBinding?.template_version}。未改字段和无法识别字段完整保留。`;
    } else if (kind.startsWith('catalog-') || kind === 'stock') {
      task.title =
        kind === 'catalog-create-sku'
          ? '新建商品资料'
          : kind === 'catalog-create-group'
            ? '新建分类'
            : kind === 'catalog-move'
              ? '移动分类归属'
              : kind === 'catalog-void'
                ? '作废无引用商品'
                : kind === 'stock'
                  ? '商品补货策略'
                  : '编辑共享资料';
      task.description =
        kind === 'stock'
          ? '只设定补货策略，不创建库存。'
          : '修改商品共享资料与分类路径，不改变实物存放位置。';
      if (kind === 'stock')
        task.fields = [
          field('mode', '策略依据', String(stock?.basis || 'COUNT'), {
            options: [
              { value: 'COUNT', label: '具体件数 COUNT' },
              { value: 'CONTENT', label: '内容数量 CONTENT' },
            ],
          }),
          field('unit', '单位', String(stock?.content_unit || 'count'), { required: true }),
          field('threshold', '低于此数提醒', String(stock?.reorder_threshold || '1'), {
            required: true,
            type: 'number',
          }),
          field('target', '补到目标', String(stock?.target || '3'), {
            required: true,
            type: 'number',
          }),
        ];
      else if (kind === 'catalog-void') {
        task.fields = [reason];
        if (catalog?.itemCount !== 0)
          task.blockedReason = '当前商品仍有实物引用或引用数未知，不能作废。';
      } else {
        task.fields = [
          ...(kind === 'catalog-move'
            ? []
            : [
                field(
                  'name',
                  kind === 'catalog-create-group' ? '分类名称' : '名称',
                  catalog?.name || '',
                  { required: true },
                ),
              ]),
          ...(kind === 'catalog-edit'
            ? []
            : [
                field(
                  'parent',
                  '所属分类',
                  catalog?.parentId ||
                    local.categoryFilter ||
                    (kind === 'catalog-create-group' ? 'root' : groups[0]?.value || ''),
                  {
                    required: true,
                    options: groups.filter(
                      (row) =>
                        row.value !== catalog?.id &&
                        !(catalog && hasAncestor(local.catalogs, row.value, catalog.id)),
                    ),
                  },
                ),
              ]),
          ...(kind === 'catalog-move' ||
          kind === 'catalog-create-group' ||
          catalog?.kind === 'GROUP'
            ? []
            : [
                field('profile', '资料类型', catalog?.profile || 'unknown', {
                  options: [
                    { value: 'unknown', label: '未设置（保持未知）' },
                    { value: 'CONSUMABLE', label: '消耗品' },
                    { value: 'DURABLE', label: '耐用品' },
                  ],
                }),
              ]),
        ];
      }
      if (kind === 'catalog-create-sku' && !groups.length)
        task.blockedReason = '尚无可选分类，请先建立分类；不隐式推断商品归属。';
      task.approval = {
        proposalId: `preview-proposal-${kind}`,
        householdLabel: '梧桐之家 · 隔离预览',
        scope: 'THIS_OPERATION_ONLY',
        policyRevision: 1,
        expiresAtLabel: '仅当前输入与当前版本',
        validity: 'valid',
        status: 'awaiting',
        impact: ['具体提案尚待核对'],
        summary: '隔离审批样例，仅覆盖本次原键、参数和版本；不是后台有效审批。',
      };
    } else if (kind.startsWith('location-')) {
      task.title =
        kind === 'location-create'
          ? '新建位置'
          : kind === 'location-edit'
            ? '编辑此容器'
            : kind === 'location-restore'
              ? '恢复作废容器'
              : '作废误建位置';
      if (kind === 'location-create')
        task.fields = [
          field('name', '位置名称', '', { required: true }),
          field('destination', '上级物理位置', 'root', {
            options: [{ value: 'root', label: '根级位置' }, ...locationOptions],
          }),
        ];
      else if (kind === 'location-edit')
        task.fields = [field('name', '容器名称', location?.name || '', { required: true })];
      else task.fields = [reason];
      task.description = '位置使用合法容器商品，通过单件实物命令创建或编辑，不用目录分类代替位置。';
      if (
        kind === 'location-create' &&
        !dynamicCatalogs.some((row) => row.id === containerCatalog.id)
      )
        task.blockedReason = '当前缺少容器商品定义。保留此任务，先到商品目录建立合法容器商品。';
      if (kind === 'location-void' && location?.contentCount !== 0)
        task.blockedReason = '此容器仍有内容或内容数量未知，不能作废。';
    } else if (kind === 'void' || kind === 'restore') {
      task.title = kind === 'void' ? '作废误建记录' : '恢复作废记录';
      task.fields = [reason];
      task.description =
        kind === 'void'
          ? '仅用于误建。记录将从默认列表隐藏，不代表已用完或真实处置。'
          : '通过有原因的纠正操作恢复有效记录，不改变消耗或处置终态。';
    } else if (kind === 'dispose') {
      task.title = '记录处置';
      task.fields = [
        field('disposition', '处置方式', 'GIFT', {
          options: [
            { value: 'GIFT', label: '赠送' },
            { value: 'SALE', label: '售出' },
            { value: 'DONATION', label: '捐赠' },
            { value: 'RETURN', label: '退回' },
            { value: 'DISCARD', label: '丢弃' },
          ],
        }),
        field('date', '处置日期', '', { required: true, type: 'date' }),
        field('recipient', '接收方姓名（可选）'),
        field('note', '备注（可选）'),
      ];
      task.description = '处置是终态事实，不会提供自动恢复为使用中的操作。';
    } else if (kind === 'split') {
      task.title = '拆包 · 守恒核对';
      task.fields = [
        field('sku', '子件目标商品', targetItem?.skuId || '', {
          required: true,
          options: dynamicCatalogs
            .filter((row) => row.kind === 'SKU' && row.recordState === 'VALID')
            .map((row) => ({ value: row.id, label: row.path.join(' › ') })),
        }),
        field('count', '子件数（1–100）', '2', { required: true, type: 'number' }),
        field('quantity', '每件内容数量', '', { required: true }),
        field('unit', '内容单位', 'mL', { required: true }),
      ];
      task.description = '源件将结束，子件拥有各自身份。拆分来源不会写成物理父级。';
      const facts = world.items.find((row) => row.item.id === targetItem?.id);
      task.blockedReason =
        facts?.quantity.value === null
          ? '源件内容数量未知，无法验证守恒；先补充真实数量。'
          : undefined;
    } else if (kind === 'reference') {
      task.title = '关联已有引用';
      task.fields = [
        field('reference', '当前家庭的可访问引用', '', {
          required: true,
          options: [
            { value: 'actor_00000000-0000-4000-8000-000000000001', label: '成员 · 小林（ACTOR）' },
            ...items
              .filter((row) => row.id !== targetItem?.id)
              .slice(0, 3)
              .map((row) => ({
                value: row.id,
                label: `物品 · ${row.name} · ${row.location.path.join(' › ')}（ITEM）`,
              })),
          ],
        }),
      ];
      task.description = '只修改模板允许的引用字段；不展开敏感信息。';
      task.blockedReason =
        '此件当前没有可编辑的引用模板绑定。请先添加适用模板；不会写入任意 JSON 字段。';
    } else if (kind.startsWith('template-')) {
      task.title =
        kind === 'template-upgrade'
          ? '升级生命周期模板'
          : kind === 'template-remove'
            ? '移除生命周期绑定'
            : '添加模板';
      task.fields = kind === 'template-remove' ? [reason] : [];
      task.description =
        kind === 'template-upgrade'
          ? '目标版本 2：保留开封、日期、取得与成色；移除旧 availability 字段，使用新的派生可用性。无新增字段，提交完整目标值。'
          : kind === 'template-remove'
            ? '移除绑定将使生命周期字段不再作为当前属性展示；历史不删除。'
            : '适用目标 ITEM；同一模板不得重复绑定。';
      if (kind === 'template-upgrade' && itemBinding?.template_version !== 1)
        task.blockedReason = '当前绑定已是版本 2，没有更高可用版本。';
      if (kind === 'template-add' && itemBinding)
        task.blockedReason = '当前已绑定 lifecycle，请使用修改或升级；不能重复添加。';
    } else if (kind === 'bulk-consume') {
      task.title = '整件用完';
      task.description = '此批次全量结束所选具体物品，一次请求为原子事务。';
      const eligible = items.filter(
        (row) =>
          selectedIds.includes(row.id) &&
          row.profile === 'CONSUMABLE' &&
          row.recordState === 'VALID' &&
          row.status.label !== '已用完',
      );
      if (eligible.length !== selectedIds.length)
        task.blockedReason = `可执行 ${eligible.length} / 已选 ${selectedIds.length}；非消耗品、已结束或作废对象不适用，请明确缩小范围。`;
    } else if (kind === 'bulk-lifecycle') {
      task.title = '批量生命周期字段';
      task.fields = [
        field('mode', '取得日期修改方式', 'unchanged', {
          options: [
            { value: 'unchanged', label: '多个值 · 保持未改' },
            { value: 'set', label: '设置共同日期' },
            { value: 'clear', label: '明确清空日期' },
          ],
        }),
        field('date', '共同取得日期', '', { type: 'date' }),
      ];
      task.description =
        '每件使用捕获的绑定版本，仅设置或清空明确选择的字段。多个值不会自动写为空。';
    } else if (kind === 'reassign') {
      task.title = '纠正商品关联';
      task.fields = [
        field('sku', '正确的商品资料', '', {
          required: true,
          options: dynamicCatalogs
            .filter((row) => row.kind === 'SKU')
            .map((row) => ({ value: row.id, label: row.path.join(' › ') })),
        }),
        reason,
      ];
      task.description = '通过纠正命令修改 catalog_node_id；名称变化不会迁移身份。';
      task.approval = {
        proposalId: 'preview-reassign',
        householdLabel: '梧桐之家 · 隔离预览',
        scope: 'THIS_OPERATION_ONLY',
        policyRevision: 1,
        expiresAtLabel: '仅当前对象、版本和输入',
        validity: 'valid',
        status: 'awaiting',
        impact: ['商品关联将改变'],
        summary: '重新归属商品需目录审批。',
      };
    } else if (kind === 'history-correct') {
      task.title = '追加纠正记录';
      task.fields = [
        field('name', '当前物品名称的正确值', targetItem?.name || '', { required: true }),
        reason,
      ];
      task.description = `已读取当前物品版本 ${targetItem?.revision ?? '未知'}。保留原输入和原因。`;
      task.blockedReason =
        '当前 correct_item 契约不能修改显示名称，不能以普通编辑冒充历史纠正。请通过精确编辑修改名称；原因不会被虚构为纠正事件。';
      if (!targetItem) task.blockedReason = '对象已不可访问，不能从旧历史恢复其资料。';
    }
    if (
      kind.startsWith('bulk-') &&
      task.snapshot.some((row) => local.revisions[row.id] !== row.revision)
    )
      task.blockedReason = '所选物品版本已变化。先重新读取选择版本并核对，整个批次尚未执行。';
    if (task.targetIds.length > 100)
      task.blockedReason = '单次最多 100 件，需明确拆分任务，不会后台分批。';
    if (!available)
      task.blockedReason =
        writeAvailability.kind === 'available' ? undefined : writeAvailability.reason;
    task.impact = impactFor(task);
    set((current) => ({ ...current, task, feedback: '' }));
  }
  function impactFor(task: ManagementTask): ManagementTask['impact'] {
    const v = withValues(task);
    const item = items.find((row) => row.id === task.targetIds[0]);
    const cat = dynamicCatalogs.find((row) => row.id === task.targetIds[0]);
    const loc = local.locations.find((row) => row.id === task.targetIds[0]);
    if (task.kind === 'item-save' || task.kind === 'attribute-save') return task.impact;
    if (task.kind.includes('move'))
      return [
        {
          label: task.kind === 'catalog-move' ? '分类路径（实际位置不变）' : '物理路径',
          before:
            cat?.path.join(' › ') ||
            loc?.path.join(' › ') ||
            item?.location.path.join(' › ') ||
            '多个位置',
          after:
            task.kind === 'catalog-move'
              ? `${local.catalogs.find((row) => row.id === v.parent)?.path.join(' › ') || '待选择'} › ${cat?.name || ''}`
              : local.locations.find((row) => row.id === v.destination)?.path.join(' › ') ||
                (v.destination === 'root' ? '未指定位置' : '待选择'),
        },
        {
          label: '影响对象',
          before: `${task.targetIds.length} 个目标`,
          after: loc
            ? `容器及下级物理路径更新；${loc.contentCount ?? '未知'} 件内容保持归属`
            : '仅核对清单中的完整身份',
        },
      ];
    if (task.kind === 'stock')
      return [
        {
          label: '补货策略',
          before: '未设置或当前策略',
          after: `${v.mode} · 低于 ${v.threshold} ${v.unit} 提醒，目标 ${v.target} ${v.unit}`,
        },
        {
          label: '实物库存',
          before: `${cat?.itemCount ?? '未知'} 件`,
          after: '保持不变，不创建库存',
        },
      ];
    if (task.kind.startsWith('catalog-'))
      return [
        {
          label: cat?.kind === 'GROUP' ? '分类资料' : '商品资料',
          before: cat?.name || '尚未建立',
          after: v.name || '作废记录',
        },
        {
          label: '共享范围',
          before:
            cat?.itemCount === null ? '范围已知，数量待读取' : `${cat?.itemCount ?? 0} 件引用`,
          after: task.kind.startsWith('catalog-create')
            ? '只建立资料，库存不会增加'
            : '这款商品及引用资料的实物；物理位置不变',
        },
        {
          label: '资料类型 / 能力',
          before: cat?.profile || '未设置',
          after: `${v.profile || cat?.profile || '未设置'}；显式 override 保留，原绑定不自动删除`,
        },
      ];
    if (task.kind === 'split') {
      const fact = world.items.find((row) => row.item.id === item?.id);
      return [
        {
          label: '源件内容',
          before: `${fact?.quantity.value ?? '未知'} ${fact?.quantity.unit || ''}`,
          after: '源件结束',
        },
        {
          label: '子件独立身份',
          before: '0 件',
          after: `${v.count} 件 × ${v.quantity || '待填写'} ${v.unit}，总量必须与源件一致`,
        },
      ];
    }
    if (task.kind.startsWith('template-'))
      return [
        {
          label: '模板绑定',
          before: `lifecycle · 版本 ${itemBinding?.template_version || '未绑定'}`,
          after:
            task.kind === 'template-remove'
              ? '移除此绑定；历史保留'
              : task.kind === 'template-upgrade'
                ? '版本 2 · 明确移除 availability，保留其余原字段；无新增'
                : '版本 1 · 不复制其他物品事实',
        },
      ];
    if (task.kind.startsWith('location-'))
      return [
        {
          label: '容器',
          before: loc?.path.join(' › ') || '尚未建立',
          after:
            v.name || (task.kind === 'location-restore' ? '恢复为有效记录' : '从默认位置列表隐藏'),
        },
        {
          label: '容器商品',
          before: containerCatalog.name,
          after: '通过容器 Item 的真实身份创建或更新',
        },
      ];
    if (task.kind === 'bulk-lifecycle')
      return [
        {
          label: '取得日期',
          before: '多个值（每件独立绑定版本）',
          after:
            v.mode === 'set'
              ? v.date || '日期待填写'
              : v.mode === 'clear'
                ? '明确清空'
                : '保持未改',
        },
      ];
    if (task.kind === 'reassign')
      return [
        {
          label: '关联商品',
          before: dynamicCatalogs.find((row) => row.id === item?.skuId)?.name || '未知',
          after: dynamicCatalogs.find((row) => row.id === v.sku)?.name || '待选择',
        },
      ];
    if (task.kind === 'history-correct')
      return [
        {
          label: '当前实物名称',
          before: item?.name || '当前对象不可访问',
          after: v.name || '待填写',
        },
        { label: '历史事件', before: '既有事件', after: '保留原事件，追加带原因的纠正' },
      ];
    return [
      {
        label: '记录状态',
        before: item?.recordState === 'VOID' ? '已作废' : item?.status.label || '当前有效实物',
        after:
          task.kind === 'void'
            ? '作废并从默认结果隐藏'
            : task.kind === 'restore'
              ? '有效记录；生命周期保持原样'
              : task.kind === 'bulk-consume'
                ? '整件用完'
                : task.kind === 'dispose'
                  ? `已处置 · ${v.disposition} · ${v.date || '日期待填写'}`
                  : '按所选引用更新合法字段',
      },
    ];
  }
  function validate(task: ManagementTask): string | null {
    const values = withValues(task);
    for (const f of task.fields) if (f.required && !f.value.trim()) return `请填写${f.label}。`;
    if (
      task.kind === 'item-save' &&
      (task.draft?.name || local.nameDraft).mode === 'set' &&
      !(task.draft?.name || local.nameDraft).value.trim()
    )
      return '名称不能为空；需要清除覆盖时请选择“清除”。';
    if (
      task.kind === 'bulk-lifecycle' &&
      (values.mode === 'unchanged' || (values.mode === 'set' && !values.date))
    )
      return '请选择明确的设值或清空；设值需要日期。';
    if (task.kind === 'stock' && vIgnored(values))
      return '内容策略须选择 mL、L、g、kg 或 count 单位；件数策略使用 count。';
    if (
      task.kind === 'stock' &&
      (!/^\d+(\.\d+)?$/.test(values.threshold) ||
        !/^\d+(\.\d+)?$/.test(values.target) ||
        Number(values.target) < Number(values.threshold))
    )
      return '阈值与目标须为非负数，目标不能低于阈值。';
    if (task.kind === 'split') {
      const facts = world.items.find((row) => row.item.id === task.targetIds[0]);
      const count = Number(values.count);
      if (!Number.isInteger(count) || count < 1 || count > 100)
        return '子件数必须为 1–100 的整数。';
      if (!/^\d+(\.\d+)?$/.test(values.quantity) || Number(values.quantity) <= 0)
        return '每件数量必须为正十进制数。';
      if (values.unit !== facts?.quantity.unit) return '单位不一致，不能隐式换算。';
      const toInt = (text: string, scale: number) =>
        BigInt(text.replace('.', '') + '0'.repeat(scale - (text.split('.')[1]?.length || 0)));
      const a = facts?.quantity.value;
      if (a === null || a === undefined) return '源件数量未知，不能确认守恒。';
      const scale = Math.max(
        a.split('.')[1]?.length || 0,
        values.quantity.split('.')[1]?.length || 0,
      );
      if (toInt(a, scale) !== toInt(values.quantity, scale) * BigInt(count))
        return 'SPLIT_NOT_CONSERVED：源件数量与全部子件数量不相等。';
    }
    if (
      task.kind === 'location-move' &&
      values.destination !== 'root' &&
      hasAncestor(dynamicLocations, values.destination, task.targetIds[0])
    )
      return '不能把容器移动到自身或下级；原结构未变化。';
    if (
      task.kind === 'bulk-move' &&
      task.targetIds.some((id) => local.locations.some((row) => row.id === id))
    )
      return '所选范围含容器，请逐件通过“移动容器”核对子内容影响。';
    if (task.kind === 'catalog-move' || task.kind === 'catalog-edit') {
      const target = local.catalogs.find((row) => row.id === task.targetIds[0]);
      const parent = local.catalogs.find((row) => row.id === values.parent);
      if (target?.kind === 'GROUP' && parent && hasAncestor(local.catalogs, parent.id, target.id))
        return '分类不能归属自身或下级。';
    }
    for (const snapshot of task.snapshot) {
      const current = isCatalogManagementTask(task.kind)
        ? dynamicCatalogs.find((row) => row.id === snapshot.id)
        : items.find((item) => item.id === snapshot.id);
      if (!current || current.revision !== snapshot.revision)
        return '对象版本已变化或不可访问。整个批次未执行，请重新核对最新资料。';
    }
    return null;
  }
  function onChange(key: string, value: unknown) {
    if (operation?.getSnapshot().state === 'revisionConflict' && !key.startsWith('conflict.'))
      return;
    if (localRef.current.task?.phase === 'submitting' || localRef.current.task?.phase === 'unknown')
      return;
    if (key.startsWith('task.')) {
      set((current) => {
        if (!current.task) return current;
        const task = {
          ...current.task,
          phase: 'draft' as const,
          error: undefined,
          fields: current.task.fields.map((f) =>
            f.key === key.slice(5) ? { ...f, value: String(value) } : f,
          ),
          approval: current.task.approval
            ? { ...current.task.approval, status: 'awaiting' as const }
            : undefined,
        };
        return { ...current, task: { ...task, impact: impactFor(task) } };
      });
      return;
    }
    if (key.startsWith('conflict.')) {
      set((current) => ({
        ...current,
        conflict: current.conflict
          ? {
              ...current.conflict,
              choices: {
                ...current.conflict.choices,
                [key.slice(9)]: value as 'current' | 'input',
              },
            }
          : null,
      }));
      return;
    }
    if (key === 'selection') {
      const ids = [...new Set(value as string[])];
      if (ids.length > 100) {
        set((current) => ({
          ...current,
          feedback: '最多选择 100 件；本次新增选择未加入。可以取消已有选择后继续。',
        }));
        return;
      }
      set((current) => ({
        ...current,
        selectedIds: ids,
        revisions: Object.fromEntries(
          ids.map((id) => [
            id,
            current.selectedIds.includes(id)
              ? (current.revisions[id] ?? 0)
              : (items.find((row) => row.id === id)?.revision ?? 0),
          ]),
        ),
        feedback: '',
      }));
      return;
    }
    if (key === 'selectedCatalog') {
      set((current) => ({ ...current, catalogId: value as string | null }));
      if (url.searchParams.has('id')) go('/manage/catalog');
      return;
    }
    if (key === 'selectedLocation') {
      set((current) => ({ ...current, locationId: String(value) }));
      return;
    }
    if (key === 'nameMode' || key === 'nameValue') {
      set((current) => {
        const nameDraft = { ...current.nameDraft, [key === 'nameMode' ? 'mode' : 'value']: value };
        const active =
          operation && operation.getSnapshot().state !== 'success' ? current.task : null;
        const task =
          active?.kind === 'item-save' && active.targetIds[0] === itemId && active.draft
            ? {
                ...active,
                phase: 'draft' as const,
                draft: { ...active.draft, name: nameDraft },
                impact: [
                  {
                    label: '此件显示名称',
                    before: item?.name || '未知',
                    after:
                      nameDraft.mode === 'clear'
                        ? dynamicCatalogs.find((row) => row.id === item?.skuId)?.name ||
                          '商品名称未读取'
                        : nameDraft.value,
                  },
                ],
              }
            : active;
        return { ...current, nameDraft, task };
      });
      return;
    }
    set((current) => ({
      ...current,
      [key]: value,
      ...(['query', 'categoryFilter', 'locationFilter', 'sorting', 'includeVoid'].includes(key)
        ? { page: 0 }
        : {}),
      ...(key === 'categoryFilter' ? { catalogId: value as string | null } : {}),
    }));
  }
  function onAttributeChange(edit: AttributeFieldEdit) {
    if (
      edit.kind !== 'value' ||
      !itemBinding ||
      operation?.getSnapshot().state === 'revisionConflict' ||
      localRef.current.task?.phase === 'unknown' ||
      localRef.current.task?.phase === 'submitting'
    )
      return;
    set((current) => {
      const attributeDraft = {
        ...itemBinding,
        values: patchAt(
          itemBinding.values,
          edit.path,
          edit.value === null ? undefined : edit.value,
        ),
      };
      const changedAttributes = [...new Set([...current.changedAttributes, edit.path])];
      const active = operation && operation.getSnapshot().state !== 'success' ? current.task : null;
      const task =
        active?.kind === 'attribute-save' && active.targetIds[0] === itemId && active.draft
          ? {
              ...active,
              phase: 'draft' as const,
              draft: { ...active.draft, binding: attributeDraft, changedAttributes },
              impact: changedAttributes.map((path) => ({
                label: path,
                before: describe(
                  atPath(operation!.getSnapshot().original.task.draft?.binding?.values || {}, path),
                ),
                after: describe(atPath(attributeDraft.values, path)),
              })),
            }
          : active;
      return { ...current, attributeDraft, changedAttributes, task };
    });
  }
  async function onIntent(kind: string, id?: string) {
    if (localRef.current.task?.phase === 'submitting' || exportRecord?.state === 'submitting')
      return;
    if (
      operation &&
      ['networkUnknown', 'sessionChanged', 'revisionConflict'].includes(
        operation.getSnapshot().state,
      ) &&
      [
        'refresh-selection',
        'bulk-only-eligible',
        'review-task',
        'approve-task',
        'revise-task',
      ].includes(kind)
    ) {
      set((current) => ({
        ...current,
        feedback: '请先恢复或核对原任务；原输入和选择版本已保留。',
      }));
      return;
    }
    if (kind === 'approve-task' && !available) return;
    if (kind === 'recover-task' && operation) {
      await operation.recover((attempt) =>
        executeManagementFixtureAttempt(
          operation.getSnapshot().scope,
          attempt,
          scopeKey,
          scenario,
          true,
        ),
      );
      return;
    }
    if (kind === 'recover-task') {
      const pending = localRef.current.task;
      if (!pending?.taskId) return;
      const known =
        localRef.current.receipts[pending.taskId] ||
        (getReviewWorld().receipts[pending.taskId]
          ? '已找到原任务回执，相关物品已更新；没有再次提交。'
          : null);
      set((current) => ({
        ...current,
        task: {
          ...pending,
          phase: known ? 'receipt' : 'unknown',
          receipt: known || undefined,
          error: known
            ? undefined
            : '尚未找到原任务回执。原请求保留，请核对原作用域与存储状态；不会重新执行。',
        },
      }));
      return;
    }
    if (kind === 'retry-storage') {
      set((current) => ({ ...current, storageError: '', feedback: '' }));
      return;
    }
    if (kind === 'retry') {
      set((current) => ({ ...current, recovered: true, feedback: '已重新读取隔离样例范围。' }));
      return;
    }
    if (kind === 'bulk') {
      set((current) => ({ ...current, page: 0 }));
      go('/manage/bulk');
      return;
    }
    if (kind === 'refresh-selection') {
      set((current) => ({
        ...current,
        revisions: Object.fromEntries(
          current.selectedIds.map((id) => [id, items.find((row) => row.id === id)?.revision || 0]),
        ),
        task: null,
        feedback: '已重新读取选择版本；请核对清单，再选择批量操作。',
      }));
      return;
    }
    if (kind === 'bulk-only-eligible') {
      onChange(
        'selection',
        items
          .filter(
            (row) =>
              selectedIds.includes(row.id) &&
              row.profile === 'CONSUMABLE' &&
              row.recordState === 'VALID' &&
              row.status.label !== '已用完',
          )
          .map((row) => row.id),
      );
      set((current) => ({
        ...current,
        task: null,
        feedback: '已明确重建可执行选择范围，请重新核对。',
      }));
      return;
    }
    if (kind === 'close-task') {
      if (operation && !(await operation.retain())) return;
      set((current) => ({
        ...current,
        retainedTask: current.task?.phase === 'receipt' ? null : current.task,
        task: null,
      }));
      return;
    }
    if (
      kind === 'export' ||
      kind === 'export-next' ||
      kind === 'export-cancel' ||
      kind === 'export-recover'
    ) {
      if (!available) return;
      try {
        if (kind === 'export') {
          const label = `隔离物品冻结：${local.query || '全部名称'} · ${local.includeVoid ? '含作废' : '有效记录'} · 无敏感原文`;
          const selection: BeginExport = {
            kind: 'ITEM',
            include_sensitive: false,
            query: {
              include_void: local.includeVoid,
              include_terminal: true,
              include_path: true,
              sort: { field: 'name', direction: local.sorting[0]?.desc ? 'desc' : 'asc' },
              ...(local.query ? { search: local.query } : {}),
              ...(skuFilter
                ? { catalog_node_ids: [skuFilter] }
                : local.categoryFilter
                  ? { catalog_subtree_id: local.categoryFilter }
                  : {}),
              ...(local.locationFilter ? { within_item_id: local.locationFilter } : {}),
            },
          };
          const taskId = `management-export:${crypto.randomUUID()}`;
          const session = sessions.get(getFixtureScope(), taskId, () =>
            createManagementExportFixtureSession(taskId, selection, label),
          );
          if (
            !set((current) => ({
              ...current,
              exportSession: { taskId, selection, label },
              feedback: '',
            }))
          )
            return;
          await runManagementExportStep(session, 'begin', managementFixtureExportPort);
        } else if (exportSession) {
          if (kind === 'export-recover')
            await recoverManagementExportStep(exportSession, managementFixtureExportPort);
          else
            await runManagementExportStep(
              exportSession,
              kind === 'export-next' ? 'read' : 'cancel',
              managementFixtureExportPort,
            );
        }
      } catch (error) {
        set((current) => ({ ...current, feedback: String(error) }));
      }
      return;
    }
    if (kind === 'history-clear') {
      set((current) => ({
        ...current,
        historyEvent: '',
        historyOperation: '',
        historyTarget: '',
        historyFrom: '',
        historyTo: '',
      }));
      go('/manage/history');
      return;
    }
    if (kind === 'history-complete') {
      set((current) => ({
        ...current,
        completedOperations: [...current.completedOperations, id!],
        historyOperation: id!,
        feedback: '已按此操作 ID 读取隔离样例中的全部事件。',
      }));
      return;
    }
    if (kind === 'review-task' || kind === 'approve-task' || kind === 'revise-task') {
      set((current) => {
        if (!current.task) return current;
        const error = validate(current.task);
        const task = {
          ...current.task,
          phase: kind === 'revise-task' ? ('draft' as const) : ('review' as const),
          impact: impactFor(current.task),
          error: error || undefined,
        };
        if (task.approval)
          task.approval = {
            ...task.approval,
            status: kind === 'approve-task' && !error ? 'approved' : 'awaiting',
            impact: task.impact.map((row) => `${row.label}：${row.before} → ${row.after}`),
          };
        return { ...current, task };
      });
      return;
    }
    if (kind === 'refresh-conflict') {
      set((current) => ({ ...current, feedback: '已重读隔离预览中的最新版本，请逐字段核对。' }));
      return;
    }
    if (kind === 'resolve-conflict' && operation?.getSnapshot().state === 'revisionConflict') {
      const record = operation.getSnapshot();
      const catalogTask = isCatalogManagementTask(record.draft.task.kind);
      const snapshots = record.draft.task.targetIds.map((id) =>
        catalogTask
          ? dynamicCatalogs.find((row) => row.id === id)
          : items.find((row) => row.id === id),
      );
      if (snapshots.some((row) => !row)) return;
      const snapshot = snapshots.map((row) => ({
        id: row!.id,
        name: row!.name,
        path: ('location' in row! ? row!.location.path : row!.path).join(' › ') || '位置未记录',
        revision: row!.revision,
      }));
      const task = {
        ...record.draft.task,
        snapshot,
        phase: 'draft' as const,
        error: undefined,
        approval: record.draft.task.approval
          ? { ...record.draft.task.approval, status: 'awaiting' as const }
          : undefined,
      };
      task.impact = impactFor(task);
      if (task.kind === 'item-save')
        task.impact = [
          {
            label: '此件显示名称',
            before: snapshots[0]!.name,
            after:
              task.draft?.name.mode === 'clear'
                ? dynamicCatalogs.find(
                    (row) => row.id === items.find((item) => item.id === snapshots[0]!.id)?.skuId,
                  )?.name || '商品名称未读取'
                : task.draft?.name.value || '',
          },
        ];
      const bindings = Object.fromEntries(
        task.targetIds.map((id) => [
          id,
          local.bindings[id] === undefined
            ? bindingFromFacts(world.items.find((row) => row.item.id === id))
            : local.bindings[id],
        ]),
      );
      const draft = {
        ...record.draft,
        task,
        bindings,
        requestKey: crypto.randomUUID(),
        catalog: catalogTask
          ? dynamicCatalogs.find((row) => row.id === task.targetIds[0]) || null
          : record.draft.catalog,
        approvalReference: undefined,
      };
      const original = {
        ...draft,
        task: {
          ...task,
          draft: task.draft
            ? {
                ...task.draft,
                name: { mode: 'unchanged' as const, value: snapshots[0]!.name },
                binding: bindings[task.targetIds[0]],
                changedAttributes: [],
              }
            : undefined,
        },
      };
      await operation.reconcile(
        draft,
        Object.fromEntries(snapshot.map((row) => [row.id, row.revision])),
        original,
      );
      set((current) => ({
        ...current,
        task: managementTaskView(operation.getSnapshot()),
        conflict: null,
        recovered: true,
        feedback: '已读取最新版本并保留输入，请再次核对后提交。',
      }));
      return;
    }
    if (kind === 'resolve-conflict') {
      set((current) => ({
        ...current,
        nameDraft: {
          ...current.nameDraft,
          value:
            current.conflict?.choices.name === 'current'
              ? item?.name || ''
              : current.nameDraft.value,
        },
        conflict: null,
        task: null,
        recovered: true,
        feedback: '已形成新的修改意图；请重新打开核对并提交。',
      }));
      return;
    }
    if (kind !== 'submit-task') {
      if (operation && operation.getSnapshot().state !== 'success') {
        set((current) => ({
          ...current,
          feedback: '请先继续、核对或完成保留的管理任务，未替换原任务。',
        }));
        return;
      }
      if (localRef.current.task?.phase === 'unknown') {
        set((current) => ({ ...current, feedback: '请先保留或核对原任务，再开始另一项操作。' }));
        return;
      }
      createTask(kind, id);
      return;
    }
    const task = localRef.current.task;
    if (
      !task ||
      task.phase === 'receipt' ||
      task.phase === 'unknown' ||
      task.phase === 'submitting' ||
      task.blockedReason ||
      !available
    )
      return;
    const error = validate(task);
    if (error) {
      if (
        isSharedManagementTask(task) &&
        task.snapshot.some(
          (row) =>
            (isCatalogManagementTask(task.kind)
              ? dynamicCatalogs.find((entry) => entry.id === row.id)
              : items.find((item) => item.id === row.id)
            )?.revision !== row.revision,
        )
      ) {
        await sessionFor(task).update({ state: 'revisionConflict', error });
        return;
      }
      set((current) => ({ ...current, task: { ...task, error } }));
      return;
    }
    if (task.approval?.status === 'awaiting') {
      set((current) => ({ ...current, task: { ...task, error: '请先核对并批准本次具体提案。' } }));
      return;
    }
    if (
      scenario === 'conflict' &&
      !local.conflict &&
      !local.recovered &&
      task.kind === 'item-save' &&
      !isSharedManagementTask(task)
    ) {
      set((current) => ({
        ...current,
        conflict: {
          objectId: itemId,
          scopeLabel: '仅此实物 · 隔离冲突样例',
          originalRevision: item?.revision || 1,
          currentRevision: (item?.revision || 1) + 1,
          fields: [
            {
              key: 'name',
              label: '显示名称',
              original: { kind: 'known', text: item?.name || '' },
              current: { kind: 'known', text: `${item?.name}（已更新）` },
              input: { kind: 'known', text: local.nameDraft.value },
            },
          ],
          choices: {},
          availability: writeAvailability,
        },
        task: null,
      }));
      return;
    }
    if (isSharedManagementTask(task)) {
      const session = sessionFor(task);
      try {
        if (scenario === 'conflict' && !local.recovered && task.kind === 'item-save') {
          await session.update({
            state: 'revisionConflict',
            error: '隔离冲突样例：请核对当前资料后保留输入。',
          });
          return;
        }
        const record = session.getSnapshot();
        const attempt = record.attempt || freezeManagementAttempt(record.draft, record.revisions);
        await session.submit(attempt, (frozen) =>
          executeManagementFixtureAttempt(record.scope, frozen, scopeKey, scenario),
        );
      } catch (error) {
        await session.update({ state: 'validationError', error: String(error) });
      }
      return;
    }
    set((current) => ({ ...current, feedback: '此任务尚未有可用命令映射，原草稿保留。' }));
  }

  const go = async (next: string) => {
    if (localRef.current.task?.phase === 'submitting' || exportRecord?.state === 'submitting')
      return;
    if (operation && !(await operation.retain())) return;
    if (exportSession && !(await exportSession.retain())) return;
    if (!set((current) => current)) return;
    navigate(next);
  };
  const props = { model, onChange, onIntent, onNavigate: go, onAttributeChange };
  const Page =
    route === '/manage/catalog'
      ? ManagementCatalog
      : route === '/manage/locations'
        ? ManagementLocations
        : route === '/manage/edit'
          ? ManagementEdit
          : route === '/manage/bulk'
            ? ManagementBulk
            : route === '/manage/history'
              ? ManagementHistory
              : ManagementItems;
  return (
    <>
      <Page {...props} />
      {exportRecord?.error && (
        <section className="management-card" role="alert">
          <p>{exportRecord.error}</p>
          {exportRecord.attempt?.kind === 'begin' && exportRecord.state === 'networkUnknown' ? (
            <p>初次冻结回执未知。服务端协议没有原请求查询入口；可另建独立导出，原记录继续保留。</p>
          ) : (
            <button
              type="button"
              className="vn-button"
              onClick={() => void onIntent('export-recover')}
            >
              按原导出标识与游标重试
            </button>
          )}
        </section>
      )}

      {operationRecord?.state === 'revisionConflict' && (
        <section className="management-card" aria-label="管理任务版本冲突">
          <h2>版本已变化，原输入已保留</h2>
          <p>{operationRecord.error}</p>
          <ul>
            {operationRecord.draft.task.snapshot.map((before) => {
              const current = isCatalogManagementTask(operationRecord.draft.task.kind)
                ? dynamicCatalogs.find((row) => row.id === before.id)
                : items.find((row) => row.id === before.id);
              return (
                <li key={before.id}>
                  {before.id} · 原版本 {before.revision} → 当前 {current?.revision ?? '不可读取'}
                  {current
                    ? ` · ${current.name} · ${('location' in current ? current.location.path : current.path).join(' › ') || '位置未记录'}`
                    : ''}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="vn-button"
            disabled={
              !available ||
              operationRecord.targetIds.some(
                (id) =>
                  !(
                    isCatalogManagementTask(operationRecord.draft.task.kind)
                      ? dynamicCatalogs
                      : items
                  ).some((row) => row.id === id),
              )
            }
            onClick={() => void onIntent('resolve-conflict')}
          >
            保留输入并按当前版本重新核对
          </button>
        </section>
      )}
      {operation &&
        operationRecord &&
        !['submitting', 'networkUnknown', 'sessionChanged', 'success'].includes(
          operationRecord.state,
        ) &&
        operationRecord.attemptStatus !== 'uncertain' &&
        local.task?.phase !== 'unknown' &&
        local.retainedTask?.phase !== 'unknown' && (
          <div className="management-card">
            <button
              type="button"
              className="vn-button"
              onClick={() =>
                void (async () => {
                  if (!(await operation.retain())) return;
                  const task = managementTaskView(operation.getSnapshot());
                  set((current) => ({
                    ...current,
                    task: null,
                    retainedTask: null,
                    savedTasks: [
                      ...(current.savedTasks || []).filter((row) => row.taskId !== task.taskId),
                      task,
                    ],
                    feedback: '未发送的草稿已保留，可开始其他任务；原键和输入未丢弃。',
                  }));
                })()
              }
            >
              保留未提交草稿，开始其他任务
            </button>
          </div>
        )}
      {!local.task &&
        !local.retainedTask &&
        local.savedTasks?.map((saved) => (
          <div className="management-card" key={saved.taskId}>
            <p>保留的管理草稿：{saved.title}</p>
            <button
              type="button"
              className="vn-button"
              onClick={() => {
                if (
                  !set((current) => ({
                    ...current,
                    task: saved,
                    savedTasks: (current.savedTasks || []).filter(
                      (row) => row.taskId !== saved.taskId,
                    ),
                  }))
                )
                  return;
                if (saved.returnPath) void go(saved.returnPath);
              }}
            >
              继续此草稿
            </button>
          </div>
        ))}
      {local.storageError && (
        <div role="alert" className="management-card">
          <p>{local.storageError} 当前输入仍保留；保存前不能提交。</p>
          <button
            type="button"
            className="vn-button"
            onClick={() => void onIntent('retry-storage')}
          >
            重试保存草稿
          </button>
        </div>
      )}
      {local.retainedTask && !local.task && (
        <div className="management-card">
          <p>保留的任务：{local.retainedTask.title}</p>
          <button
            type="button"
            className="vn-button"
            onClick={() =>
              (() => {
                const retained = localRef.current.retainedTask;
                set((current) => ({ ...current, task: current.retainedTask, retainedTask: null }));
                if (retained?.returnPath) go(retained.returnPath);
              })()
            }
          >
            继续草稿
          </button>
        </div>
      )}
    </>
  );
}
