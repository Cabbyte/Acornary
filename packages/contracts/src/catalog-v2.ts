import { z } from 'zod';
import { quantitySchema } from './units.js';
const text = z.string().min(1).max(500);
export const clothingV2 = {
  target_kind: 'CATALOG_NODE',
  paths: ['material', 'color', 'size', 'care'],
  schema: z.strictObject({
    material: text.optional(),
    color: text.optional(),
    size: z
      .strictObject({
        system: text.optional(),
        label: text,
        measurements: z.record(z.string().min(1).max(50), quantitySchema).optional(),
      })
      .optional(),
    care: z
      .strictObject({
        washing: text.optional(),
        drying: text.optional(),
        ironing: text.optional(),
        note: text.optional(),
      })
      .optional(),
  }),
} as const;
export const deviceV2 = {
  target_kind: 'CATALOG_NODE',
  paths: ['connector', 'electrical'],
  schema: z.strictObject({
    connector: z
      .array(
        z.strictObject({
          type: text,
          count: z.int().positive().optional(),
          role: z.enum(['INPUT', 'OUTPUT', 'BIDIRECTIONAL']).optional(),
        }),
      )
      .max(32)
      .optional(),
    electrical: z
      .strictObject({
        rated_power: quantitySchema.optional(),
        voltage: quantitySchema.optional(),
        energy: quantitySchema.optional(),
      })
      .optional(),
  }),
} as const;
export const contentsV2 = {
  target_kind: 'ITEM',
  paths: ['remaining', 'accuracy'],
  schema: z.strictObject({
    remaining: quantitySchema.optional(),
    accuracy: z.enum(['ESTIMATED', 'MEASURED']).optional(),
  }),
} as const;
