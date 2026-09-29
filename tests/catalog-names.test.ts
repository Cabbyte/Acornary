import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { schemas } from '../packages/contracts/src/index.js';

for (const operation of ['create_catalog_node', 'update_catalog_node'] as const) {
  const input = {
    idempotency_key: 'catalog-name-contract',
    ...(operation === 'create_catalog_node'
      ? { kind: 'SKU' }
      : { catalog_node_id: 'catalog_node_11111111-1111-4111-8111-000000000001' }),
  };

  describe(operation, () => {
    it('preserves valid names verbatim, including whitespace and the length limit', () => {
      for (const name of [
        '冰淇淋',
        '冰',
        'ice cream',
        'USB-C 充电器',
        '  冰淇淋  ',
        '\n冰淇淋\n',
        '冰'.repeat(500),
      ]) {
        expect(schemas[operation].parse({ ...input, name }).name).toBe(name);
      }
    });

    it('rejects empty, whitespace-only and oversized names', () => {
      for (const name of ['', '   ', '\t\n', '\u3000', '\u00a0', '冰'.repeat(501)]) {
        expect(schemas[operation].safeParse({ ...input, name }).success).toBe(false);
      }
    });

    it('exports a bounded string without a connector-dependent regular expression', () => {
      const schema = z.toJSONSchema(schemas[operation], { io: 'input' });
      expect(schema.properties?.name).toEqual({ type: 'string', minLength: 1, maxLength: 500 });
    });
  });
}
