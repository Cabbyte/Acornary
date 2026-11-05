// Test-only queue driver and fault reporting; never a deployable application.
import inventory from './inventory-worker.js';
export { TestInventory } from './inventory-worker.js';
import { startBackup, expireBackups } from '../../apps/cloudflare/src/backups.js';
import { Restore } from '../../apps/cloudflare/src/restore.js';
import { consumeJobs } from '../../apps/cloudflare/src/jobs.js';
import { Memberships } from '../../apps/cloudflare/src/memberships.js';
import type { Env } from '../../apps/cloudflare/src/environment.js';
const pending: unknown[] = [];
export default {
  async fetch(request: Request, environment: Env) {
    const env = {
      ...environment,
      JOBS: {
        send: async (body: unknown) => {
          pending.push(body);
        },
        sendBatch: async (messages: any[]) => {
          pending.push(...messages.map((m) => m.body));
        },
      },
    } as Env;
    const path = new URL(request.url).pathname;
    if (!['/backup', '/restore', '/jobs', '/project', '/expire'].includes(path))
      return inventory.fetch(request, env as any);
    try {
      const b = (await request.json()) as any;
      let data: unknown;
      if (path === '/expire') data = await expireBackups(env);
      if (path === '/project') data = await new Memberships(env).project(b.household_id);
      if (path === '/backup') data = await startBackup(env, b.id);
      if (path === '/jobs') {
        const retries: unknown[] = [];
        for (let i = 0; i < 100 && pending.length; i++) {
          const body = pending.shift();
          await consumeJobs(
            {
              queue: 'test',
              messages: [
                {
                  body,
                  attempts: 1,
                  ack() {},
                  retry() {
                    retries.push(body);
                  },
                },
              ],
            } as any,
            env,
          );
        }
        data = { pending: pending.length, retries };
      }
      if (path === '/restore') {
        const restore = new Restore(env);
        switch (b.action) {
          case 'begin':
            data = await restore.begin(b.id, b.sha256);
            break;
          case 'auth':
            data = await restore.auth(b.id, b.sha256);
            break;
          case 'household':
            data = await restore.household(b.id, b.sha256, b.household_id);
            break;
          case 'finish':
            data = await restore.finish(b.id, b.sha256);
            break;
        }
      }
      return Response.json(data ?? null);
    } catch (error: any) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  },
};
