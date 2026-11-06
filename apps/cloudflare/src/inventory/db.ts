import { SqlitePayloads, inlineReceiptBytes } from '../sqlite-payloads.js';
import { householdSchema, householdSchemaVersion, columnTypes } from './schema.js';
import { DomainError } from '../../../../packages/domain/src/index.js';

const jsonColumns = new Set(
  Object.values(columnTypes).flatMap((columns) =>
    Object.entries(columns)
      .filter(([, t]) => t === 'jsonb' || t === '_text')
      .map(([n]) => n),
  ),
);
for (const name of ['target', 'split', 'dates']) jsonColumns.add(name);
const boolColumns = new Set(
  Object.values(columnTypes).flatMap((columns) =>
    Object.entries(columns)
      .filter(([, t]) => t === 'bool')
      .map(([n]) => n),
  ),
);
boolColumns.add('archived');
export function binding(value: unknown): SqlStorageValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('Unsupported SQL binding');
}
export class NativeDatabase {
  private depth = 0;
  readonly payloads: SqlitePayloads;
  constructor(readonly storage: DurableObjectStorage) {
    this.payloads = new SqlitePayloads(storage.sql);
  }
  initialize() {
    this.transaction(() => {
      this.payloads.createSchema();
      this.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS cf_inventory_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)',
      );
      const version =
        this.storage.sql
          .exec<{ version: number }>('SELECT version FROM cf_inventory_schema WHERE singleton=1')
          .toArray()[0]?.version ?? 0;
      if (version === 0) {
        this.storage.sql.exec(householdSchema);
        this.storage.sql.exec(
          'INSERT INTO cf_inventory_schema VALUES(1,?)',
          householdSchemaVersion,
        );
      } else if (version !== householdSchemaVersion)
        throw new Error('Unsupported household schema; business access is blocked');
    });
  }
  transaction<T>(fn: (db: NativeDatabase) => T): T {
    if (this.depth) return fn(this);
    return this.storage.transactionSync(() => {
      this.depth++;
      try {
        const result = fn(this);
        if (result && typeof (result as any).then === 'function')
          throw new Error('Household transactions must be synchronous');
        return result;
      } finally {
        this.depth--;
      }
    });
  }
  get inTransaction() {
    return this.depth > 0;
  }
  query<T = any>(text: string, values: unknown[] = []): { rows: T[]; rowCount: number } {
    const cursor = this.storage.sql.exec(text, ...values.map(binding));
    const rows = cursor.toArray().map((raw) => {
      const row: any = { ...raw };
      for (const [key, value] of Object.entries(row)) {
        if (value !== null && jsonColumns.has(key)) row[key] = JSON.parse(value as string);
        else if (value !== null && boolColumns.has(key)) row[key] = Boolean(value);
      }
      if (row.result_payload) row.result = JSON.parse(this.payloads.get(row.result_payload));
      return row as T;
    });
    const rowCount = cursor.rowsWritten
      ? this.storage.sql.exec<{ n: number }>('SELECT changes() AS n').one().n
      : rows.length;
    return { rows, rowCount };
  }
  saveOperation(household: string, actor: string, key: string, fingerprint: string, result: any) {
    if (!this.inTransaction) throw new Error('Operation receipts require an inventory transaction');
    const json = JSON.stringify(result),
      bytes = new TextEncoder().encode(json);
    if (!/^operation_[0-9a-f-]{36}$/.test(result.operation_id))
      throw new Error('Invalid operation receipt');
    const payload = bytes.byteLength > inlineReceiptBytes ? this.payloads.put(bytes) : null;
    this.query(
      'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result,operation_id,result_payload) VALUES(?1,?2,?3,?4,?5,?6,?7)',
      [household, actor, key, fingerprint, payload ? null : json, result.operation_id, payload],
    );
  }
}
export type Client = NativeDatabase;
export const query = <T = any>(
  client: Client,
  text: string,
  values: unknown[] = [],
  _measure = true,
) => client.query<T>(text, values);
export const transaction = <T>(db: NativeDatabase, fn: (client: Client) => T) => db.transaction(fn);
export function requireTransaction(db: NativeDatabase) {
  if (!db.inTransaction)
    throw new DomainError('UNSUPPORTED_WRITE_ISOLATION', 'Writes require a household transaction.');
}

export { utcTimestamp } from './timestamps.js';
