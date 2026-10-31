import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { DomainError } from '../../domain/src/index.js';

// Isolated precision: all accepted inputs have at most 80 digits.
export const QuantityDecimal = Decimal.clone({ precision: 200 });
export const decimalQuantity = z
  .string()
  .max(80)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/);
export const unitRegistry = {
  mg: ['mass', 'g', '0.001'],
  g: ['mass', 'g', '1'],
  kg: ['mass', 'g', '1000'],
  mL: ['volume', 'mL', '1'],
  L: ['volume', 'mL', '1000'],
  mm: ['length', 'mm', '1'],
  cm: ['length', 'mm', '10'],
  m: ['length', 'mm', '1000'],
  in: ['length', 'mm', '25.4'],
  W: ['power', 'W', '1'],
  Wh: ['energy', 'Wh', '1'],
  kWh: ['energy', 'Wh', '1000'],
  V: ['voltage', 'V', '1'],
  count: ['count', 'count', '1'],
  percent: ['percent', 'percent', '1'],
} as const;
export type Unit = keyof typeof unitRegistry;
export type Dimension = (typeof unitRegistry)[Unit][0];
export const unitSchema = z.enum(Object.keys(unitRegistry) as [Unit, ...Unit[]]);
export const quantitySchema = z.strictObject({ value: decimalQuantity, unit: unitSchema });
export type Quantity = z.infer<typeof quantitySchema>;
export function normalizeQuantity(input: Quantity, dimensions?: readonly Dimension[]): Quantity {
  const parsed = quantitySchema.safeParse(input);
  if (!parsed.success) throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid quantity.');
  const [dimension, canonical, factor] = unitRegistry[input.unit];
  const value = new QuantityDecimal(input.value);
  if (
    (dimensions && !dimensions.includes(dimension)) ||
    (dimension === 'count' && !value.isInteger()) ||
    (dimension === 'percent' && value.gt(100))
  )
    throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid quantity dimension or range.');
  return { value: value.times(factor).toFixed(), unit: canonical };
}
