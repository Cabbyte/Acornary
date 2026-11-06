import { AsyncLocalStorage } from 'node:async_hooks';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { requireMcpAuth } from '@better-auth/mcp';
import { createInsufficientScopeError } from 'better-auth/oauth2';
import {
  schemas,
  reads,
  descriptions,
  type Operation,
} from '../../../packages/contracts/src/index.js';
import {
  pluginWriteTool,
  pluginReviewTool,
  pluginConfirmTool,
} from '../../../packages/contracts/src/plugin.js';
import { intakeInstructions } from '../../../packages/contracts/src/intake.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { compactIntakeResult } from './inventory/intake.js';
import { traceMetadata } from './inventory/telemetry.js';
import { execute } from './business-client.js';
import { deferredInput } from './mcp-input.js';
import {
  pluginResource,
  registerInventoryApp,
  assertMcpAttachmentTransport,
  mcpFailure,
  type PluginIdentity,
} from './plugin.js';
import { Memberships } from './memberships.js';
import { inventoryScopes, type Auth } from './auth.js';
import type { Env } from './environment.js';
export async function createMcp(env: Env, auth: Auth) {
  const identities = new AsyncLocalStorage<PluginIdentity>(),
    resource = await pluginResource(env.ASSETS, env.ORIGIN),
    memberships = new Memberships(env);
  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: 'acornary', version: '0.1.0' },
      { instructions: intakeInstructions },
    );
    registerInventoryApp(server, resource, () => identities.getStore(), true);
    for (const name of Object.keys(schemas) as Operation[])
      server.registerTool(
        name,
        {
          description:
            descriptions[name] +
            (['create_attachment_upload', 'complete_attachment_upload'].includes(name)
              ? ' MCP 不支持附件二进制传输，请在松仓网站上传或下载。'
              : ''),
          _meta: {
            ...(['create_attachment_upload', 'complete_attachment_upload'].includes(name)
              ? { 'acornary/attachmentTransport': 'unsupported' }
              : {}),
            ...(name === 'propose_catalog_change' ? { ui: { resourceUri: resource.uri } } : {}),
            securitySchemes: [
              { type: 'oauth2', scopes: [reads.has(name) ? 'inventory:read' : 'inventory:write'] },
            ],
          },
          inputSchema: deferredInput(schemas[name]),
          annotations: {
            readOnlyHint: reads.has(name),
            destructiveHint: !reads.has(name),
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args) => {
          try {
            const identity = identities.getStore();
            if (!identity?.scopes.has(reads.has(name) ? 'inventory:read' : 'inventory:write'))
              throw new DomainError('FORBIDDEN', 'OAuth scope is required.');
            assertMcpAttachmentTransport(name);
            const result = await execute({ ...identity.ctx, source: 'MCP' }, name, args),
              response = name === 'commit_intake' ? compactIntakeResult(result) : result;
            return {
              content: [{ type: 'text', text: JSON.stringify(response) }],
              structuredContent: response,
              _meta: { 'acornary/trace': traceMetadata() },
            };
          } catch (e) {
            const error = mcpFailure(e);
            return {
              isError: true,
              content: [{ type: 'text', text: JSON.stringify({ error }) }],
              structuredContent: { error },
              _meta: { 'acornary/trace': traceMetadata() },
            };
          }
        },
      );
    return server;
  });
  return requireMcpAuth(
    auth,
    async (request, claims) => {
      const context =
        typeof claims.sub === 'string'
          ? await memberships.tokenContext(
              claims.sub,
              typeof claims.acornary_reference === 'string' ? claims.acornary_reference : undefined,
            )
          : null;
      if (!context || typeof claims.client_id !== 'string')
        return Response.json({ error: 'forbidden' }, { status: 403 });
      const scopes = new Set(typeof claims.scope === 'string' ? claims.scope.split(' ') : []),
        body =
          request.method === 'POST'
            ? ((await request
                .clone()
                .json()
                .catch(() => null)) as any)
            : null;
      const name = body?.method === 'tools/call' ? body.params?.name : undefined,
        scope =
          [pluginWriteTool, pluginReviewTool, pluginConfirmTool].includes(name) ||
          (name && name in schemas && !reads.has(name))
            ? 'inventory:write'
            : 'inventory:read';
      if (!scopes.has(scope)) throw createInsufficientScopeError([scope]);
      const user =
        name === 'get_connection_context'
          ? await memberships.accounts.principal(claims.sub as string)
          : null;
      return identities.run(
        {
          ctx: {
            ...context,
            env,
            connection: {
              server_origin: env.ORIGIN,
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
        () => handler.fetch(request),
      );
    },
    { resource: env.ORIGIN + '/mcp', challengeScopes: [...inventoryScopes, 'offline_access'] },
  );
}
