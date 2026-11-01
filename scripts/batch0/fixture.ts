import {
  templates,
  templateDefinition,
  latestTemplateVersion,
  type TemplateId,
} from '../../packages/contracts/src/index.js';
import { type AuditSnapshot } from './audit-model.js';

export const fixtureId = (kind: string, n: number) =>
  `${kind}_11111111-1111-4111-8111-${n.toString(16).padStart(12, '0')}`;
const created = '2026-10-01T00:00:00.000Z';
const bind = (template_id: string, values: unknown) => ({
  template_id,
  template_version: 1,
  values,
  created_at: created,
  updated_at: created,
});

// Formula-based seed 20261031. No production input, random values, wall-clock dates or secret content.
export function generateFixture(itemCount = 40): AuditSnapshot {
  if (!Number.isInteger(itemCount) || itemCount < 40 || itemCount > 10000)
    throw new Error('Fixture size must be 40–10000.');
  const s: AuditSnapshot = {
    households: [],
    actors: [],
    catalog_nodes: [],
    items: [],
    attribute_templates: [],
    barcode_index: [],
    notes: [],
    events: [],
    operations: [],
    migrations: [],
    catalog_policy_versions: [],
    catalog_identity_keys: [],
  };
  for (let h = 1; h <= 2; h++) {
    const household_id = fixtureId('household', h),
      actor_id = fixtureId('actor', h);
    s.households.push({ id: household_id, timezone: 'Asia/Shanghai' });
    s.actors.push({ id: actor_id, household_id });
    s.catalog_nodes.push({
      id: fixtureId('catalog_node', h * 100),
      household_id,
      parent_id: null,
      kind: 'GROUP',
      name: `家庭${h}分类`,
      revision: 1,
      attributes: [],
    });
    for (let k = 1; k <= 2; k++)
      s.catalog_nodes.push({
        id: fixtureId('catalog_node', h * 100 + k),
        household_id,
        parent_id: fixtureId('catalog_node', h * 100),
        kind: 'SKU',
        name: k === 1 ? '标准牛奶 AA' : '具体收纳容器',
        revision: 1,
        attributes: [bind('product', { specification: k === 1 ? '500 mL' : '收纳' })],
      });
    for (const id of Object.keys(templates) as TemplateId[])
      for (let version = 1; version <= latestTemplateVersion(id); version++)
        s.attribute_templates.push({
          household_id,
          id,
          version,
          target_kind: templates[id].target_kind,
          definition: templateDefinition(id, version),
        });
  }
  for (let i = 1; i <= itemCount; i++) {
    const h = (i % 2) + 1,
      household_id = fixtureId('household', h),
      actor_id = fixtureId('actor', h),
      id = fixtureId('item', i);
    const container = i <= 20,
      catalog_node_id = fixtureId('catalog_node', h * 100 + (container ? 2 : 1));
    // Ten-deep chains in both households; subsequent physical goods sit under the leaf container.
    const parent_id =
      i <= 2 ? null : container ? fixtureId('item', i - 2) : fixtureId('item', h === 1 ? 20 : 19);
    s.items.push({
      id,
      household_id,
      catalog_node_id,
      parent_id,
      display_name: container
        ? `收纳第${Math.ceil(i / 2)}层`
        : i % 7 === 0
          ? `自己的牛奶 ${i}`
          : null,
      revision: 10,
      created_at: created,
      attributes: container
        ? [bind('container', { can_contain: true })]
        : [
            bind('lifecycle', {
              state: 'ACTIVE',
              expiry: { date: '2026-12-01', date_kind: 'USE_BY' },
            }),
            bind('contents', { remaining: { value: '500', unit: 'mL' }, accuracy: 'MEASURED' }),
          ],
    });
    s.notes.push({
      id: fixtureId('note', i),
      household_id,
      item_id: id,
      created_by: actor_id,
      title: null,
      body: `合成测试笔记 ${i} 牛奶 USB-C，不来自生产数据。`,
    });
    for (let j = 0; j < 10; j++) {
      const n = (i - 1) * 10 + j + 1,
        operation_id = fixtureId('operation', n),
        at = new Date(Date.parse(created) + j * 86400000).toISOString();
      const changes =
        j === 0
          ? [
              { path: 'catalog_node_id', after: catalog_node_id },
              { path: 'display_name', after: s.items.at(-1)!.display_name },
            ]
          : [
              {
                path: `notes.${fixtureId('note', i)}.body`,
                before: '合成旧记录',
                after: '合成新记录',
              },
            ];
      s.events.push({
        id: fixtureId('event', n),
        household_id,
        target_kind: 'ITEM',
        target_id: id,
        operation_id,
        actor_id,
        before_revision: j,
        after_revision: j + 1,
        recorded_at: at,
        occurred_at: at,
        event_type: j === 0 ? 'CREATE' : 'NOTE_UPDATE',
        source: 'TEST',
        changes,
      });
      s.operations.push({
        household_id,
        actor_id,
        idempotency_key: `batch0-${n}`,
        result_operation_id: operation_id,
        fingerprint: `synthetic-${n}`,
        fingerprint_format: 'unified_v1',
        result: {
          operation_id,
          changed: true,
          affected_objects: [{ kind: 'ITEM', id, before_revision: j, after_revision: j + 1 }],
          event_ids: [fixtureId('event', n)],
        },
      });
    }
  }
  return s;
}
