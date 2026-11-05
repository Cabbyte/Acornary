import { backupHousehold, finalizeBackup, scheduledBackup } from './backups.js';
import { z } from 'zod';
import { household, type Env } from './environment.js';
import { Memberships } from './memberships.js';
import { blobObjectKey } from './blob-import.js';
const jobSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('BACKUP_HOUSEHOLD'),
    backup_id: z.string().uuid(),
    household_id: z.string().regex(/^household_[a-f0-9-]{36}$/),
  }),
  z.strictObject({ kind: z.literal('BACKUP_FINALIZE'), backup_id: z.string().uuid() }),
  z.strictObject({ kind: z.literal('ACCOUNT_RECOVER'), user_id: z.string().min(1).max(512) }),
  z.strictObject({
    kind: z.literal('HOUSEHOLD_MAINTENANCE'),
    household_id: z.string().regex(/^household_[a-f0-9-]{36}$/),
  }),
]);
export async function consumeJobs(batch: MessageBatch<unknown>, env: Env) {
  for (const message of batch.messages) {
    const parsed = jobSchema.safeParse(message.body);
    if (!parsed.success) {
      console.log(JSON.stringify({ job: 'INVALID', outcome: 'RETRY' }));
      message.retry({ delaySeconds: 3600 });
      continue;
    }
    const job = parsed.data;
    try {
      if (job.kind === 'BACKUP_HOUSEHOLD')
        await backupHousehold(env, job.backup_id, job.household_id);
      else if (job.kind === 'BACKUP_FINALIZE') await finalizeBackup(env, job.backup_id);
      else if (job.kind === 'ACCOUNT_RECOVER') await new Memberships(env).recover(job.user_id);
      else {
        const store = household(env, job.household_id);
        const plan = await store.maintenancePlan();
        if (plan.household_id === job.household_id) {
          await new Memberships(env).project(job.household_id);
          for (const object of plan.objects) {
            await env.BLOBS.delete(blobObjectKey(object.storage_key));
            await store.acknowledgeCleanup(object.id);
          }
        }
      }
      message.ack();
      console.log(JSON.stringify({ job: job.kind, outcome: 'SUCCESS', attempt: message.attempts }));
    } catch {
      message.retry({ delaySeconds: Math.min(3600, 30 * 2 ** Math.min(message.attempts, 7)) });
      console.log(JSON.stringify({ job: job.kind, outcome: 'RETRY', attempt: message.attempts }));
    }
  }
}
/** Daily reconciliation covers a crash between persisting a task and sending its queue notification. */
export async function reconcileAccounts(env: Env) {
  await scheduledBackup(env);
  let after = '';
  for (;;) {
    const { results } = await env.AUTH_DB.prepare(
      "SELECT DISTINCT user_id FROM cf_account_tasks WHERE status='PENDING' AND user_id>? ORDER BY user_id LIMIT 100",
    )
      .bind(after)
      .all<{ user_id: string }>();
    if (!results.length) break;
    await env.JOBS.sendBatch(
      results.map((row) => ({ body: { kind: 'ACCOUNT_RECOVER', user_id: row.user_id } })),
    );
    after = results.at(-1)!.user_id;
  }
  for (const table of ['auth_ceremonies', 'auth_oauth_selections'])
    await env.AUTH_DB.prepare(`DELETE FROM ${table} WHERE expires_at<?`)
      .bind(new Date().toISOString())
      .run();
  await env.AUTH_DB.prepare('DELETE FROM auth_attempts WHERE window_start<?')
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .run();
}
