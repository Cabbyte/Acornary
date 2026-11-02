import { describe, expect, it } from 'vitest';
import { repairIntakeLocation } from '../apps/web/src/features/writes/intake-draft.js';

const category = 'catalog_node_category';
const draft = () => ({
  values: { parent: category, quantity: '425' },
  original: { parent: category, quantity: '' },
  revisions: { catalog_node_product: 4 },
  idempotencyKey: 'existing-intake-key',
});

describe('legacy intake location recovery', () => {
  it('repairs the inherited category without losing user input or the retry identity', () => {
    const input = draft();
    expect(repairIntakeLocation(input, category)).toEqual({
      ...input,
      values: { parent: '', quantity: '425' },
      original: { parent: '', quantity: '' },
    });
    expect(input.values.parent).toBe(category);
  });

  it('preserves an explicitly chosen physical location', () => {
    const input = { ...draft(), values: { parent: 'item_cupboard', quantity: '425' } };
    expect(repairIntakeLocation(input, category)).toBe(input);
  });

  it.each(['attempt', 'result'] as const)('never changes a draft with a saved %s', (field) => {
    const input = { ...draft(), [field]: { idempotency_key: 'same-operation' } };
    expect(repairIntakeLocation(input, category)).toBe(input);
  });

  it('does not reinterpret unrelated draft values as category inheritance', () => {
    const input = { ...draft(), original: { parent: '', quantity: '' } };
    expect(repairIntakeLocation(input, category)).toBe(input);
    expect(repairIntakeLocation(draft(), null).values.parent).toBe(category);
  });
});
