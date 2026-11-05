import { consumeJobs, reconcileAccounts } from './jobs.js';
import { createHash } from 'node:crypto';
import { createAuth, type Auth } from './auth.js';
import { handleAuth } from './auth-handler.js';
import { Memberships } from './memberships.js';
import { createMcp } from './mcp.js';
import { handleTerminal } from './terminal-handler.js';
import { invoke, execute, type BusinessContext } from './business-client.js';
import { downloadAttachment } from './attachment-transfer.js';
import { household, type Env } from './environment.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { domainErrorStatus } from '../../../packages/contracts/src/errors.js';
import {
  schemas,
  reads,
  implementedFeatures,
  type Operation,
} from '../../../packages/contracts/src/index.js';
import { terminalCallback } from '../../../packages/contracts/src/terminal.js';
import { failure, traces, newTrace, traceMetadata } from './inventory/telemetry.js';
export { HouseholdStore } from './household-store.js';
export { AttachmentUpload } from './attachment-upload.js';
const cache = new WeakMap<object, { auth: Auth; mcp?: ReturnType<typeof createMcp> }>();
function application(env: Env) {
  let app = cache.get(env);
  if (!app) {
    app = { auth: createAuth(env) };
    cache.set(env, app);
  }
  return app;
}
function sameOrigin(request: Request, env: Env, json = true) {
  if (
    request.headers.get('origin') !== env.ORIGIN ||
    request.headers.get('x-acornary-request') !== 'web' ||
    (json && !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? ''))
  )
    throw new DomainError('FORBIDDEN', 'Same-origin Web request required.');
}
async function bounded(request: Request) {
  if (!request.body || /^\/api\/attachments\/upload\//.test(new URL(request.url).pathname))
    return request;
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw Object.assign(new Error('Request body exceeds 1 MiB.'), { statusCode: 413 });
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request, { body: bytes });
}
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname;
  if (url.origin !== env.ORIGIN) throw new DomainError('FORBIDDEN', 'Untrusted ingress.');
  if (request.headers.has('origin') && request.headers.get('origin') !== env.ORIGIN)
    throw new DomainError('FORBIDDEN', 'Cross-origin access denied.');
  request = await bounded(request);
  if (path === '/api/version' && request.method === 'GET')
    return Response.json({ version: env.RELEASE_VERSION, commit: env.RELEASE_COMMIT });
  if (path === '/health' && request.method === 'GET') {
    const checks = await Promise.allSettled([
      env.AUTH_DB.prepare('SELECT 1 FROM cf_account_tasks LIMIT 1').all(),
      env.BLOBS.head('health'),
      env.BACKUPS.head('health'),
    ]);
    const ok = checks.every((v) => v.status === 'fulfilled');
    return Response.json(
      {
        status: ok ? 'ok' : 'degraded',
        version: env.RELEASE_VERSION,
        commit: env.RELEASE_COMMIT,
        runtime: 'cloudflare',
        environment: env.ENVIRONMENT,
      },
      { status: ok ? 200 : 503 },
    );
  }
  if (path === '/.well-known/assetlinks.json' && request.method === 'GET') {
    const fingerprints = (env.TERMINAL_SIGNING_FINGERPRINTS ?? '').split(',').filter(Boolean);
    return Response.json(
      fingerprints.length
        ? [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name:
                  env.ENVIRONMENT === 'preview'
                    ? 'top.protium.acornary.cfpreview'
                    : 'top.protium.acornary',
                sha256_cert_fingerprints: fingerprints,
              },
            },
          ]
        : [],
    );
  }
  if (path === terminalCallback && request.method === 'GET')
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>返回松仓终端</title><p>请返回松仓终端完成登录。若未自动返回，请检查 Android 的“打开支持的链接”设置。</p>',
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  if (path === '/api' || path.startsWith('/mcp/')) throw new DomainError('NOT_FOUND', 'Not found.');
  const app = application(env);
  if (path.startsWith('/api/auth/') || path.startsWith('/.well-known/'))
    return handleAuth(request, env, app.auth);
  if (path === '/mcp') {
    app.mcp ??= createMcp(env, app.auth);
    return (await app.mcp)(request);
  }
  if (path.startsWith('/api/terminal/v1/')) return handleTerminal(request, env, app.auth);
  if (path === '/api/session' && request.method === 'GET') {
    const session = await app.auth.api.getSession({ headers: request.headers }),
      membership = new Memberships(env),
      user = session && (await membership.accounts.principal(session.user.id));
    if (!session || !user) return Response.json({ mode: 'cloud', authenticated: false });
    const households = await membership.memberships(user.id),
      selected =
        households.find((m) => m.household_id === request.headers.get('x-acornary-household')) ??
        households[0];
    const methods = await env.AUTH_DB.prepare(
      "SELECT EXISTS(SELECT 1 FROM account WHERE userId=?1 AND providerId='credential' AND password IS NOT NULL) AS password,(SELECT count(*) FROM passkey WHERE userId=?1) AS passkey_count",
    )
      .bind(user.id)
      .first<{ password: number; passkey_count: number }>();
    return Response.json({
      mode: 'cloud',
      authenticated: true,
      user_id: user.id,
      email: user.email,
      households,
      login_methods: { password: !!methods?.password, passkey_count: methods?.passkey_count ?? 0 },
      household_id: selected?.household_id,
      cache_key: `${env.ENVIRONMENT}:${user.id}:${selected?.household_id ?? 'onboarding'}`,
    });
  }
  if (path.startsWith('/api/')) {
    const membership = new Memberships(env),
      session = await app.auth.api.getSession({ headers: request.headers }),
      user = session && (await membership.accounts.principal(session.user.id));
    if (!user || !session) throw new DomainError('UNAUTHORIZED', 'Login required.');
    if (
      request.headers.has('x-acornary-account') &&
      request.headers.get('x-acornary-account') !== user.id
    )
      throw new DomainError('UNAUTHORIZED', 'Account changed.');
    const hh = request.headers.get('x-acornary-household'),
      identity = hh && (await membership.context(user.id, hh));
    if (!identity) throw new DomainError('FORBIDDEN', 'Household membership required.');
    const ctx: BusinessContext = {
      ...identity,
      env,
      connection: {
        server_origin: env.ORIGIN,
        mode: 'cloud',
        account: { id: user.id, name: user.name },
        scopes: ['inventory:read', 'inventory:write'],
      },
    };
    if (
      !['/api/context', '/api/read/get_connection_context'].includes(path) &&
      request.headers.get('x-acornary-protocol') !== '2'
    )
      throw new DomainError(
        'PROTOCOL_VERSION_UNSUPPORTED',
        'This server requires X-Acornary-Protocol: 2.',
      );
    if (path === '/api/context' && request.method === 'GET')
      return Response.json({
        ...(await invoke(ctx, 'context')),
        protocol: { current: 2, min: 2 },
        features: [...implementedFeatures],
      });
    const read = path.match(/^\/api\/read\/([^/]+)$/),
      write = path.match(/^\/api\/write\/([^/]+)$/);
    if (
      read &&
      (request.method === 'POST' ||
        (request.method === 'GET' && read[1] === 'get_connection_context'))
    ) {
      const name = read[1] as Operation;
      const special = [
        'begin_export',
        'read_export',
        'cancel_export',
        'query_inventory_groups',
      ].includes(name);
      if (!reads.has(name) && !special)
        throw new DomainError('FORBIDDEN', 'This HTTP interface is read-only.');
      if (special && name !== 'query_inventory_groups') sameOrigin(request, env);
      return Response.json(
        await execute(ctx, name, request.method === 'GET' ? {} : await request.json()),
      );
    }
    if (write && request.method === 'POST') {
      sameOrigin(request, env);
      const name = write[1] as Operation;
      if (!Object.hasOwn(schemas, name) || reads.has(name))
        throw new DomainError('FORBIDDEN', 'Unknown write command.');
      return Response.json(await execute(ctx, name, await request.json()));
    }
    if (['/api/ui/snapshot', '/api/ui/groups'].includes(path) && request.method === 'GET') {
      const snapshot = await invoke(ctx, 'snapshot');
      return Response.json(path.endsWith('/groups') ? snapshot.groups : snapshot);
    }
    if (
      ['/api/ui/catalog-review', '/api/ui/catalog-confirm'].includes(path) &&
      request.method === 'POST'
    ) {
      sameOrigin(request, env);
      const scope =
        'web:' +
        createHash('sha256')
          .update(
            JSON.stringify({
              context: identity,
              user_id: user.id,
              auth_version: user.auth_version,
              session_id: session.session.id,
            }),
          )
          .digest('hex');
      return Response.json(
        await invoke(ctx, path.endsWith('catalog-review') ? 'review' : 'confirm', {
          scope,
          input: await request.json(),
        }),
      );
    }
    const sync = path.match(/^\/api\/sync\/(state|changes|bootstrap|fetch)$/);
    if (sync && request.method === (sync[1] === 'fetch' ? 'POST' : 'GET'))
      return Response.json(
        await invoke(ctx, 'sync', {
          name: sync[1],
          input: sync[1] === 'fetch' ? await request.json() : Object.fromEntries(url.searchParams),
        }),
      );
    if (path === '/api/debug' && request.method === 'GET') {
      let input;
      try {
        input = JSON.parse(url.searchParams.get('input') ?? '{}');
      } catch {
        throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid JSON query.');
      }
      return Response.json(await invoke(ctx, 'debug', input));
    }
    const upload = path.match(/^\/api\/attachments\/upload\/([^/]+)$/),
      download = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (upload && request.method === 'PUT') {
      sameOrigin(request, env, false);
      const ticket = request.headers.get('x-acornary-upload-ticket');
      if (!ticket || request.headers.get('content-type') !== 'application/octet-stream')
        throw new DomainError('FORBIDDEN', 'Same-origin binary upload and ticket required.');
      const result = JSON.parse(
        await env.UPLOADS.getByName(`${hh}:${upload[1]}`).transfer(
          identity,
          upload[1],
          ticket,
          request.body,
        ),
      );
      if (result.error)
        throw new DomainError(result.error.code, result.error.message, result.error.details);
      return Response.json(result.data);
    }
    if (download && request.method === 'GET') {
      const reveal = url.searchParams.get('reveal_sensitive') === 'true';
      if (reveal) sameOrigin(request, env, false);
      return downloadAttachment(
        household(env, hh!),
        identity,
        download[1],
        url.searchParams.get('variant') ?? undefined,
        reveal,
        env.BLOBS,
      );
    }
    throw new DomainError('NOT_FOUND', 'Not found.');
  }
  return env.ASSETS.fetch(request);
}
export default {
  queue(batch: MessageBatch<unknown>, env: Env) {
    return consumeJobs(batch, env);
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(reconcileAccounts(env));
  },
  fetch(request: Request, env: Env, execution: ExecutionContext) {
    const trace = newTrace();
    trace.server_origin = env.ORIGIN;
    return traces.run(trace, async () => {
      let response: Response;
      try {
        response = await route(request, env);
      } catch (error) {
        response = Response.json(
          { error: failure(error) },
          {
            status:
              error instanceof DomainError
                ? (domainErrorStatus(error.code) ?? 400)
                : ((error as { statusCode?: number })?.statusCode ?? 500),
          },
        );
      }
      const headers = new Headers(response.headers);
      headers.set('X-Request-ID', trace.request_id);
      headers.set('Server-Timing', `total;dur=${(performance.now() - trace.started).toFixed(2)}`);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('X-Frame-Options', 'DENY');
      if (
        new URL(request.url).pathname.startsWith('/api/') ||
        new URL(request.url).pathname === '/mcp'
      )
        headers.set('Cache-Control', 'no-store');
      if (!headers.has('Content-Security-Policy'))
        headers.set(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      console.log(
        JSON.stringify({
          ...traceMetadata(),
          status: response.status,
          version: env.RELEASE_VERSION,
        }),
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  },
};
// Named service entrypoint is not routed by the public Fetch handler.
export { MigrationEntrypoint } from './migration-entrypoint.js';
export { BackupEntrypoint } from './backup-entrypoint.js';
