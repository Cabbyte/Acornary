// Disposable public-network acceptance probe. It contains no account or inventory data.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { fetchClientMetadataResource } from '../../apps/cloudflare/src/cimd-fetch.js';
export class NetworkCheck extends WorkerEntrypoint {
  async fetch(request: Request) {
    const b = (await request.json()) as { url: string };
    try {
      const response = await fetchClientMetadataResource(b.url, {
        method: 'GET',
        headers: { authorization: 'must-not-forward', cookie: 'must-not-forward' },
      });
      const body = await response.text();
      return Response.json({
        status: response.status,
        body: body.slice(0, 1000),
        bytes: Buffer.byteLength(body),
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
  async fetch(request: Request) {
    switch (new URL(request.url).pathname) {
      case '/small':
        return Response.json({
          marker: 'public-worker-front-door',
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        });
      case '/redirect':
        return Response.redirect('https://127.0.0.1/', 302);
      case '/large':
        return new Response('x'.repeat(65537));
      case '/slow':
        await new Promise((r) => setTimeout(r, 6000));
        return new Response('too late');
      default:
        return new Response(null, { status: 404 });
    }
  },
};
