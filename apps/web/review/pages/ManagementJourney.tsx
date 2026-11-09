// Isolated review controller. All reading, filtering and mutation simulation stays here.
import { useEffect, useState } from 'react';
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
import { householdId, history as baseHistory, itemFacts } from './fixtures';
import { useReviewWorld, updateReviewItems } from './inventory-session';
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
  export: ManagementModel['export'];
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
const persisted = new Map<string, LocalState>();
const specialLimit = (scenario: string) =>
  ['limit', 'over-limit', '100-items', 'selection-limit'].includes(scenario);
function makeInitial(scenario: string, items: readonly ItemView[]): LocalState {
  const locations = scenario === 'empty' ? [] : locationFixtures(items);
  return {
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
    catalogs: scenario === 'empty' ? [] : catalogFixtures(items),
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
): TreeViewNode[] {
  return rows
    .filter((row) => row.parentId === parent)
    .map((row) => ({
      id: row.id,
      label: row.name,
      description: row.path.join(' › '),
      children: tree(rows, row.id),
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
  const baseItems = world.items.map((row) => row.item);
  const availableItems = specialLimit(scenario) ? largeSelectionItems() : baseItems;
  const [local, setLocal] = useState<LocalState>(
    () => persisted.get(scenario) || makeInitial(scenario, availableItems),
  );
  const set = (updater: (state: LocalState) => LocalState) =>
    setLocal((current) => {
      const next = updater(current);
      persisted.set(scenario, next);
      return next;
    });
  useEffect(() => {
    setLocal(persisted.get(scenario) || makeInitial(scenario, availableItems));
  }, [scenario]);
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
  const available = state === 'ready';
  const writeAvailability: ManagementModel['writeAvailability'] = available
    ? { kind: 'available' }
    : {
        kind:
          state === 'offline' ? 'offline' : state === 'forbidden' ? 'forbidden' : 'blockedState',
        reason:
          state === 'offline'
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
  const dynamicCatalogs = local.catalogs.map((row) =>
    row.kind === 'SKU'
      ? { ...row, itemCount: items.filter((item) => item.skuId === row.id).length }
      : row,
  );
  const catalogId = url.searchParams.get('id') || local.catalogId || local.categoryFilter;
  const selectedCatalog = dynamicCatalogs.find((row) => row.id === catalogId) || null;
  const dynamicLocations = local.locations.map((location) => ({
    ...location,
    contentCount: items.filter(
      (item) =>
        item.location.path.join('/') === location.path.join('/') ||
        item.location.path.join('/').startsWith(location.path.join('/') + '/'),
    ).length,
  }));
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
    scope: householdId,
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
        ? lifecycleBinding
        : local.bindings[item.id]
    : null;
  useEffect(() => {
    if (route === '/manage/edit' && item && local.editId !== item.id)
      set((current) => ({
        ...current,
        editId: item.id,
        nameDraft: { mode: 'unchanged', value: item.name },
        attributeDraft:
          current.bindings[item.id] === undefined
            ? structuredClone(lifecycleBinding)
            : current.bindings[item.id],
        changedAttributes: [],
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
  function patchWorld(ids: readonly string[], patch: (item: ItemView) => ItemView) {
    const changed = world.items
      .filter((row) => ids.includes(row.item.id))
      .map((row) => ({ ...row, item: { ...patch(row.item), revision: row.item.revision + 1 } }));
    if (changed.length !== ids.length) throw Error('部分对象已不可访问；整批未执行。');
    updateReviewItems(changed, {
      operationLabel: local.task?.title,
      reason: local.task
        ? withValues(local.task).reason || withValues(local.task).note || '隔离预览操作'
        : '隔离预览操作',
      eventType:
        local.task?.kind === 'history-correct' ||
        local.task?.kind === 'reassign' ||
        local.task?.kind === 'restore'
          ? 'ITEM_CORRECTED'
          : local.task?.kind.includes('move')
            ? 'ITEM_MOVED'
            : 'ITEM_UPDATED',
    });
  }
  function appendHistory(
    ids: readonly string[],
    label: string,
    changes: {
      path: string;
      before_present: boolean;
      after_present: boolean;
      before?: unknown;
      after?: unknown;
    }[],
    reason: string,
  ) {
    const op = `operation_${crypto.randomUUID()}`;
    set((current) => ({
      ...current,
      extraHistory: [
        ...ids.map((id) => ({
          ...baseHistory[0],
          operationLabel: label,
          objectLabel: items.find((item) => item.id === id)?.name || '当前对象',
          event: {
            ...baseHistory[0].event!,
            id: `event_${crypto.randomUUID()}`,
            operation_id: op,
            target_id: id,
            event_type: 'ITEM_CORRECTED' as const,
            reason,
            changes,
            occurred_at: '2026-11-07T08:00:00Z',
            recorded_at: '2026-11-07T08:00:00Z',
            before_revision: items.find((item) => item.id === id)?.revision || 1,
            after_revision: (items.find((item) => item.id === id)?.revision || 1) + 1,
          },
          operationComplete: true,
        })),
        ...current.extraHistory,
      ],
    }));
  }
  function baseTask(kind: string, id?: string): ManagementTask {
    const targets = kind.startsWith('bulk-') ? selectedIds : id ? [id] : [];
    const rows = targets
      .map((id) => items.find((row) => row.id === id))
      .filter((row): row is ItemView => !!row);
    return {
      kind,
      title: '核对操作',
      description: '以下输入只在隔离预览中生效。',
      targetIds: [...targets],
      fields: [],
      impact: [],
      phase: 'draft',
      confirmLabel: '确认隔离预览',
      snapshot: rows.map((row) => ({
        id: row.id,
        name: row.name,
        path: row.location.path.join(' › ') || '位置未记录',
        revision: row.revision,
      })),
    };
  }
  function createTask(kind: string, id?: string) {
    const targetItem = items.find((row) => row.id === (id || itemId));
    const catalog = dynamicCatalogs.find((row) => row.id === (id || selectedCatalog?.id));
    const location = dynamicLocations.find((row) => row.id === (id || selectedLocation?.id));
    const task = baseTask(kind, id);
    const stock = catalog?.attributes.find((binding) => binding.template_id === 'stock')?.values;
    const locationOptions = local.locations
      .filter((row) => row.canContain && row.recordState === 'VALID')
      .map((row) => ({
        value: row.id,
        label: row.path.join(' › '),
        disabled:
          !!location &&
          (row.id === location.id || row.path.join('/').startsWith(location.path.join('/') + '/')),
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
        before: describe(atPath((local.bindings[itemId] || lifecycleBinding).values, path)),
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
                  !local.catalogs
                    .find((candidate) => candidate.id === row.value)
                    ?.path.join('/')
                    .startsWith((catalog?.path.join('/') || '__none__') + '/'),
              ),
            },
          ),
          ...(kind === 'catalog-create-group' || catalog?.kind === 'GROUP'
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
        summary: '审批只覆盖本次提案；确认后仍需提交原领域操作。',
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
      task.description = `已读取当前物品版本 ${targetItem?.revision ?? '未知'}。新事件追加历史；原事件不会改写。`;
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
      local.nameDraft.mode === 'set' &&
      !local.nameDraft.value.trim()
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
    for (const snapshot of task.snapshot) {
      const current = items.find((item) => item.id === snapshot.id);
      if (!current || current.revision !== snapshot.revision)
        return '对象版本已变化或不可访问。整个批次未执行，请重新核对最新资料。';
    }
    return null;
  }
  function onChange(key: string, value: unknown) {
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
      if (url.searchParams.has('id')) navigate('/manage/catalog');
      return;
    }
    if (key === 'selectedLocation') {
      set((current) => ({ ...current, locationId: String(value) }));
      return;
    }
    if (key === 'nameMode' || key === 'nameValue') {
      set((current) => ({
        ...current,
        nameDraft: { ...current.nameDraft, [key === 'nameMode' ? 'mode' : 'value']: value },
        task: null,
      }));
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
    if (edit.kind !== 'value' || !itemBinding) return;
    set((current) => ({
      ...current,
      attributeDraft: {
        ...itemBinding,
        values: patchAt(
          itemBinding.values,
          edit.path,
          edit.value === null ? undefined : edit.value,
        ),
      },
      changedAttributes: [...new Set([...current.changedAttributes, edit.path])],
      task: null,
    }));
  }
  function onIntent(kind: string, id?: string) {
    if (kind === 'retry') {
      set((current) => ({ ...current, recovered: true, feedback: '已重新读取隔离样例范围。' }));
      return;
    }
    if (kind === 'bulk') {
      set((current) => ({ ...current, page: 0 }));
      navigate('/manage/bulk');
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
      set((current) => ({
        ...current,
        retainedTask: current.task?.phase === 'receipt' ? null : current.task,
        task: null,
      }));
      return;
    }
    if (kind === 'export') {
      set((current) => ({
        ...current,
        exportRows: structuredClone(filtered),
        export: {
          scope: `物品查询：${local.query || '全部名称'} · ${local.includeVoid ? '含作废' : '有效记录'} · ${skuFilter ? '指定商品' : local.categoryFilter ? dynamicCatalogs.find((row) => row.id === local.categoryFilter)?.path.join(' › ') : '全部分类'} · ${local.locationFilter ? dynamicLocations.find((row) => row.id === local.locationFilter)?.path.join(' › ') : '全部位置'}`,
          generatedAt: '2026-11-07 16:00 · Asia/Shanghai',
          total: filtered.length,
          loaded: 0,
          complete: false,
        },
        feedback: '',
      }));
      return;
    }
    if (kind === 'export-next') {
      set((current) => {
        if (!current.export) return current;
        const loaded = Math.min(current.export.loaded + 6, current.exportRows.length);
        const complete = loaded === current.exportRows.length;
        const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const csv = [
          '隔离预览样例，非正式家庭导出',
          'ID,名称,物理路径,记录状态,版本',
          ...current.exportRows.map((item) =>
            [
              item.id,
              item.name,
              item.location.path.join(' › '),
              item.recordState,
              String(item.revision),
            ]
              .map(cell)
              .join(','),
          ),
        ].join('\r\n');
        return {
          ...current,
          export: {
            ...current.export,
            loaded,
            complete,
            href: complete
              ? `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + csv)}`
              : undefined,
          },
        };
      });
      return;
    }
    if (kind === 'export-cancel') {
      set((current) => ({
        ...current,
        export: null,
        exportRows: [],
        feedback: '隔离导出已结束，冻结快照已释放。',
      }));
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
      navigate('/manage/history');
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
      createTask(kind, id);
      return;
    }
    const task = local.task;
    if (!task || task.blockedReason || !available) return;
    const error = validate(task);
    if (error) {
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
      task.kind === 'item-save'
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
    const v = withValues(task);
    let receipt = '隔离样例已更新。正式家庭未发生写入。';
    try {
      if (task.kind === 'item-save') {
        const name =
          local.nameDraft.mode === 'clear'
            ? dynamicCatalogs.find((row) => row.id === item?.skuId)?.name || item!.name
            : local.nameDraft.value;
        patchWorld(task.targetIds, (row) => ({ ...row, name }));
        set((current) => ({ ...current, nameDraft: { mode: 'unchanged', value: name } }));
      } else if (task.kind === 'item-move' || task.kind === 'bulk-move') {
        const location = local.locations.find((row) => row.id === v.destination);
        patchWorld(task.targetIds, (row) => ({
          ...row,
          location: location
            ? { id: location.id, path: [...location.path], label: location.name }
            : { id: null, path: [], label: '位置未记录' },
        }));
      } else if (task.kind === 'void' || task.kind === 'restore') {
        patchWorld(task.targetIds, (row) => ({
          ...row,
          recordState: task.kind === 'void' ? 'VOID' : 'VALID',
          voidedAt: task.kind === 'void' ? '2026-11-07T08:00:00Z' : null,
        }));
      } else if (task.kind === 'dispose') {
        patchWorld(task.targetIds, (row) => ({
          ...row,
          status: { label: '已处置', tone: 'neutral' },
        }));
      } else if (task.kind === 'bulk-consume') {
        const changed = world.items
          .filter((row) => task.targetIds.includes(row.item.id))
          .map((row) => ({
            ...row,
            quantity: { ...row.quantity, value: '0' },
            item: {
              ...row.item,
              revision: row.item.revision + 1,
              status: { label: '已用完', tone: 'neutral' as const },
            },
          }));
        if (changed.length !== task.targetIds.length) throw Error('部分对象不可访问，全部未执行。');
        updateReviewItems(changed, {
          operationLabel: local.task?.title,
          reason: local.task
            ? withValues(local.task).reason || withValues(local.task).note || '隔离预览操作'
            : '隔离预览操作',
          eventType:
            local.task?.kind === 'history-correct' ||
            local.task?.kind === 'reassign' ||
            local.task?.kind === 'restore'
              ? 'ITEM_CORRECTED'
              : local.task?.kind.includes('move')
                ? 'ITEM_MOVED'
                : 'ITEM_UPDATED',
        });
      } else if (task.kind === 'attribute-save') {
        set((current) => ({
          ...current,
          bindings: { ...current.bindings, [itemId]: structuredClone(itemBinding) },
          changedAttributes: [],
        }));
        appendHistory(
          task.targetIds,
          '修改生命周期属性',
          local.changedAttributes.map((path) => ({
            path: `lifecycle.${path}`,
            before_present: true,
            after_present: true,
            after: itemBinding ? atPath(itemBinding.values, path) : undefined,
          })),
          '隔离属性修改',
        );
      } else if (task.kind === 'bulk-lifecycle') {
        set((current) => {
          const bindings = { ...current.bindings };
          for (const id of task.targetIds) {
            const base = bindings[id] || lifecycleBinding;
            const values = patchAt(
              base.values,
              'acquisition.acquired_on',
              v.mode === 'clear' ? undefined : v.date,
            );
            bindings[id] = { ...base, values };
          }
          return { ...current, bindings };
        });
        appendHistory(
          task.targetIds,
          '批量修改取得日期',
          [
            {
              path: 'lifecycle.acquisition.acquired_on',
              before_present: true,
              after_present: v.mode !== 'clear',
              after: v.date,
            },
          ],
          '隔离批量操作',
        );
      } else if (
        task.kind === 'template-upgrade' ||
        task.kind === 'template-remove' ||
        task.kind === 'template-add'
      ) {
        const binding =
          task.kind === 'template-remove'
            ? null
            : task.kind === 'template-upgrade'
              ? {
                  ...itemBinding!,
                  template_version: 2,
                  values: Object.fromEntries(
                    Object.entries(itemBinding!.values).filter(([key]) => key !== 'availability'),
                  ),
                }
              : { ...lifecycleBinding, values: {} };
        set((current) => ({
          ...current,
          bindings: { ...current.bindings, [itemId]: binding },
          attributeDraft: binding,
          changedAttributes: [],
        }));
        receipt = '隔离样例的模板绑定已更新；未渲染字段保持原值，原历史保留。';
      } else if (task.kind === 'history-correct') {
        patchWorld(task.targetIds, (row) => ({ ...row, name: v.name }));
        receipt = '已追加一条隔离纠正事件，原历史事件没有改写。';
      } else if (task.kind === 'reassign') {
        patchWorld(task.targetIds, (row) => ({ ...row, skuId: v.sku }));
      } else if (task.kind === 'split') {
        const source = world.items.find((row) => row.item.id === task.targetIds[0])!;
        const count = Number(v.count);
        const target = dynamicCatalogs.find((row) => row.id === v.sku)!;
        const children = Array.from({ length: count }, () => ({
          ...structuredClone(source),
          item: {
            ...source.item,
            id: `item_${crypto.randomUUID()}`,
            skuId: target.id,
            name: target.name,
            revision: 1,
            status: { label: '开封状态未记录', tone: 'neutral' as const },
            facts: [],
          },
          quantity: { value: v.quantity, unit: v.unit, accuracy: source.quantity.accuracy },
        }));
        updateReviewItems(
          [
            {
              ...source,
              item: {
                ...source.item,
                revision: source.item.revision + 1,
                status: { label: '已拆包', tone: 'neutral' },
              },
              quantity: { ...source.quantity, value: '0' },
            },
            ...children,
          ],
          { operationLabel: '拆包', reason: '隔离预览：数量守恒，子件独立身份' },
        );
        receipt = `隔离源件已结束，建立 ${count} 件独立子件；内容守恒已核对，物理位置继承原位置。`;
      } else if (task.kind.startsWith('catalog-') || task.kind === 'stock') {
        set((current) => {
          let catalogs = [...current.catalogs];
          const index = catalogs.findIndex((row) => row.id === task.targetIds[0]);
          if (task.kind.startsWith('catalog-create')) {
            const parent = catalogs.find((row) => row.id === v.parent);
            catalogs.push({
              ...containerCatalog,
              id: `catalog_node_${crypto.randomUUID()}`,
              name: v.name,
              kind: task.kind === 'catalog-create-group' ? 'GROUP' : 'SKU',
              parentId: v.parent === 'root' ? null : v.parent || null,
              path: [...(parent?.path || []), v.name],
              profile:
                v.profile === 'unknown'
                  ? null
                  : v.profile === 'CONSUMABLE'
                    ? 'CONSUMABLE'
                    : v.profile === 'DURABLE'
                      ? 'DURABLE'
                      : null,
              effectiveCapabilities: [],
              itemCount: 0,
            });
          } else if (index >= 0) {
            const old = catalogs[index];
            const parent = catalogs.find((row) => row.id === v.parent);
            catalogs[index] = {
              ...old,
              revision: old.revision + 1,
              ...(task.kind === 'catalog-void'
                ? { recordState: 'VOID', voidedAt: '2026-11-07T08:00:00Z' }
                : task.kind === 'stock'
                  ? {
                      attributes: [
                        ...old.attributes.filter((b) => b.template_id !== 'stock'),
                        {
                          template_id: 'stock',
                          template_version: 1,
                          status: 'KNOWN',
                          values: {
                            basis: v.mode,
                            ...(v.mode === 'CONTENT' ? { content_unit: v.unit } : {}),
                            reorder_threshold: v.threshold,
                            target: v.target,
                          },
                        },
                      ],
                    }
                  : {
                      name: v.name || old.name,
                      parentId: v.parent === 'root' ? null : v.parent || old.parentId,
                      path: [...(parent?.path || []), v.name || old.name],
                      profile:
                        v.profile === 'unknown'
                          ? null
                          : v.profile === 'CONSUMABLE'
                            ? 'CONSUMABLE'
                            : v.profile === 'DURABLE'
                              ? 'DURABLE'
                              : old.profile,
                    }),
            };
            if (old.kind === 'GROUP') {
              const newPath = catalogs[index].path;
              catalogs = catalogs.map((row) =>
                row.id !== old.id && row.path.join('/').startsWith(old.path.join('/') + '/')
                  ? { ...row, path: [...newPath, ...row.path.slice(old.path.length)] }
                  : row,
              );
            }
          }
          return { ...current, catalogs };
        });
        receipt = task.kind.startsWith('catalog-create')
          ? '商品或分类资料已在隔离样例建立；没有增加任何实物库存。'
          : '隔离目录提案已确认并应用；实物位置不变。';
      } else if (task.kind.startsWith('location-')) {
        const loc = local.locations.find((row) => row.id === task.targetIds[0]);
        const parent = local.locations.find((row) => row.id === v.destination);
        const newPath =
          task.kind === 'location-move'
            ? [...(parent?.path || []), loc!.name]
            : [...(loc?.path.slice(0, -1) || parent?.path || []), v.name || loc?.name || ''];
        const createdLocationId =
          task.kind === 'location-create' ? `item_${crypto.randomUUID()}` : null;
        if (createdLocationId) {
          const prototype = world.items[0] || itemFacts[0];
          updateReviewItems([
            {
              ...structuredClone(prototype),
              item: {
                ...prototype.item,
                id: createdLocationId,
                skuId: containerCatalog.id,
                name: v.name,
                subtitle: '位置容器',
                profile: 'DURABLE',
                revision: 1,
                recordState: 'VALID',
                voidedAt: null,
                location: parent
                  ? { id: parent.id, label: parent.name, path: [...parent.path] }
                  : { id: null, label: '未指定位置', path: [] },
                status: { label: '容器 · 可以容纳', tone: 'neutral' },
                facts: [],
                noteCount: 0,
                attachmentCount: 0,
              },
              quantity: { value: null, unit: '', accuracy: 'unknown' },
              date: undefined,
            },
          ]);
        }
        if (loc && (task.kind === 'location-move' || task.kind === 'location-edit')) {
          const affected = world.items
            .filter((row) => row.item.location.path.join('/').startsWith(loc.path.join('/')))
            .map((row) => ({
              ...row,
              item: {
                ...row.item,
                revision: row.item.revision + 1,
                location: {
                  ...row.item.location,
                  path: [...newPath, ...row.item.location.path.slice(loc.path.length)],
                },
              },
            }));
          if (affected.length) updateReviewItems(affected);
        }
        set((current) => {
          let locations = [...current.locations];
          if (task.kind === 'location-create')
            locations.push({
              id: createdLocationId!,
              parentId: parent?.id || null,
              name: v.name,
              path: newPath,
              revision: 1,
              canContain: true,
              recordState: 'VALID',
              contentCount: 0,
              containerCatalogId: containerCatalog.id,
            });
          else
            locations = locations.map((row) =>
              row.id === loc?.id
                ? {
                    ...row,
                    revision: row.revision + 1,
                    name: v.name || row.name,
                    path: newPath,
                    ...(task.kind === 'location-move' ? { parentId: parent?.id || null } : {}),
                    recordState:
                      task.kind === 'location-void'
                        ? 'VOID'
                        : task.kind === 'location-restore'
                          ? 'VALID'
                          : row.recordState,
                  }
                : loc && row.path.join('/').startsWith(loc.path.join('/') + '/')
                  ? { ...row, path: [...newPath, ...row.path.slice(loc.path.length)] }
                  : row,
            );
          return { ...current, locations };
        });
      }
      set((current) => ({
        ...current,
        task: { ...task, phase: 'receipt', receipt },
        feedback: '',
        retainedTask: null,
      }));
    } catch (error) {
      set((current) => ({
        ...current,
        task: { ...task, error: error instanceof Error ? error.message : '保存失败，草稿已保留。' },
      }));
    }
  }
  const props = { model, onChange, onIntent, onNavigate: navigate, onAttributeChange };
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
      {local.retainedTask && !local.task && (
        <div className="management-card">
          <p>保留的任务：{local.retainedTask.title}</p>
          <button
            type="button"
            className="vn-button"
            onClick={() =>
              set((current) => ({ ...current, task: current.retainedTask, retainedTask: null }))
            }
          >
            继续草稿
          </button>
        </div>
      )}
    </>
  );
}
