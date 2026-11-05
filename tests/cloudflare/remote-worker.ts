// Disposable live acceptance Worker only. The deployed product uses src/worker.ts directly.
import worker from '../../apps/cloudflare/src/worker.js';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { fetchClientMetadataResource } from '../../apps/cloudflare/src/cimd-fetch.js';
import type { Env } from '../../apps/cloudflare/src/environment.js';
export {
  HouseholdStore,
  MigrationEntrypoint,
  BackupEntrypoint,
} from '../../apps/cloudflare/src/worker.js';
export class NetworkCheck extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    const b = (await request.json()) as { url: string };
    try {
      const response = await fetchClientMetadataResource(b.url, {
        method: 'GET',
        headers: { authorization: 'must-not-forward', cookie: 'must-not-forward' },
      });
      return Response.json({
        status: response.status,
        body: (await response.text()).slice(0, 200),
      });
    } catch (error) {
      return Response.json({
        rejected: true,
        error: error instanceof Error ? error.message : 'rejected',
      });
    }
  }
}
export default {
  ...worker,
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === '/__acceptance__/small')
      return Response.json({
        marker: 'public-worker-front-door',
        authorization: request.headers.get('authorization'),
        cookie: request.headers.get('cookie'),
      });
    if (path === '/__acceptance__/redirect') return Response.redirect('https://127.0.0.1/', 302);
    if (path === '/__acceptance__/large') return new Response('x'.repeat(65537));
    if (path === '/__acceptance__/slow') {
      await new Promise((r) => setTimeout(r, 6000));
      return new Response('too late');
    }
    return worker.fetch(request, env, ctx);
  },
};
