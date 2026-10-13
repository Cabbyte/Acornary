import { z } from 'zod';
import { entityId } from './ids.js';

const name = z
  .string()
  .min(1)
  .max(500)
  .refine((s) => /\S/.test(s), 'Name must not be blank.');
const catalogId = entityId('catalog_node');
const itemId = entityId('item');
export const revisionMap = z.record(z.union([catalogId, itemId]), z.int().positive());
export const intakeAttribute = z.strictObject({
  template_id: z.enum([
    'product',
    'lifecycle',
    'contents',
    'container',
    'catalog',
    'clothing',
    'device',
  ]),
  template_version: z.literal(1),
  values: z.record(z.string(), z.unknown()),
});
const attributes = z.array(intakeAttribute).max(7);
export const catalogRuleSchema = z.strictObject({
  branch_id: catalogId,
  standard_name: name.optional(),
  meaning: name,
  boundaries: name,
  subdivision_basis: name,
  allow_direct_products: z.boolean(),
  allow_new_groups: z.boolean(),
  max_new_depth: z.int().min(0).max(4),
  naming_guidance: name,
  name_max_length: z.int().min(1).max(500).default(100),
  forbid_location_names: z.boolean().default(true),
  forbid_measurement_names: z.boolean().default(true),
  forbidden_names: z.array(name).max(100).default(['其他', '未分类']),
  aliases: z
    .array(z.strictObject({ name, catalog_node_id: catalogId }))
    .max(200)
    .default([]),
  identity_fields: z
    .array(
      z.enum([
        'product.brand',
        'product.model',
        'product.specification',
        'product.net_content',
        'clothing.material',
        'clothing.color',
        'clothing.size',
        'device.connector',
        'device.rated_power_w',
      ]),
    )
    .max(9)
    .default([
      'product.brand',
      'product.model',
      'product.specification',
      'product.net_content',
      'clothing.material',
      'clothing.color',
      'clothing.size',
      'device.connector',
      'device.rated_power_w',
    ]),
  legacy_exceptions: z.array(catalogId).max(200).default([]),
});
const defaults = z.strictObject({
  parent_id: itemId.nullable().optional(),
  initial_attributes: attributes.optional(),
});
export const newIntakeProduct = z.strictObject({
  name,
  parent_id: catalogId.nullable(),
  initial_attributes: attributes.optional(),
  new_groups: z.array(name).max(4).default([]),
  classification_reason: name,
});
export const intakeBodySchema = z
  .strictObject({
    policy_revision: z.int().nonnegative(),
    expected_revisions: revisionMap,
    defaults: defaults.optional(),
    lines: z
      .array(
        z.strictObject({
          product: z.union([z.strictObject({ catalog_node_id: catalogId }), newIntakeProduct]),
          instances: z
            .array(
              z.strictObject({
                count: z.int().min(1).max(100),
                parent_id: itemId.nullable().optional(),
                display_name: name.optional(),
                initial_attributes: attributes.optional(),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (body) =>
      body.lines.reduce((n, l) => n + l.instances.reduce((m, i) => m + i.count, 0), 0) <= 100,
    'A task may contain at most 100 physical items. Agree on separate tasks before splitting.',
  );
export const catalogProposalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('policy'),
    policy_revision: z.int().nonnegative(),
    expected_revisions: revisionMap,
    rule: catalogRuleSchema,
    reason: name,
  }),
  z.strictObject({ kind: z.literal('intake_exception'), intake: intakeBodySchema, reason: name }),
  z.strictObject({
    kind: z.literal('catalog_command'),
    operation: z.enum([
      'create_catalog_node',
      'update_catalog_node',
      'move_catalog_node',
      'bind_attributes',
      'update_attributes',
      'remove_attributes',
      'correct_item',
    ]),
    input: z.record(z.string(), z.unknown()),
    reason: name,
  }),
]);
export const intakeSchemas = {
  get_intake_context: z.strictObject({
    names: z.array(name).max(100).default([]),
    location_names: z.array(name).max(100).default([]),
    category_names: z.array(name).max(100).default([]),
    barcodes: z.array(z.string().min(1).max(128)).max(100).default([]),
    catalog_node_ids: z.array(catalogId).max(100).default([]),
    location_ids: z.array(itemId).max(100).default([]),
    limit: z.int().min(1).max(200).default(30),
    cursor: z.int().nonnegative().default(0),
  }),
  commit_intake: intakeBodySchema.safeExtend({
    idempotency_key: z.string().min(1).max(200),
    approval_id: z.uuid().optional(),
    occurred_at: z.iso.datetime({ offset: true }).optional(),
  }),
  get_intake_receipt: z
    .strictObject({
      operation_id: entityId('operation').optional(),
      idempotency_key: z.string().min(1).max(200).optional(),
    })
    .refine(
      (v) => !!v.operation_id !== !!v.idempotency_key,
      'Supply exactly one receipt identifier.',
    ),
  get_catalog_policy: z.strictObject({
    branch_id: catalogId.optional(),
    revision: z.int().positive().optional(),
  }),
  propose_catalog_change: z.strictObject({
    idempotency_key: z.string().min(1).max(200),
    proposal: catalogProposalSchema,
  }),
};
export const catalogReviewSchema = z.strictObject({ proposal_id: z.uuid() });
export const catalogConfirmSchema = catalogReviewSchema.extend({
  challenge: z.string().min(32).max(200),
});
export type CatalogRule = z.infer<typeof catalogRuleSchema>;
export type IntakeBody = z.infer<typeof intakeBodySchema>;
export type CatalogProposal = z.infer<typeof catalogProposalSchema>;
