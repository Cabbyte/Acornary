import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './environment.js';
import { startBackup, enqueueBackup } from './backups.js';
import { Restore } from './restore.js';
/** Private Wrangler-authenticated service binding only. No public router exposes this capability. */
export class BackupEntrypoint extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 4096) throw new Error('Operator request too large');
      const b = JSON.parse(body),
        path = new URL(request.url).pathname,
        restore = new Restore(this.env);
      let result: unknown;
      switch (path) {
        case '/pin':
          if (typeof b.pinned !== 'boolean') throw new Error('Explicit retention choice required');
          await this.env.AUTH_DB.prepare(
            "UPDATE cf_backup_runs SET pinned=? WHERE id=? AND status IN ('PENDING','COMPLETE')",
          )
            .bind(Number(b.pinned), b.id)
            .run();
          result = { pinned: b.pinned };
          break;
        case '/start':
          result = { id: await startBackup(this.env, b.id) };
          break;
        case '/resume':
          await enqueueBackup(this.env, b.id);
          result = { queued: true };
          break;
        case '/status':
          result = await this.env.AUTH_DB.prepare(
            'SELECT id,started_at,completed_at,status,manifest_sha256 FROM cf_backup_runs WHERE id=?',
          )
            .bind(b.id)
            .first();
          break;
        case '/restore/begin':
          result = await restore.begin(b.id, b.sha256);
          break;
        case '/restore/auth':
          result = await restore.auth(b.id, b.sha256);
          break;
        case '/restore/household':
          result = await restore.household(b.id, b.sha256, b.household_id);
          break;
        case '/restore/finish':
          result = await restore.finish(b.id, b.sha256);
          break;
        default:
          return new Response(null, { status: 404 });
      }
      return Response.json({ data: result ?? null });
    } catch {
      return Response.json(
        { error: 'Backup operation rejected; inspect checkpoint status and manifest.' },
        { status: 409 },
      );
    }
  }
}
