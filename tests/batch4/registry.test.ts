import { describe, expect, it } from 'vitest';
import { schemas } from '../../packages/contracts/src/index.js';
import { intakeAttribute } from '../../packages/contracts/src/intake.js';
import {
  registry,
  templates,
  templateId,
  templateDefinition,
  resolveCapabilities,
  canUpgrade,
} from '../../packages/contracts/src/registry.js';
import { definitionHashes } from '../../apps/cloudflare/src/inventory/registry.js';

const itemId = 'item_11111111-1111-4111-8111-000000000001';
describe('Batch 4 registry contracts', () => {
  it('MODEL02 resolves every profile, inheritance, disable and explicit override without mutating defaults', () => {
    const defaults = {
      CONSUMABLE: ['lifecycle.expiry', 'lifecycle.opening', 'contents', 'stock'],
      DURABLE: ['asset', 'custody', 'service', 'deadline'],
      WEARABLE: ['clothing', 'wardrobe', 'asset', 'custody', 'service'],
      SPACE: ['container'],
      MISC: ['asset', 'custody'],
    } as const;
    for (const profile of Object.keys(defaults) as (keyof typeof defaults)[]) {
      expect(resolveCapabilities(profile, null)).toEqual(defaults[profile]);
      expect(resolveCapabilities(profile, [])).toEqual([]);
      expect(resolveCapabilities(profile, ['transport'])).toEqual(['transport']);
    }
    expect(resolveCapabilities(null, null)).toEqual([]);
    expect(resolveCapabilities(null, ['container'])).toEqual(['container']);
    resolveCapabilities('SPACE', null).push('asset');
    expect(resolveCapabilities('SPACE', null)).toEqual(['container']);
  });
  it('MODEL13 freezes published schema hashes independently of UI metadata', () => {
    const frozen = {
      'product@1': 'd0fb7eafa1e10d9860ec22df8d2352554b9f5219a2cfb5edf14f48c05dcc57d8',
      'lifecycle@1': 'c787a895e1655e16976c48035e28674e46f88a227d48b57be4678085bc57d05a',
      'contents@1': '6c241d41aaeb894684cd2648e59a6ca8a21c79a38acd471ef430bbb313e4bbfb',
      'container@1': 'd28f44690c78a519e7eaffd2b97b99f6644e47be929b66d4f67c5a180c3e2f2f',
      'catalog@1': '82b007cfc0548f47a4a28fde11c7ef791493abe3575ce379a59c9ed222a2d6eb',
      'clothing@1': 'bcc7fa5ef06e8856f31c660f4b4eaff8a67e32f60203f47ba26dd47ae43505fc',
      'device@1': '25e26d7d0ee5ffc06da85410275e8e1f30f87de44fa18f03d8c3b6c75a8b86d2',
      'product@2': '2b5f8c8c65f6f34911585c4665478ee4e42220a0bd1d6cd3dcfe2864458c6776',
    };
    for (const [key, expected] of Object.entries(frozen)) {
      const entry = registry.find((t) => `${t.id}@${t.version}` === key)!;
      expect(entry).toBeDefined();
      expect(definitionHashes(templateDefinition(entry.id, entry.version)).schema_hash).toBe(
        expected,
      );
    }
  });

  it('MODEL13 generates write IDs from the registry and accepts positive versions beyond 2', () => {
    expect(templateId.options).toEqual(Object.keys(templates));
    expect(new Set(registry.map((t) => t.id))).toEqual(new Set(templateId.options));
    for (const template_id of templateId.options) {
      expect(
        intakeAttribute.parse({ template_id, template_version: 32, values: {} }).template_version,
      ).toBe(32);
      expect(
        schemas.bind_attributes.safeParse({
          target: { kind: 'ITEM', id: itemId },
          template_id,
          template_version: 32,
          values: {},
          expected_revisions: { [itemId]: 1 },
          idempotency_key: 'positive-version',
        }).success,
      ).toBe(true);
    }
    expect(
      intakeAttribute.safeParse({ template_id: 'unpublished', template_version: 1, values: {} })
        .success,
    ).toBe(false);
    for (const template_version of [0, -1, 1.5])
      expect(
        intakeAttribute.safeParse({ template_id: 'product', template_version, values: {} }).success,
      ).toBe(false);
  });
  it('MODEL13 separates UI hashes from immutable schema hashes and supplies metadata for every path', () => {
    for (const entry of registry) {
      const definition = templateDefinition(entry.id, entry.version);
      expect(definition.fields.map((f) => f.path)).toEqual(definition.paths);
      expect(
        definition.fields.every(
          (f) => f.label && f.section && f.widget && Number.isInteger(f.order),
        ),
      ).toBe(true);
      const original = definitionHashes(definition);
      const ui = structuredClone(definition);
      ui.fields[0].label = 'A new label';
      ui.fields[0].help = 'UI-only help';
      ui.fields[0].unit = 'display-only';
      expect(definitionHashes(ui).schema_hash).toBe(original.schema_hash);
      expect(definitionHashes(ui).ui_hash).not.toBe(original.ui_hash);
      const changed = structuredClone(definition);
      changed.schema = { ...changed.schema, additionalProperties: true };
      expect(definitionHashes(changed).schema_hash).not.toBe(original.schema_hash);
    }
  });
  it('upgrades are registry edges, with the frozen pair and legacy request shape supported', () => {
    expect(canUpgrade('product', 1, 2)).toBe(true);
    for (const [from, to] of [
      [2, 1],
      [1, 3],
      [2, 2],
    ])
      expect(canUpgrade('product', from, to)).toBe(false);
    const base = {
      target: { kind: 'ITEM', id: itemId },
      template_id: 'lifecycle',
      values: {},
      expected_revisions: { [itemId]: 1 },
      idempotency_key: 'upgrade',
    };
    expect(
      schemas.upgrade_attributes.safeParse({ ...base, from_version: 3, to_version: 4 }).success,
    ).toBe(true);
    expect(schemas.upgrade_attributes.safeParse({ ...base, template_version: 2 }).success).toBe(
      true,
    );
    expect(schemas.upgrade_attributes.safeParse({ ...base, from_version: 1 }).success).toBe(false);
    expect(
      schemas.upgrade_attributes.safeParse({
        ...base,
        from_version: 1,
        to_version: 2,
        template_version: 2,
      }).success,
    ).toBe(false);
  });
  it('MODEL13 raises both command and intake binding caps to 16', () => {
    const attribute = {
      template_id: 'lifecycle',
      template_version: 1,
      values: { state: 'ACTIVE' },
    };
    const base = {
      idempotency_key: 'cap',
      expected_revisions: {},
      count: 1,
      catalog_node_id: itemId.replace('item_', 'catalog_node_'),
    };
    expect(
      schemas.create_items.safeParse({ ...base, initial_attributes: Array(16).fill(attribute) })
        .success,
    ).toBe(true);
    expect(
      schemas.create_items.safeParse({ ...base, initial_attributes: Array(17).fill(attribute) })
        .success,
    ).toBe(false);
    const intake = (count: number) => ({
      policy_revision: 0,
      expected_revisions: {},
      idempotency_key: 'intake-cap',
      defaults: { initial_attributes: Array(count).fill(attribute) },
      lines: [{ product: { catalog_node_id: base.catalog_node_id }, instances: [{ count: 1 }] }],
    });
    expect(schemas.commit_intake.safeParse(intake(16)).success).toBe(true);
    expect(schemas.commit_intake.safeParse(intake(17)).success).toBe(false);
  });
});
