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
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO household_members VALUES('member','user','actor')");
    this.ctx.storage.sql.exec('UPDATE cf_household SET writable=1');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS stock(id TEXT PRIMARY KEY, amount INTEGER NOT NULL)');
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO stock VALUES('item',10)");
  }
  revoke() { this.ctx.storage.sql.exec('DELETE FROM household_members'); }
  consume(id: string, key: string, amount: number, fail = false) {
    return this.kernel.command({ householdId: id, userId: 'user', membershipId: 'member' },
      { key, fingerprint: String(amount) }, () => {
        const row = this.ctx.storage.sql.exec<{ amount: number }>("UPDATE stock SET amount=amount-? WHERE id='item' AND amount>=? RETURNING amount", amount, amount).toArray()[0];
        if (!row) throw new Error('INSUFFICIENT_CONTENT');
        this.kernel.enqueue(key, 'test', { amount }, new Date().toISOString());
        if (fail) throw new Error('Injected failure');
        return { amount: row.amount };
      });
  }
  inspect() {
    return {
      amount: this.ctx.storage.sql.exec<{ amount: number }>('SELECT amount FROM stock').one().amount,
      receipts: this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) n FROM operations').one().n,
      outbox: this.ctx.storage.sql.exec<{ n: number }>('SELECT count(*) n FROM cf_outbox').one().n,
    };
  }
}
export default {
  async fetch(request: Request, env: { HOUSEHOLDS: DurableObjectNamespace<TestHousehold> }) {
    const { route, method, args } = await request.json() as { route: string; method: string; args: any[] };
    const stub = env.HOUSEHOLDS.getByName(route);
    try {
      let value;
      switch (method) {
        case 'seed': value = await stub.seed(args[0]); break;
        case 'revoke': value = await stub.revoke(); break;
        case 'consume': value = await stub.consume(args[0], args[1], args[2], args[3]); break;
        case 'inspect': value = await stub.inspect(); break;
        default: return new Response('Unknown test action', { status: 400 });
      }
      return Response.json(value ?? null);
    } catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
  }
};
