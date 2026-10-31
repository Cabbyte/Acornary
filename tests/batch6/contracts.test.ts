import { describe, it, expect } from 'vitest';
import { normalizeQuantity } from '../../packages/contracts/src/units.js';
import { derivedAvailability, referenceSchema } from '../../packages/contracts/src/semantics.js';
import {
  validateValues,
  templateDefinition,
  findTemplate,
  canUpgrade,
} from '../../packages/contracts/src/registry.js';

describe('Batch 6 semantic contracts', () => {
  it('MODEL07 normalizes every listed dimension exactly without expanding old measurement versions', () => {
    for (const [value, unit, expected, canonical] of [
      ['1.5', 'kg', '1500', 'g'],
      ['0.1', 'mg', '0.0001', 'g'],
      ['1.25', 'L', '1250', 'mL'],
      ['0.1', 'in', '2.54', 'mm'],
      ['1', 'cm', '10', 'mm'],
      ['1', 'm', '1000', 'mm'],
      ['0.2', 'kWh', '200', 'Wh'],
      ['12', 'V', '12', 'V'],
      ['23.4', 'W', '23.4', 'W'],
      [
        '123456789012345678901234567890.123456789',
        'kg',
        '123456789012345678901234567890123.456789',
        'g',
      ],
    ])
      expect(normalizeQuantity({ value, unit: unit as any })).toEqual({
        value: expected,
        unit: canonical,
      });
    expect(() => normalizeQuantity({ value: '1', unit: 'W' }, ['volume'])).toThrow();
    expect(() => normalizeQuantity({ value: '1.5', unit: 'count' })).toThrow();
    expect(() => normalizeQuantity({ value: '101', unit: 'percent' })).toThrow();
    expect(() => validateValues('contents', { remaining: { value: '1', unit: 'L' } }, 1)).toThrow();
    expect(validateValues('contents', { remaining: { value: '1', unit: 'L' } }, 2)).toEqual({
      remaining: { value: '1000', unit: 'mL' },
    });
  });
  it('MODEL04/07/08 strict templates keep deadline dates out and reject invalid stock', () => {
    for (const [name, values] of [
      ['custody', { due_on: '2026-01-01' }],
      ['service', { next_service_on: '2026-01-01' }],
      ['asset', { warranty_until: '2026-01-01' }],
      ['asset', { purchased_on: '2026-01-01' }],
    ])
      expect(() => validateValues(name as string, values)).toThrow();
    expect(() => validateValues('stock', { basis: 'CONTENT' })).toThrow();
    expect(() => validateValues('stock', { basis: 'CONTENT', content_unit: 'percent' })).toThrow();
    expect(() =>
      validateValues('stock', { basis: 'COUNT', reorder_threshold: '2', target: '1' }),
    ).toThrow();
    expect(() => validateValues('stock', { basis: 'COUNT', target: '1.5' })).toThrow();
    expect(
      validateValues('stock', {
        basis: 'CONTENT',
        content_unit: 'L',
        reorder_threshold: '1.5',
        target: '2',
      }),
    ).toEqual({ basis: 'CONTENT', content_unit: 'mL', reorder_threshold: '1500', target: '2000' });
    expect(
      validateValues('asset', { price: { amount: '3999', currency: 'CNY' }, serial_no: 'SN1' }),
    ).toMatchObject({ price: { amount: '3999', currency: 'CNY' } });
    expect(findTemplate('lifecycle', 2)).toBeUndefined();
  });
  it('MODEL11 explicit upgrades reject old unstructured values and wrong dimensions', () => {
    expect(canUpgrade('clothing', 1, 2)).toBe(true);
    expect(canUpgrade('device', 1, 2)).toBe(true);
    expect(() => validateValues('clothing', { size: 'L' }, 2)).toThrow();
    expect(() => validateValues('device', { connector: 'USB' }, 2)).toThrow();
    expect(() =>
      validateValues('device', { electrical: { voltage: { value: '1', unit: 'W' } } }, 2),
    ).toThrow();
    expect(
      validateValues(
        'clothing',
        {
          size: { label: 'L', system: 'US', measurements: { chest: { value: '40', unit: 'in' } } },
          care: { washing: 'cold' },
        },
        2,
      ).size.measurements.chest,
    ).toEqual({ value: '1016', unit: 'mm' });
    expect(templateDefinition('custody').fields.find((f) => f.path === 'holder')?.type).toBe(
      'reference',
    );
    expect(
      templateDefinition('asset').fields.find((f) => f.path === 'serial_no')?.sensitivity,
    ).toBe('SENSITIVE');
  });
  it('MODEL14 typed external names and MODEL15 conservative independent facts', () => {
    expect(referenceSchema.safeParse({ kind: 'EXTERNAL', name: 'Neighbor' }).success).toBe(true);
    expect(
      referenceSchema.safeParse({ kind: 'EXTERNAL', name: 'Neighbor', id: 'fake' }).success,
    ).toBe(false);
    expect(derivedAvailability({ lifecycle: { availability: 'AVAILABLE' } })).toBeNull();
    expect(derivedAvailability({ lifecycle: { availability: 'LOANED' } })).toBeNull();
    expect(derivedAvailability({ usage: { state: 'IDLE' } })).toBeNull();
    expect(derivedAvailability({ service: { state: 'CLEANING' } })).toBe('UNAVAILABLE');
    expect(derivedAvailability({ transport: { state: 'IN_TRANSIT' } })).toBe('UNAVAILABLE');
  });
});
