import { z } from 'zod';
import { entityId } from './ids.js';
import { decimalQuantity, unitSchema } from './units.js';
const text = z.string().min(1).max(500);
const note = z.string().max(100000);
export const referenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ACTOR'), id: entityId('actor') }),
  z.strictObject({ kind: z.literal('ITEM'), id: entityId('item') }),
  z.strictObject({ kind: z.literal('CATALOG_NODE'), id: entityId('catalog_node') }),
  z.strictObject({ kind: z.literal('EXTERNAL'), name: text.refine((v) => /\S/.test(v)) }),
]);
export type Reference = z.infer<typeof referenceSchema>;
export const dispositionSchema = z
  .strictObject({
    kind: z.enum(['SALE', 'GIFT', 'DONATION', 'RETURN', 'DISCARD']),
    date: z.iso.date(),
    recipient: referenceSchema.optional(),
    recipient_name: text.optional(),
    note: note.optional(),
  })
  .refine((v) => !(v.recipient && v.recipient_name), 'Choose recipient or recipient_name.');
export const semanticsTemplates = {
  usage: {
    target_kind: 'ITEM',
    paths: ['state'],
    schema: z.strictObject({ state: z.enum(['IDLE', 'IN_USE']).optional() }),
  },
  custody: {
    target_kind: 'ITEM',
    paths: ['owner', 'holder', 'since', 'status', 'note'],
    schema: z.strictObject({
      owner: referenceSchema.optional(),
      holder: referenceSchema.optional(),
      since: z.iso.date().optional(),
      status: z.enum(['OWNED', 'LOANED_OUT', 'BORROWED_IN']).optional(),
      note: note.optional(),
    }),
  },
  transport: {
    target_kind: 'ITEM',
    paths: ['state', 'expected_on'],
    schema: z.strictObject({
      state: z.enum(['IN_TRANSIT', 'AT_DESTINATION']).optional(),
      expected_on: z.iso.date().optional(),
    }),
  },
  wardrobe: {
    target_kind: 'ITEM',
    paths: ['owner', 'size_override', 'season', 'care_state'],
    schema: z.strictObject({
      owner: referenceSchema.optional(),
      size_override: text.optional(),
      season: z
        .array(z.enum(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER', 'ALL']))
        .max(5)
        .optional(),
      care_state: z.enum(['CLEAN', 'DIRTY', 'REPAIR']).optional(),
    }),
  },
  asset: {
    target_kind: 'ITEM',
    paths: ['serial_no', 'imei', 'mac', 'price', 'vendor', 'manual_url'],
    schema: z.strictObject({
      serial_no: text.optional(),
      imei: text.optional(),
      mac: text.optional(),
      price: z
        .strictObject({ amount: decimalQuantity, currency: z.string().regex(/^[A-Z]{3}$/) })
        .optional(),
      vendor: text.optional(),
      manual_url: z.url().max(2000).optional(),
    }),
  },
  stock: {
    target_kind: 'CATALOG_NODE',
    paths: ['basis', 'reorder_threshold', 'target', 'content_unit'],
    schema: z.strictObject({
      basis: z.enum(['COUNT', 'CONTENT']),
      reorder_threshold: decimalQuantity.optional(),
      target: decimalQuantity.optional(),
      content_unit: unitSchema.optional(),
    }),
  },
  disposition: {
    target_kind: 'ITEM',
    paths: ['kind', 'date', 'recipient', 'recipient_name', 'note'],
    schema: dispositionSchema,
  },
} as const;
export type SplitInfo = {
  split_id: string;
  source_item_id: string;
  child_item_ids: string[];
  count: number;
  created_at: string;
};
export type StockStatus = {
  catalog_node_id: string;
  name: string;
  profile: string | null;
  basis: 'COUNT' | 'CONTENT';
  unit: string;
  threshold: string | null;
  target: string | null;
  current_count: number | null;
  current_content: string | null;
  unknown_count: number;
  low: boolean | null;
  gap: string | null;
};
export function derivedAvailability(sets: Record<string, any>): 'AVAILABLE' | 'UNAVAILABLE' | null {
  if (
    ['CONSUMED', 'DISPOSED', 'LOST', 'ARCHIVED'].includes(sets.lifecycle?.state) ||
    ['BROKEN', 'DAMAGED'].includes(sets.lifecycle?.condition) ||
    sets.usage?.state === 'IN_USE' ||
    sets.custody?.status === 'LOANED_OUT' ||
    ['CLEANING', 'REPAIR', 'MAINTENANCE'].includes(sets.service?.state) ||
    sets.transport?.state === 'IN_TRANSIT'
  )
    return 'UNAVAILABLE';
  return sets.lifecycle?.state === 'ACTIVE' &&
    ['NEW', 'GOOD', 'WORN'].includes(sets.lifecycle?.condition) &&
    sets.usage?.state === 'IDLE' &&
    ['OWNED', 'BORROWED_IN'].includes(sets.custody?.status) &&
    sets.custody?.holder &&
    sets.service?.state === 'NONE' &&
    sets.transport?.state === 'AT_DESTINATION'
    ? 'AVAILABLE'
    : null;
}

export type UsageValues = z.infer<typeof semanticsTemplates.usage.schema>;
export type CustodyValues = z.infer<typeof semanticsTemplates.custody.schema>;
export type TransportValues = z.infer<typeof semanticsTemplates.transport.schema>;
export type WardrobeValues = z.infer<typeof semanticsTemplates.wardrobe.schema>;
export type AssetValues = z.infer<typeof semanticsTemplates.asset.schema>;
export type StockValues = z.infer<typeof semanticsTemplates.stock.schema>;
export type DispositionValues = z.infer<typeof dispositionSchema>;
export type ServiceValues = z.infer<typeof import('./deadline.js').deadlineServiceTemplate.schema>;
