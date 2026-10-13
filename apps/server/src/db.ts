import pg from 'pg';
import { timed } from './telemetry.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: process.env.ACORNARY_MODE === 'cloud' ? 5 : 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  idle_in_transaction_session_timeout: 15000,
});
export type Client = pg.PoolClient;
// SQL remains explicit; every $n value becomes a bound Drizzle parameter.
export async function query<T = any>(
  client: pg.Pool | Client,
  text: string,
  values: unknown[] = [],
  measure = true,
): Promise<{ rows: T[]; rowCount: number | null }> {
  if (client instanceof pg.Pool) {
    const c = await timed('pool_wait_ms', () => client.connect());
    try {
      return await query<T>(c, text, values, measure);
    } finally {
      c.release();
    }
  }
  const chunks = text.split(/\$(\d+)/);
  const statement = sql.empty();
  chunks.forEach((chunk, i) =>
    statement.append(i % 2 ? sql`${sql.param(values[Number(chunk) - 1])}` : sql.raw(chunk)),
  );
  const run = () => drizzle(client).execute(statement);
  return (await (measure ? timed('db_ms', run) : run())) as any;
}
export async function transaction<T>(fn: (client: Client) => Promise<T>) {
  const c = await timed('pool_wait_ms', () => pool.connect());
  try {
    await timed('db_ms', () => c.query('BEGIN'));
    const result = await fn(c);
    await timed('db_ms', () => c.query('COMMIT'));
    return result;
  } catch (e) {
    await timed('db_ms', () => c.query('ROLLBACK'));
    throw e;
  } finally {
    c.release();
  }
}
