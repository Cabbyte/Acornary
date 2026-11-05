import { DomainError } from '../../../packages/domain/src/index.js';

/** All methods here run synchronously inside a SQLite-backed DO transaction. */
export class HouseholdKernel {
  constructor(private readonly storage: DurableObjectStorage) {}

  migrate() {
    this.storage.transactionSync(() => {
      this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS cf_schema(version INTEGER NOT NULL)`);
      const current = this.storage.sql.exec<{ version: number }>('SELECT version FROM cf_schema').toArray();
      if (current.length && current[0].version !== 1) throw new Error('Unsupported household schema');
      this.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS cf_household(id TEXT PRIMARY KEY, writable INTEGER NOT NULL CHECK(writable IN (0,1)));
        CREATE TABLE IF NOT EXISTS household_members(id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL UNIQUE);
        CREATE TABLE IF NOT EXISTS operations(actor_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),PRIMARY KEY(actor_id,idempotency_key));
        CREATE TABLE IF NOT EXISTS cf_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),created_at TEXT NOT NULL);
      `);
      if (!current.length) this.storage.sql.exec('INSERT INTO cf_schema VALUES(1)');
    });
  }

  initialize(householdId: string) {
    this.storage.transactionSync(() => {
      const rows = this.storage.sql.exec<{ id: string }>('SELECT id FROM cf_household').toArray();
      if (rows.length && rows[0].id !== householdId) throw new Error('Household identity mismatch');
      if (!rows.length) this.storage.sql.exec('INSERT INTO cf_household VALUES(?,0)', householdId);
    });
  }

  /** Called only with server-verified identity. Membership is checked before replay. */
  command<T>(identity: { householdId: string; userId: string; membershipId: string },
    input: { key: string; fingerprint: string }, apply: (actorId: string) => T): T {
    return this.storage.transactionSync(() => {
      const household = this.storage.sql.exec<{ id: string; writable: number }>('SELECT * FROM cf_household').toArray()[0];
      if (!household || household.id !== identity.householdId) throw new DomainError('FORBIDDEN', 'Invalid household');
      const member = this.storage.sql.exec<{ actor_id: string }>(
        'SELECT actor_id FROM household_members WHERE user_id=? AND id=?', identity.userId, identity.membershipId,
      ).toArray()[0];
      if (!member) throw new DomainError('FORBIDDEN', 'Membership revoked');
      if (!household.writable) throw new DomainError('STATE_CONFLICT', 'Household is in maintenance');
      const old = this.storage.sql.exec<{ fingerprint: string; result: string }>(
        'SELECT fingerprint,result FROM operations WHERE actor_id=? AND idempotency_key=?', member.actor_id, input.key,
      ).toArray()[0];
      if (old) {
        if (old.fingerprint !== input.fingerprint) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Key was used with different parameters.');
        return JSON.parse(old.result) as T;
      }
      const result = apply(member.actor_id);
      if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('Household commands must be synchronous');
      const encoded = JSON.stringify(result);
      if (encoded === undefined) throw new Error('Command result must be JSON');
      this.storage.sql.exec('INSERT INTO operations VALUES(?,?,?,?)', member.actor_id, input.key, input.fingerprint, encoded);
      return result;
    });
  }

  enqueue(id: string, kind: string, payload: unknown, now: string) {
    this.storage.sql.exec('INSERT INTO cf_outbox VALUES(?,?,?,?)', id, kind, JSON.stringify(payload), now);
  }
}
