// Test-only RPC surface: never include this module in a deployment entrypoint.
import { DurableObject } from 'cloudflare:workers';
import { HouseholdKernel } from '../../apps/cloudflare/src/household-kernel.js';
export class TestHousehold extends DurableObject {
  private kernel = new HouseholdKernel(this.ctx.storage);
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.kernel.migrate();
  }
  seed(id: string) {
    this.kernel.initialize(id);
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO household_members VALUES('member','user','actor')",
    );
    this.ctx.storage.sql.exec('UPDATE cf_household SET writable=1');
    this.ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS stock(id TEXT PRIMARY KEY, amount INTEGER NOT NULL)',
    );
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO stock VALUES('item',10)");
  }
  revoke() {
    this.ctx.storage.sql.exec('DELETE FROM household_members');
  }
  consume(id: string, key: string, amount: number, fail = false) {
    return this.kernel.command(
      { householdId: id, userId: 'user', membershipId: 'member' },
      { key, fingerprint: String(amount) },
      () => {
        const row = this.ctx.storage.sql
          .exec<{ amount: number }>(
            "UPDATE stock SET amount=amount-? WHERE id='item' AND amount>=? RETURNING amount",
            amount,
            amount,
          )
          .toArray()[0];
        if (!row) throw new Error('INSUFFICIENT_CONTENT');
        this.kernel.enqueue(key, 'test', { amount }, new Date().toISOString());
        if (fail) throw new Error('Injected failure');
        return { amount: row.amount };
      },
    );
  }
  inspect() {
    return {
      amount: this.ctx.storage.sql.exec<{ amount: number }>('SELECT amount FROM stock').one()
        .amount,
      receipts: this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) n FROM operations').one()
        .n,
      outbox: this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) n FROM cf_outbox').one().n,
    };
  }
  largeReceipt(id: string, key: string, characters: number, rejectReceipt = false) {
    if (rejectReceipt)
      this.ctx.storage.sql.exec(
        `CREATE TRIGGER reject_receipt BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'Injected receipt failure'); END`,
      );
    try {
      return this.kernel.command(
        { householdId: id, userId: 'user', membershipId: 'member' },
        { key, fingerprint: String(characters) },
        () => {
          this.ctx.storage.sql.exec("UPDATE stock SET amount=amount-1 WHERE id='item'");
          this.kernel.enqueue(key, 'test', {}, new Date().toISOString());
          return { text: '松'.repeat(characters) };
        },
      );
    } finally {
      if (rejectReceipt) this.ctx.storage.sql.exec('DROP TRIGGER reject_receipt');
    }
  }
  payloadStats() {
    return {
      payloads: this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) n FROM cf_payloads').one()
        .n,
      chunks: this.ctx.storage.sql
        .exec<{ n: number }>('SELECT count(*) n FROM cf_payload_chunks')
        .one().n,
    };
  }
  upgradeV1() {
    this.ctx.storage.sql
      .exec(`DROP TABLE operations;DROP TABLE cf_payload_chunks;DROP TABLE cf_payloads;
      CREATE TABLE operations(actor_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),PRIMARY KEY(actor_id,idempotency_key));
      INSERT INTO operations VALUES('actor','old-receipt','2','{"amount":8}');
      UPDATE stock SET amount=8;UPDATE cf_schema SET version=1`);
    this.kernel.migrate();
    return this.ctx.storage.sql.exec<{ version: number }>('SELECT version FROM cf_schema').one()
      .version;
  }
}
export default {
  async fetch(request: Request, env: { HOUSEHOLDS: DurableObjectNamespace<TestHousehold> }) {
    const { route, method, args } = (await request.json()) as {
      route: string;
      method: string;
      args: any[];
    };
    const stub = env.HOUSEHOLDS.getByName(route);
    try {
      let value;
      switch (method) {
        case 'seed':
          value = await stub.seed(args[0]);
          break;
        case 'revoke':
          value = await stub.revoke();
          break;
        case 'consume':
          value = await stub.consume(args[0], args[1], args[2], args[3]);
          break;
        case 'inspect':
          value = await stub.inspect();
          break;
        case 'largeReceipt':
          value = await stub.largeReceipt(args[0], args[1], args[2], args[3]);
          break;
        case 'payloadStats':
          value = await stub.payloadStats();
          break;
        case 'upgradeV1':
          value = await stub.upgradeV1();
          break;
        default:
          return new Response('Unknown test action', { status: 400 });
      }
      return Response.json(value ?? null);
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
