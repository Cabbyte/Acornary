// Isolated domain projection for management commands. No network or production writes.
import Decimal from 'decimal.js';
import { resolveCapabilities } from '../../../../packages/contracts/src/registry';
import type { AttributeBindingV2 } from '../../../../packages/contracts/src/read-v2';
import type { DailyItemFacts } from '../../src/features/daily/pages/models';
import type { ManagedCatalog, ManagementModel } from '../../src/features/management/pages/models';
import type { ManagementAttempt } from '../../src/app-vnext/management-task';
import { isCatalogManagementTask } from '../../src/app-vnext/management-task';
import type { ManagementFixtureState } from './management-task-adapter';
import { bindingFromFacts, projectLifecycle } from './management-lifecycle-projection';
import { reprojectTree, projectLocationChange } from './management-tree-projection';
import { trialInstant } from '../trial/clock';

const extended = new Set([
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
]);
export const usesExtendedManagementProjection = (kind: string) =>
  extended.has(kind) || isCatalogManagementTask(kind);
function fail(code: string, message: string): never {
  throw Object.assign(Error(message), { code });
}
const terminal = (facts: DailyItemFacts) =>
  ['已用完', '已处置', '已拆包', '已归档', '已遗失'].includes(facts.item.status.label);
function freshItem(
  id: string,
  catalog: ManagedCatalog,
  parent: DailyItemFacts['item']['location'],
  name?: string,
): DailyItemFacts {
  return {
    item: {
      id,
      skuId: catalog.id,
      name: name ?? catalog.name,
      profile: catalog.profile,
      location: structuredClone(parent),
      revision: 1,
      updatedAt: trialInstant(),
      recordState: 'VALID',
      voidedAt: null,
      facts: [],
      attention: [],
      redactedPaths: [],
      noteCount: 0,
      attachmentCount: 0,
      status: { label: '开封状态未记录', tone: 'neutral' },
    },
    quantity: { value: null, unit: '', accuracy: 'unknown' },
  };
}
function activeSku(state: ManagementFixtureState, id: string) {
  const catalog = state.catalogs.find(
    (row) => row.id === id && row.kind === 'SKU' && row.recordState === 'VALID',
  );
  if (!catalog) fail('NOT_FOUND', '明确目标商品不可访问或已作废。');
  return catalog;
}
function catalogParent(state: ManagementFixtureState, id: unknown, movingId?: string) {
  if (id === null) return null;
  const parent = state.catalogs.find(
    (row) => row.id === id && row.kind === 'GROUP' && row.recordState === 'VALID',
  );
  if (!parent)
    fail('CLASSIFICATION_CONFLICT', '上级必须为可访问的有效分类，不能以 SKU 或未知对象代替。');
  let candidate: string | null = parent.id;
  const seen = new Set<string>();
  while (candidate) {
    if (candidate === movingId || seen.has(candidate))
      fail('CYCLE_DETECTED', '分类不能归属自身或后代。');
    seen.add(candidate);
    candidate = state.catalogs.find((row) => row.id === candidate)?.parentId || null;
  }
  return parent;
}
function physicalParent(state: ManagementFixtureState, id: unknown) {
  if (id === null) return { id: null, path: [], label: '位置未记录' };
  const parent = state.locations.find(
    (row) => row.id === id && row.canContain && row.recordState === 'VALID',
  );
  if (!parent) fail('INVALID_PARENT', '目标不是当前可访问的有效容器。');
  return { id: parent.id, path: [...parent.path], label: parent.name };
}
function catalogHistory(
  before: ManagedCatalog | null,
  after: ManagedCatalog,
  attempt: ManagementAttempt,
): ManagementModel['history'][number] {
  const recorded = trialInstant();
  return {
    operationLabel: attempt.draft.task.title,
    objectLabel: after.name,
    actorLabel: '隔离试用成员',
    familyTimezone: 'Asia/Shanghai',
    operationComplete: true,
    event: {
      id: `event_${crypto.randomUUID()}`,
      operation_id: `operation_${crypto.randomUUID()}`,
      target_kind: 'CATALOG_NODE',
      target_id: after.id,
      event_type: before ? 'UPDATE' : 'CREATE',
      before_revision: before?.revision ?? 0,
      after_revision: after.revision,
      actor_id: 'actor_00000000-0000-4000-8000-000000000001',
      source: 'TEST',
      occurred_at: recorded,
      recorded_at: recorded,
      reason: String(attempt.command.payload.reason || '隔离目录任务'),
      changes: [
        {
          path: 'catalog',
          before_present: !!before,
          after_present: true,
          ...(before ? { before } : {}),
          after,
        },
      ],
    },
  };
}
export function projectExtendedManagementCommand(
  attempt: ManagementAttempt,
  state: ManagementFixtureState,
  world: { items: readonly DailyItemFacts[] },
  catalogHasReferences = false,
): { next: ManagementFixtureState; changed: DailyItemFacts[]; receipt: string; eventType: string } {
  const { task } = attempt.draft;
  const payload = attempt.command.payload;
  const next = structuredClone(state);
  const changed: DailyItemFacts[] = [];
  const targetId = task.targetIds[0];
  const original = world.items.find((row) => row.item.id === targetId);
  const revision = (payload.expected_revisions as Record<string, number>)[targetId];
  const patch = () => {
    if (!original || original.item.revision !== revision)
      fail('REVISION_CONFLICT', '当前物品版本已变化或不可访问。');
    const row = structuredClone(original);
    row.item.revision++;
    changed.push(row);
    return row;
  };
  let eventType = 'ITEM_UPDATED';
  let receipt = '隔离样例已更新。正式家庭未发生写入。';
  if (isCatalogManagementTask(task.kind)) {
    const index = next.catalogs.findIndex((row) => row.id === targetId);
    const before = index >= 0 ? structuredClone(next.catalogs[index]) : null;
    let catalog: ManagedCatalog;
    if (task.kind.startsWith('catalog-create')) {
      const parent = catalogParent(next, payload.parent_id);
      catalog = {
        id: `catalog_node_${crypto.randomUUID()}`,
        kind: payload.kind as 'GROUP' | 'SKU',
        parentId: parent?.id ?? null,
        name: String(payload.name),
        path: [...(parent?.path || []), String(payload.name)],
        revision: 1,
        profile: (payload.profile as ManagedCatalog['profile']) ?? null,
        capabilities: null,
        effectiveCapabilities: resolveCapabilities(
          (payload.profile as ManagedCatalog['profile']) ?? null,
          null,
        ),
        oneOff: false,
        recordState: 'VALID',
        voidedAt: null,
        redactedPaths: [],
        attributes: [],
        itemCount: 0,
        hidden: false,
        specification: '规格未记录',
      };
      next.catalogs.push(catalog);
      receipt = '隔离目录资料已创建，没有增加实物库存。';
    } else {
      if (!before || before.revision !== revision)
        fail('REVISION_CONFLICT', '目录版本已变化或不可访问。');
      if (before.recordState !== 'VALID') fail('STATE_CONFLICT', '已作废目录不能编辑。');
      catalog = structuredClone(before);
      catalog.revision++;
      if (task.kind === 'catalog-edit') {
        catalog.name = String(payload.name);
        if ('profile' in payload) catalog.profile = payload.profile as ManagedCatalog['profile'];
        catalog.effectiveCapabilities = resolveCapabilities(catalog.profile, catalog.capabilities);
        const parent = catalogParent(next, catalog.parentId);
        catalog.path = [...(parent?.path || []), catalog.name];
      } else if (task.kind === 'catalog-move') {
        const parent = catalogParent(next, payload.parent_id, catalog.id);
        catalog.parentId = parent?.id ?? null;
        catalog.path = [...(parent?.path || []), catalog.name];
      } else if (task.kind === 'catalog-void') {
        if (
          catalog.kind !== 'SKU' ||
          catalog.itemCount === null ||
          catalogHasReferences ||
          world.items.some((row) => row.item.skuId === catalog.id) ||
          next.catalogs.some((row) => row.parentId === catalog.id) ||
          next.locations.some((row) => row.containerCatalogId === catalog.id) ||
          catalog.attributes.some(
            (row) =>
              row.template_id === 'product' &&
              Array.isArray(row.values.barcodes) &&
              row.values.barcodes.length,
          )
        )
          fail('STATE_CONFLICT', '商品仍有业务引用或引用覆盖未知，不能作废。');
        catalog.recordState = 'VOID';
        catalog.voidedAt = trialInstant();
      } else {
        const binding = catalog.attributes.find((row) => row.template_id === 'stock');
        if (
          (attempt.command.operation === 'bind_attributes' && binding) ||
          (attempt.command.operation === 'update_attributes' &&
            (!binding || binding.template_version !== payload.template_version))
        )
          fail('REVISION_CONFLICT', '补货模板绑定已变化，请重新核对。');
        const values = {
          ...(binding?.values || {}),
          ...((payload.values || payload.set) as Record<string, unknown>),
        };
        for (const key of (payload.unset as string[] | undefined) || []) delete values[key];
        catalog.attributes = [
          ...catalog.attributes.filter((row) => row.template_id !== 'stock'),
          {
            template_id: 'stock',
            template_version: Number(payload.template_version),
            status: 'KNOWN',
            values,
          },
        ];
      }
      next.catalogs[index] = catalog;
      if (before.kind === 'GROUP') next.catalogs = reprojectTree(next.catalogs, catalog.id);
      if (
        catalog.kind === 'SKU' &&
        (catalog.name !== before.name || catalog.profile !== before.profile)
      ) {
        // Catalog projections change; physical Item revisions do not advance for derived labels.
        changed.push(
          ...world.items
            .filter((row) => row.item.skuId === catalog.id)
            .map((row) => ({
              ...structuredClone(row),
              item: {
                ...structuredClone(row.item),
                profile: catalog.profile,
                name:
                  !state.explicitNames[row.item.id] && row.item.name === before.name
                    ? catalog.name
                    : row.item.name,
              },
            })),
        );
      }
    }
    next.extraHistory = [catalogHistory(before, catalog, attempt), ...(next.extraHistory || [])];
  } else if (task.kind === 'location-create') {
    const catalog = activeSku(next, String(payload.catalog_node_id));
    if (!catalog.effectiveCapabilities.includes('container'))
      fail('INVALID_PARENT', '商品不具备容器能力。');
    const parent = physicalParent(next, payload.parent_id);
    const row = freshItem(
      `item_${crypto.randomUUID()}`,
      catalog,
      parent,
      String(payload.display_name),
    );
    row.item.status = { label: '容器 · 可以容纳', tone: 'neutral' };
    changed.push(row);
    next.explicitNames[row.item.id] = true;
    next.locations.push({
      id: row.item.id,
      name: row.item.name,
      parentId: parent.id,
      path: [...parent.path, row.item.name],
      canContain: true,
      recordState: 'VALID',
      revision: 1,
      contentCount: 0,
      containerCatalogId: catalog.id,
    });
    eventType = 'CREATE';
  } else if (task.kind === 'location-edit') {
    const row = patch();
    const projection = projectLocationChange(next.locations, world.items, targetId, {
      name: String(payload.display_name),
    });
    next.locations = projection.locations;
    changed.splice(0, changed.length, ...projection.items);
    next.explicitNames[targetId] = true;
  } else if (task.kind === 'void' || task.kind === 'location-void') {
    const row = patch();
    const descendants = new Set<string>();
    const visit = (source: string) => {
      for (const id of next.splits?.[source]?.childItemIds || [])
        if (!descendants.has(id)) {
          descendants.add(id);
          visit(id);
        }
    };
    visit(targetId);
    if (
      row.item.recordState === 'VOID' ||
      world.items.some(
        (entry) =>
          entry.item.location.id === targetId ||
          (descendants.has(entry.item.id) && entry.item.recordState === 'VALID'),
      )
    )
      fail('STATE_CONFLICT', '对象已作废、仍有内容或有效拆分后代。');
    row.item.recordState = 'VOID';
    row.item.voidedAt = trialInstant();
    eventType = 'VOID';
    next.locations = next.locations.map((entry) =>
      entry.id === targetId
        ? { ...entry, recordState: 'VOID', revision: row.item.revision }
        : entry,
    );
  } else if (task.kind === 'restore' || task.kind === 'location-restore') {
    const row = patch();
    if (row.item.recordState === 'VOID' && next.splits?.[targetId])
      fail('STATE_CONFLICT', '拆包来源不能恢复作废记录，原拆分关系保留。');
    row.item.recordState = 'VALID';
    row.item.voidedAt = null;
    // This command changes only record visibility; terminal/split lifecycle facts remain intact.
    next.locations = next.locations.map((entry) =>
      entry.id === targetId
        ? { ...entry, recordState: 'VALID', revision: row.item.revision }
        : entry,
    );
    eventType = 'CORRECT';
  } else if (task.kind === 'dispose') {
    const row = patch();
    if (row.item.recordState !== 'VALID' || terminal(row))
      fail('STATE_CONFLICT', '只有有效且未结束的物品可以处置。');
    const binding =
      next.bindings[targetId] === undefined ? bindingFromFacts(row) : next.bindings[targetId];
    next.bindings[targetId] = {
      ...(binding || { template_id: 'lifecycle', template_version: 2, status: 'KNOWN' }),
      values: { ...binding?.values, state: 'DISPOSED' },
    } as AttributeBindingV2;
    next.dispositions = {
      ...next.dispositions,
      [targetId]: structuredClone(payload.disposition as Record<string, unknown>),
    };
    row.item.status = { label: '已处置', tone: 'neutral' };
    eventType = 'DISPOSE';
  } else if (task.kind === 'split') {
    const row = patch();
    const catalog = activeSku(next, String(payload.target_catalog_node_id));
    if (
      row.item.recordState !== 'VALID' ||
      terminal(row) ||
      next.splits?.[targetId] ||
      world.items.some((entry) => entry.item.location.id === targetId) ||
      !row.quantity.value ||
      row.quantity.unit === 'percent'
    )
      fail('STATE_CONFLICT', '源件必须有效、未结束、无内容物且数量已知；不能重复拆包。');
    const contents = (payload.child_attributes as AttributeBindingV2[]).find(
      (binding) => binding.template_id === 'contents',
    )!;
    const remaining = contents.values.remaining as { value: string; unit: string };
    if (
      remaining.unit !== row.quantity.unit ||
      !new Decimal(row.quantity.value).eq(new Decimal(remaining.value).mul(Number(payload.count)))
    )
      fail('SPLIT_NOT_CONSERVED', '当前数量与子件数量不守恒，整批未执行。');
    const children = Array.from({ length: Number(payload.count) }, () => {
      const child = freshItem(`item_${crypto.randomUUID()}`, catalog, row.item.location);
      child.quantity = {
        value: remaining.value,
        unit: remaining.unit,
        accuracy:
          contents.values.accuracy === 'MEASURED'
            ? 'measured'
            : contents.values.accuracy === 'ESTIMATED'
              ? 'estimated'
              : 'unknown',
      };
      return child;
    });
    row.quantity = { ...row.quantity, value: '0' };
    row.item.status = { label: '已拆包', tone: 'neutral' };
    const binding =
      next.bindings[targetId] === undefined ? bindingFromFacts(row) : next.bindings[targetId];
    next.bindings[targetId] = {
      ...(binding || { template_id: 'lifecycle', template_version: 2, status: 'KNOWN' }),
      values: { ...binding?.values, state: 'CONSUMED' },
    } as AttributeBindingV2;
    next.splits = {
      ...next.splits,
      [targetId]: {
        childItemIds: children.map((child) => child.item.id),
        targetCatalogId: catalog.id,
      },
    };
    changed.push(...children);
    eventType = 'SPLIT';
    receipt = `隔离源件已结束，创建 ${children.length} 个独立子件；没有复制开封、日期、笔记或附件。`;
  } else if (task.kind === 'reassign') {
    const row = patch();
    const target = activeSku(
      next,
      String((payload.core as { catalog_node_id: string }).catalog_node_id),
    );
    if (row.item.recordState !== 'VALID') fail('STATE_CONFLICT', '先恢复作废记录，再纠正关联。');
    const previous = next.catalogs.find((catalog) => catalog.id === row.item.skuId);
    if (!next.explicitNames[targetId] && previous && row.item.name === previous.name)
      row.item.name = target.name;
    row.item.skuId = target.id;
    row.item.profile = target.profile;
    eventType = 'CORRECT';
  } else {
    const row = patch();
    const current =
      next.bindings[targetId] === undefined ? bindingFromFacts(row) : next.bindings[targetId];
    let binding: AttributeBindingV2 | null;
    if (task.kind === 'template-add') {
      if (current) fail('STATE_CONFLICT', '模板已经绑定，未覆盖现有值。');
      binding = {
        template_id: 'lifecycle',
        template_version: Number(payload.template_version),
        status: 'KNOWN',
        values: {},
      };
    } else {
      if (
        !current ||
        current.status !== 'KNOWN' ||
        current.template_version !== (payload.from_version ?? payload.template_version)
      )
        fail('REVISION_CONFLICT', '模板版本已变化或不可识别，原绑定保留。');
      binding =
        task.kind === 'template-remove'
          ? null
          : {
              ...current,
              template_version: Number(payload.to_version),
              values: structuredClone(payload.values as Record<string, unknown>),
            };
    }
    if (
      terminal(row) &&
      (!binding ||
        !['CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].includes(String(binding.values.state)))
    )
      fail('INVALID_TRANSITION', '模板修改不能清除已结束或拆包来源的终态。');
    next.bindings[targetId] = binding;
    const projection = projectLifecycle(row, binding);
    projection.item.revision = row.item.revision;
    changed[0] = projection;
    if (next.editId === targetId) {
      next.attributeDraft = binding;
      next.changedAttributes = [];
    }
    eventType =
      task.kind === 'template-add'
        ? 'ATTRIBUTE_BIND'
        : task.kind === 'template-remove'
          ? 'ATTRIBUTE_REMOVE'
          : 'ATTRIBUTE_UPGRADE';
  }
  return { next, changed, receipt, eventType };
}
