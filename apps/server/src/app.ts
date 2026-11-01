import { registerExportRoutes } from './exports.js';
import { putAttachment, downloadAttachment, MAX_FILE_SIZE } from './attachments.js';
import { reviewCatalogProposal, confirmCatalogProposal, compactIntakeResult } from './intake.js';
import { pluginReviewTool, pluginConfirmTool } from '../../../packages/contracts/src/plugin.js';
import { debugRead } from './debug.js';
import { deferredInput } from './mcp-input.js';
import { newTrace, traces, traceMetadata, failure, timed, type Trace } from './telemetry.js';
import { performance } from 'node:perf_hooks';
import { intakeInstructions } from '../../../packages/contracts/src/intake.js';
import { release, healthStatus } from './release.js';
import { implementedFeatures } from '../../../packages/contracts/src/index.js';
import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import { localhostHostValidation } from '@modelcontextprotocol/fastify';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { timingSafeEqual, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { AsyncLocalStorage } from 'node:async_hooks';
import { requireMcpAuth } from '@better-auth/mcp';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import { createAuth, inventoryScopes } from './auth.js';
import {
  activeUser,
  memberships,
  memberContext,
  tokenContext,
  oauthRequest,
  oauthFlow,
  selectOAuthHousehold,
} from './memberships.js';
import { runtimeConfig, type RuntimeConfig } from './config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  schemas,
  reads,
  descriptions,
  type Operation,
} from '../../../packages/contracts/src/index.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { execute, type Context } from './service.js';
import { pool, query } from './db.js';
import { webSnapshotV2 } from './web.js';
import { syncState, syncChanges, syncFetch, syncBootstrap } from './sync-api.js';
import {
  assertMcpAttachmentTransport,
  mcpFailure,
  pluginResource,
  registerInventoryApp,
} from './plugin.js';
import { pluginWriteTool } from '../../../packages/contracts/src/plugin.js';
import { domainErrorStatus } from '../../../packages/contracts/src/errors.js';
import { registerTerminal } from './terminal.js';
export async function buildApp(
  ctx: Context,
  token: string,
  serveStatic = true,
  config: RuntimeConfig = runtimeConfig(),
) {
  const cloud = config.mode === 'cloud' ? config : null;
  ctx = {
    ...ctx,
    connection: {
      server_origin: cloud?.origin ?? 'http://localhost:3210',
      mode: cloud ? 'cloud' : 'local',
      scopes: ['inventory:read', 'inventory:write'],
    },
  };
  const auth = cloud ? createAuth(cloud) : null;
  const identities = new AsyncLocalStorage<{
    ctx: Context;
    scopes: Set<string>;
    clientId: string;
    userId: string;
    authVersion: number;
  }>();
  const webContexts = new WeakMap<FastifyRequest, Context>();
  const webApprovalScopes = new WeakMap<FastifyRequest, string>();
  const headersFor = (req: FastifyRequest) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    return headers;
  };
  const requestFor = (req: FastifyRequest) =>
    new Request(`${cloud?.origin ?? `http://${req.headers.host}`}${req.url}`, {
      method: req.method,
      headers: headersFor(req),
      ...(!['GET', 'HEAD'].includes(req.method) && req.body !== undefined
        ? { body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body) }
        : {}),
    });
  const sendResponse = (reply: FastifyReply, response: Response) => {
    reply.code(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') reply.header(key, value);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) reply.header('set-cookie', cookies);
    return response.body ? reply.send(Readable.fromWeb(response.body as any)) : reply.send();
  };
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    // OAuth URLs contain authorization codes. Do not log request URLs or bodies.
    disableRequestLogging: true,
    trustProxy: cloud ? [cloud.trustedProxy] : false,
    requestTimeout: 30000,
    bodyLimit: 1024 * 1024,
  });
  const requestTraces = new WeakMap<FastifyRequest, Trace>();
  app.addHook('onRequest', (req, reply, done) => {
    const trace = newTrace();
    trace.server_origin = cloud?.origin ?? `http://${req.headers.host}`;
    requestTraces.set(req, trace);
    reply.header('X-Request-ID', trace.request_id);
    traces.run(trace, done);
  });
  app.addHook('onSend', async (req, reply, payload) => {
    const trace = requestTraces.get(req);
    if (trace)
      reply.header('Server-Timing', `total;dur=${(performance.now() - trace.started).toFixed(2)}`);
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    const trace = requestTraces.get(req);
    if (trace)
      app.log.info(
        {
          ...traceMetadata(trace),
          outcome: trace.outcome ?? (reply.statusCode < 400 ? 'SUCCESS' : 'HTTP_ERROR'),
          version: release.version,
          status: reply.statusCode,
        },
        'Request timing',
      );
  });
  if (!cloud) app.addHook('onRequest', localhostHostValidation());
  app.addHook('onRequest', async (req, reply) => {
    if (
      cloud &&
      req.url !== '/health' &&
      (req.socket.remoteAddress?.replace(/^::ffff:/, '') !== cloud.trustedProxy ||
        req.headers.host !== new URL(cloud.origin).host ||
        req.headers['x-forwarded-proto'] !== 'https')
    )
      return reply
        .code(403)
        .send({ error: failure(new DomainError('FORBIDDEN', 'Untrusted ingress.')) });
    if (
      req.headers.origin &&
      req.headers.origin !== (cloud?.origin ?? `http://${req.headers.host}`)
    )
      return reply
        .code(403)
        .send({ error: failure(new DomainError('FORBIDDEN', 'Cross-origin access denied.')) });
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (cloud)
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (
      auth &&
      /^\/api\/(context|sync(?:\/|$)|read(?:\/|$)|attachments(?:\/|$)|write(?:\/|$)|ui(?:\/|$)|debug(?:\?|$))/.test(
        req.url,
      )
    ) {
      return timed('auth_ms', async () => {
        const session = await auth.api.getSession({ headers: headersFor(req) });
        const user = session && (await activeUser(session.user.id));
        if (!user)
          return reply
            .code(401)
            .send({ error: failure(new DomainError('UNAUTHORIZED', 'Login required.')) });
        if (req.headers['x-acornary-account'] && req.headers['x-acornary-account'] !== user.id)
          return reply
            .code(401)
            .send({ error: failure(new DomainError('UNAUTHORIZED', 'Account changed.')) });
        const household = req.headers['x-acornary-household'];
        const context =
          typeof household === 'string' ? await memberContext(user.id, household) : null;
        if (!context)
          return reply.code(403).send({
            error: failure(new DomainError('FORBIDDEN', 'Household membership required.')),
          });
        webContexts.set(req, {
          ...context,
          connection: {
            server_origin: cloud!.origin,
            mode: 'cloud',
            account: { id: user.id, name: user.name },
            scopes: ['inventory:read', 'inventory:write'],
          },
        });
        webApprovalScopes.set(
          req,
          'web:' +
            createHash('sha256')
              .update(
                JSON.stringify({
                  context,
                  user_id: user.id,
                  auth_version: user.auth_version,
                  session_id: session!.session.id,
                }),
              )
              .digest('hex'),
        );
      });
    }
  });
  const rejectProtocol = (req: FastifyRequest) => {
    if (req.headers['x-acornary-protocol'] !== '2')
      throw new DomainError(
        'PROTOCOL_VERSION_UNSUPPORTED',
        'This server requires X-Acornary-Protocol: 2.',
      );
  };
  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    const negotiation = [
      '/api/context',
      '/api/version',
      '/api/read/get_connection_context',
      '/api/terminal/v1/context',
      '/api/terminal/v1/config',
    ];
    if (
      !negotiation.includes(path) &&
      /^\/api\/(read|write|ui|sync|attachments|debug)(\/|$)/.test(path)
    )
      rejectProtocol(req);
  });
  app.setErrorHandler((error: any, _req, reply) => {
    const result = failure(error);
    return reply
      .code(
        error instanceof DomainError
          ? (domainErrorStatus(error.code) ?? 400)
          : (error.statusCode ?? 500),
      )
      .send({ error: result });
  });
  app.get('/health', async (_req, reply) => {
    const status = await healthStatus();
    return reply.code(status.status === 'ok' ? 200 : 503).send(status);
  });
  app.get('/api/version', async () => ({ version: release.version, commit: release.commit }));
  app.get('/api/session', async (req) => {
    if (!auth)
      return {
        mode: 'local',
        authenticated: true,
        cache_key: `local:${ctx.household_id}:${ctx.actor_id}`,
      };
    const session = await auth.api.getSession({ headers: headersFor(req) });
    const user = session && (await activeUser(session.user.id));
    if (!user || !session) return { mode: 'cloud', authenticated: false };
    const households = await memberships(user.id);
    const selected =
      households.find((m) => m.household_id === req.headers['x-acornary-household']) ??
      households[0];
    const loginMethods = (
      await query(
        pool,
        `SELECT
      EXISTS(SELECT 1 FROM account WHERE "userId"=$1 AND "providerId"='credential' AND password IS NOT NULL) AS password,
      (SELECT count(*)::integer FROM passkey WHERE "userId"=$1) AS passkey_count`,
        [user.id],
      )
    ).rows[0];
    return {
      mode: 'cloud',
      authenticated: true,
      user_id: user.id,
      email: user.email,
      households,
      login_methods: loginMethods,
      household_id: selected?.household_id,
      cache_key: `${user.id}:${selected?.household_id ?? 'onboarding'}`,
    };
  });
  if (auth) {
    registerTerminal(app, auth, cloud!);
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => done(null, body),
    );
    const publicAuthPaths = new Set([
      '/sign-in/email',
      '/passkey/generate-authenticate-options',
      '/passkey/verify-authentication',
      '/account/capabilities',
      '/account/email/start',
      '/account/email/verify',
      '/account/complete-password',
      '/account/passkey/options',
      '/account/passkey/complete',
      '/account/credentials',
      '/account/password',
      '/account/passkey/update',
      '/account/households',
      '/account/household',
      '/account/invitation',
      '/sign-out',
      '/get-session',
      '/jwks',
      '/oauth2/authorize',
      '/oauth2/token',
      '/oauth2/consent',
      '/oauth2/continue',
      '/oauth2/revoke',
      '/oauth2/introspect',
      '/oauth2/userinfo',
      '/.well-known/openid-configuration',
      '/.well-known/oauth-authorization-server',
    ]);
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      const path = req.url.split('?')[0];
      if (path.startsWith('/api/auth/') && !publicAuthPaths.has(path.slice('/api/auth'.length)))
        return reply.code(404).send({ error: 'not_found' });
      const body =
        typeof req.body === 'object' && req.body ? (req.body as Record<string, unknown>) : {};
      const flow = oauthFlow(
        typeof body.oauth_query === 'string' ? body.oauth_query : (req.url.split('?')[1] ?? ''),
      );
      if (
        typeof body.household_id === 'string' &&
        ['/api/auth/oauth2/continue', '/api/auth/oauth2/consent'].includes(path)
      ) {
        if (req.headers.origin !== cloud!.origin)
          return reply.code(403).send({ error: 'forbidden' });
        const session = await auth.api.getSession({ headers: headersFor(req) });
        if (!session || !(await activeUser(session.user.id)))
          return reply.code(401).send({ error: 'unauthorized' });
        await selectOAuthHousehold(session.session.id, session.user.id, flow, body.household_id);
      }
      return oauthRequest.run({ flow }, async () =>
        sendResponse(reply, await auth.handler(requestFor(req))),
      );
    };
    app.route({ method: ['GET', 'POST'], url: '/api/auth/*', handler });
    app.get('/.well-known/*', handler);
  }
  // Encapsulation keeps the binary parser and size limit confined to attachment routes.
  await app.register(async (files) => {
    files.setErrorHandler((error: any, _req, reply) => {
      const statuses: Record<string, number> = {
        ATTACHMENT_TOO_LARGE: 413,
        ATTACHMENT_QUOTA_EXCEEDED: 409,
        STATE_CONFLICT: 409,
        PROTOCOL_VERSION_UNSUPPORTED: 409,
      };
      return reply
        .code(
          error instanceof DomainError
            ? (statuses[error.code] ?? domainErrorStatus(error.code) ?? 400)
            : (error.statusCode ?? 500),
        )
        .send({ error: failure(error) });
    });
    files.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: MAX_FILE_SIZE },
      (_req, body, done) => done(null, body),
    );
    const attachmentContext = (req: FastifyRequest) => {
      if (!cloud) {
        const supplied = Buffer.from(req.headers.authorization ?? '');
        const expected = Buffer.from(`Bearer ${token}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
          throw new DomainError('UNAUTHORIZED', 'Attachment authentication required.');
      }
      if (req.headers['x-acornary-protocol'] !== '2')
        throw new DomainError(
          'PROTOCOL_VERSION_UNSUPPORTED',
          'Attachment routes require protocol 2.',
        );
      return { ...(webContexts.get(req) ?? ctx), source: 'WEB' };
    };
    files.put('/api/attachments/upload/:upload_id', { bodyLimit: MAX_FILE_SIZE }, async (req) => {
      const context = attachmentContext(req);
      if (
        req.headers.origin !== (cloud?.origin ?? `http://${req.headers.host}`) ||
        req.headers['x-acornary-request'] !== 'web' ||
        !Buffer.isBuffer(req.body)
      )
        throw new DomainError('FORBIDDEN', 'Same-origin binary upload required.');
      const ticket = req.headers['x-acornary-upload-ticket'];
      if (typeof ticket !== 'string') throw new DomainError('FORBIDDEN', 'Upload ticket required.');
      return putAttachment(context, (req.params as any).upload_id, ticket, req.body as Buffer);
    });
    files.get('/api/attachments/:id', async (req, reply) => {
      const context = attachmentContext(req);
      const input = req.query as { variant?: string; reveal_sensitive?: string };
      if (
        input.reveal_sensitive === 'true' &&
        (req.headers.origin !== (cloud?.origin ?? `http://${req.headers.host}`) ||
          req.headers['x-acornary-request'] !== 'web')
      )
        throw new DomainError('FORBIDDEN', 'Same-origin sensitive reveal required.');
      const result = await downloadAttachment(
        context,
        (req.params as any).id,
        input.variant,
        input.reveal_sensitive === 'true',
      );
      return reply.headers(result.headers).send(result.bytes);
    });
  });
  app.get('/api/context', async (req) => {
    const context = webContexts.get(req) ?? ctx;
    const household = (
      await query(pool, 'SELECT * FROM households WHERE id=$1', [context.household_id])
    ).rows[0];
    const install = (
      await query(
        pool,
        'SELECT container_catalog_id FROM household_settings WHERE household_id=$1',
        [context.household_id],
      )
    ).rows[0];
    return { household, container_catalog_id: install?.container_catalog_id,
      protocol: { current: 2, min: 2 }, features: [...implementedFeatures] };
  });
  const readOperation = async (req: FastifyRequest, input: unknown) => {
    const name = (req.params as any).operation as Operation;
    if (!reads.has(name)) throw new DomainError('FORBIDDEN', 'This HTTP interface is read-only.');
    return execute({ ...(webContexts.get(req) ?? ctx), source: 'WEB' }, name, input);
  };
  app.post('/api/read/:operation', async (req) => readOperation(req, req.body ?? {}));
  app.get('/api/read/get_connection_context', async (req) =>
    execute({ ...(webContexts.get(req) ?? ctx), source: 'WEB' }, 'get_connection_context', {}),
  );
  registerExportRoutes(app, token, !!cloud, req => ({ ...(webContexts.get(req) ?? ctx), source: 'WEB' }), execute);
  app.post('/api/read/query_inventory_groups', async req =>
    execute({ ...(webContexts.get(req) ?? ctx), source: 'WEB' }, 'query_inventory_groups', req.body));
  const syncContext = (req: FastifyRequest) => {
    if (req.headers['x-acornary-protocol'] !== '2')
      throw new DomainError('PROTOCOL_VERSION_UNSUPPORTED', 'Sync requires protocol 2.');
    return webContexts.get(req) ?? ctx;
  };
  app.get('/api/sync/state', req => syncState(syncContext(req)));
  app.get('/api/sync/changes', req => syncChanges(syncContext(req), req.query));
  app.get('/api/sync/bootstrap', req => syncBootstrap(syncContext(req), req.query));
  app.post('/api/sync/fetch', req => syncFetch(syncContext(req), req.body));
  const snapshotFor = (req: FastifyRequest) => {
    const trace = traces.getStore();
    if (trace) trace.tool = 'web_snapshot';
    return timed('business_ms', async () =>
      webSnapshotV2(webContexts.get(req) ?? ctx),
    );
  };
  app.get('/api/ui/snapshot', snapshotFor);
  app.get('/api/ui/groups', async (req) => (await snapshotFor(req)).groups);
  for (const action of ['catalog-review', 'catalog-confirm'])
    app.post(`/api/ui/${action}`, async (req) => {
      if (
        req.headers.origin !== (cloud?.origin ?? `http://${req.headers.host}`) ||
        req.headers['x-acornary-request'] !== 'web' ||
        !req.headers['content-type']?.startsWith('application/json')
      )
        throw new DomainError('FORBIDDEN', 'Same-origin Web request required.');
      const current = webContexts.get(req) ?? ctx;
      const scope = webApprovalScopes.get(req) ?? 'local-web:' + JSON.stringify(current);
      return action === 'catalog-review'
        ? reviewCatalogProposal(current, scope, req.body)
        : confirmCatalogProposal(current, scope, req.body);
    });
  app.post('/api/write/:operation', async (req) => {
    // Browser-only same-origin JSON commands. Reject absent/null Origin as well as cross-site requests.
    if (
      req.headers.origin !== (cloud?.origin ?? `http://${req.headers.host}`) ||
      req.headers['x-acornary-request'] !== 'web' ||
      !req.headers['content-type']?.startsWith('application/json')
    )
      throw new DomainError('FORBIDDEN', 'Same-origin Web request required.');
    const name = (req.params as { operation: Operation }).operation;
    if (!Object.hasOwn(schemas, name) || reads.has(name))
      throw new DomainError('FORBIDDEN', 'Unknown write command.');
    return execute({ ...(webContexts.get(req) ?? ctx), source: 'WEB' }, name, req.body);
  });
  app.get('/api/debug', async (req) => {
    let input: unknown;
    try {
      input = JSON.parse((req.query as any).input ?? '{}');
    } catch {
      throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid JSON query.');
    }
    return debugRead({ ...(webContexts.get(req) ?? ctx), source: 'WEB_DEBUG' }, input);
  });
  const uiResource = await pluginResource();
  const mcp = createMcpHandler(() => {
    const server = new McpServer(
      { name: 'acornary', version: '0.1.0' },
      {
        instructions: intakeInstructions,
      },
    );
    registerInventoryApp(
      server,
      uiResource,
      () =>
        identities.getStore() ??
        (cloud ? undefined : { ctx, scopes: new Set(['inventory:read', 'inventory:write']) }),
      !!cloud,
    );
    for (const name of Object.keys(schemas) as Operation[])
      server.registerTool(
        name,
        {
          description:
            descriptions[name] +
            (name === 'create_attachment_upload' || name === 'complete_attachment_upload'
              ? ' MCP 不支持附件二进制传输，请在松仓网站上传或下载。'
              : ''),
          _meta: {
            ...(name === 'create_attachment_upload' || name === 'complete_attachment_upload'
              ? { 'acornary/attachmentTransport': 'unsupported' }
              : {}),
            ...(name === 'propose_catalog_change' ? { ui: { resourceUri: uiResource.uri } } : {}),
            ...(cloud
              ? {
                  securitySchemes: [
                    {
                      type: 'oauth2',
                      scopes: [reads.has(name) ? 'inventory:read' : 'inventory:write'],
                    },
                  ],
                }
              : {}),
          },
          inputSchema: deferredInput(schemas[name]),
          annotations: {
            readOnlyHint: reads.has(name),
            destructiveHint: !reads.has(name),
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args: any) => {
          try {
            const identity = identities.getStore();
            if (
              cloud &&
              (!identity ||
                !identity.scopes.has(reads.has(name) ? 'inventory:read' : 'inventory:write'))
            )
              throw new DomainError('FORBIDDEN', 'OAuth scope is required.');
            assertMcpAttachmentTransport(name);
            const result = await execute({ ...(identity?.ctx ?? ctx), source: 'MCP' }, name, args);
            if (identity)
              app.log.info(
                {
                  oauth_client_id: identity.clientId,
                  operation_id: result.operation_id,
                  tool: name,
                },
                'MCP operation',
              );
            const response = name === 'commit_intake' ? compactIntakeResult(result) : result;
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(response) }],
              structuredContent: response,
              _meta: { 'acornary/trace': traceMetadata() },
            };
          } catch (e) {
            const error = mcpFailure(e);
            return {
              isError: true,
              content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
              structuredContent: { error },
              _meta: { 'acornary/trace': traceMetadata() },
            };
          }
        },
      );
    return server;
  });
  const cloudMcp =
    auth && cloud
      ? requireMcpAuth(
          auth,
          async (request, claims) => {
            const context =
              typeof claims.sub === 'string'
                ? await tokenContext(
                    claims.sub,
                    typeof claims.acornary_reference === 'string'
                      ? claims.acornary_reference
                      : undefined,
                  )
                : null;
            if (!context || typeof claims.client_id !== 'string')
              return Response.json({ error: 'forbidden' }, { status: 403 });
            const scopes = new Set(typeof claims.scope === 'string' ? claims.scope.split(' ') : []);
            // Challenge before invoking SDK tools, including before idempotency replays.
            const body =
              request.method === 'POST'
                ? await request
                    .clone()
                    .json()
                    .catch(() => null)
                : null;
            const name =
              body?.method === 'tools/call'
                ? (body.params?.name as
                    | Operation
                    | typeof pluginWriteTool
                    | typeof pluginReviewTool
                    | typeof pluginConfirmTool)
                : undefined;
            const scope =
              name === pluginWriteTool ||
              name === pluginReviewTool ||
              name === pluginConfirmTool ||
              (name && name in schemas && !reads.has(name))
                ? 'inventory:write'
                : 'inventory:read';
            if (!scopes.has(scope)) throw createInsufficientScopeError([scope]);
            const user =
              name === 'get_connection_context'
                ? await activeUser(claims.sub as string)
                : undefined;
            const trace = traces.getStore();
            if (trace)
              trace.phases.auth_ms = performance.now() - (trace.auth_started ?? trace.started);
            return identities.run(
              {
                ctx: {
                  ...context,
                  connection: {
                    server_origin: cloud.origin,
                    mode: 'cloud',
                    account: user ? { id: user.id, name: user.name } : undefined,
                    scopes: [...scopes],
                  },
                },
                scopes,
                clientId: claims.client_id,
                userId: claims.sub as string,
                authVersion: context.auth_version,
              },
              () => mcp.fetch(request),
            );
          },
          { resource: cloud.resource, challengeScopes: [...inventoryScopes, 'offline_access'] },
        )
      : null;
  app.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      const currentTrace = traces.getStore();
      if (currentTrace) currentTrace.auth_started = performance.now();
      if (cloudMcp) {
        const response = await cloudMcp(requestFor(req));
        const trace = traces.getStore();
        if (trace && trace.phases.auth_ms === undefined)
          trace.phases.auth_ms = performance.now() - (trace.auth_started ?? trace.started);
        return sendResponse(reply, response);
      }
      const provided = Buffer.from(req.headers.authorization ?? ''),
        expected = Buffer.from(`Bearer ${token}`);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
        return reply.code(401).send({
          error: failure(new DomainError('UNAUTHORIZED', 'A personal access token is required.')),
        });
      const trace = traces.getStore();
      if (trace) trace.phases.auth_ms = performance.now() - (trace.auth_started ?? trace.started);
      return sendResponse(reply, await mcp.fetch(requestFor(req)));
    },
  });
  app.addHook('onClose', () => mcp.close());
  if (serveStatic) {
    await app.register(staticFiles, { root: resolve('apps/web/dist'), prefix: '/' });
    app.get('/login', (_req, reply) => reply.sendFile('index.html'));
    app.get('/consent', (_req, reply) => reply.sendFile('index.html'));
    app.setNotFoundHandler((req, reply) => {
      if (
        req.method === 'GET' &&
        /^\/(i|items|places|catalog|search|activity|settings|inspect|register|recover|join|choose-household)(\/|$)/.test(
          req.url.split('?')[0],
        )
      )
        return reply.sendFile('index.html');
      return reply.code(404).send({ error: failure(new DomainError('NOT_FOUND', 'Not found.')) });
    });
  }
  return app;
}
