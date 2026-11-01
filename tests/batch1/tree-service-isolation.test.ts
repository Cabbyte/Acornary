import { afterAll, describe, expect, it } from 'vitest';
import { pool, query } from '../../apps/server/src/db.js';
import { assertWriteIsolation } from '../../apps/server/src/service.js';

const enabled = Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)('Batch 1 write isolation guard', () => {
  afterAll(() => pool.end());

  it('accepts READ COMMITTED and rejects REPEATABLE READ writes', async () => {
    if (!process.env.DATABASE_URL!.includes('acornary_test'))
      throw new Error('Use an isolated acornary_test database.');
    const c = await pool.connect();
    try {
      await query(c, 'BEGIN');
      await assertWriteIsolation(c);
      await query(c, 'ROLLBACK');

      await query(c, 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      await expect(assertWriteIsolation(c)).rejects.toMatchObject({
        code: 'UNSUPPORTED_WRITE_ISOLATION',
      });
    } finally {
      await query(c, 'ROLLBACK');
      c.release();
    }
  });
});
