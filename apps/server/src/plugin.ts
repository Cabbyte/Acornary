import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import {
  pluginMetaKey,
  pluginOpenTool,
  pluginViewTool,
  pluginWriteTool,
  pluginWriteSchema,
  pluginWriteResultSchema,
} from '../../../packages/contracts/src/plugin.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { execute, type Context } from './service.js';
import { webSnapshot } from './web.js';

export interface PluginIdentity {
  ctx: Context;
  scopes: Set<string>;
  userId?: string;
  authVersion?: number;
  clientId?: string;
}
// An equality guard, never an authority or a way to select a household. The
// complete identity comes exclusively from the authenticated server request.
export function pluginScope(current: PluginIdentity, cloud: boolean) {
  const identity = {
    mode: cloud ? 'cloud' : 'local',
    user: current.userId ?? null,
    actor: current.ctx.actor_id,
    household: current.ctx.household_id,
    authVersion: current.authVersion ?? 0,
    client: current.clientId ?? null,
    scopes: [...current.scopes].sort(),
  };
  return 'mcp:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
// Loaded once per server instance, never globally across independent test applications.
export async function pluginResource() {
  const html = await readFile(resolve('apps/web/dist/plugin/index.html'), 'utf8').catch(() => null);
  const hash = createHash('sha256')
    .update(html ?? 'not-built')
    .digest('hex')
    .slice(0, 16);
  return { html, uri: `ui://acornary/inventory-${hash}.html` };
}
export function registerInventoryApp(
  server: McpServer,
  resource: Awaited<ReturnType<typeof pluginResource>>,
  identity: () => PluginIdentity | undefined,
  cloud: boolean,
) {
  registerAppTool(
    server,
    pluginWriteTool,
    {
      title: '提交库存界面修改',
      description: '仅提交当前 UI 会话的明确修改。预期会话只用于一致性检查，不选择身份或家庭。',
      inputSchema: pluginWriteSchema,
      outputSchema: pluginWriteResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        ui: { visibility: ['app'] },
        ...(cloud ? { securitySchemes: [{ type: 'oauth2', scopes: ['inventory:write'] }] } : {}),
      },
    },
    async (args) => {
      try {
        const current = identity();
        if (!current?.scopes.has('inventory:write'))
          throw new DomainError('FORBIDDEN', 'OAuth write scope is required.');
        if (args.expected_scope !== pluginScope(current, cloud))
          throw new DomainError('SESSION_CHANGED', 'The UI authorization context has changed.');
        // Compare before entering execute(), including its idempotency replay.
        // This request's authenticated context is fixed; the input cannot replace it.
        const result = await execute(
          { ...current.ctx, source: 'MCP_UI' },
          args.operation,
          args.input,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const failure = { code: error.code, message: error.message, details: error.details };
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: failure }) }],
          structuredContent: { error: failure },
        };
      }
    },
  );
  registerAppResource(
    server,
    'inventory',
    resource.uri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      if (!resource.html)
        throw new Error('Build the Acornary plugin UI before reading this resource.');
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: RESOURCE_MIME_TYPE,
            text: resource.html,
            _meta: {
              ui: { csp: { connectDomains: [], resourceDomains: [] } },
              'openai/ui': {
                availableDisplayModes: ['fullscreen'],
                preferredDisplayMode: 'fullscreen',
              },
            },
          },
        ],
      };
    },
  );
  for (const name of [pluginOpenTool, pluginViewTool]) {
    registerAppTool(
      server,
      name,
      {
        title: name === pluginOpenTool ? '浏览松仓库存' : '刷新库存视图',
        description:
          name === pluginOpenTool
            ? '打开松仓库存界面。选择具体物品后可在对话中指代该物品；选择本身不授权写入。'
            : '读取当前已授权家庭的完整界面投影。身份和家庭由服务端认证决定。',
        inputSchema: z.strictObject({}),
        outputSchema: z.strictObject({
          household: z.string(),
          items: z.number().int().nonnegative(),
          catalog: z.number().int().nonnegative(),
        }),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui:
            name === pluginOpenTool
              ? { resourceUri: resource.uri, visibility: ['model', 'app'] }
              : { visibility: ['app'] },
          ...(name === pluginOpenTool
            ? {
                'openai/ui': {
                  entrypoints: [{ type: 'global' }, { type: 'thread' }],
                  preferredModelDisplayMode: 'fullscreen',
                },
              }
            : {}),
          ...(cloud ? { securitySchemes: [{ type: 'oauth2', scopes: ['inventory:read'] }] } : {}),
        },
      },
      async () => {
        const current = identity();
        if (!current?.scopes.has('inventory:read'))
          return {
            isError: true,
            content: [{ type: 'text', text: '需要库存读取权限。' }],
            structuredContent: {
              error: { code: 'FORBIDDEN', message: 'OAuth read scope is required.' },
            },
          };
        const snapshot = await webSnapshot(current.ctx, {});
        const summary = {
          household: snapshot.household.name,
          items: snapshot.items.length,
          catalog: snapshot.catalog.length,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(summary) }],
          structuredContent: summary,
          _meta: {
            [pluginMetaKey]: {
              version: 1,
              snapshot,
              session: {
                mode: cloud ? 'cloud' : 'local',
                authenticated: true,
                host: 'mcp',
                household_id: current.ctx.household_id,
                user_id: current.userId,
                cache_key: pluginScope(current, cloud),
                can_write: current.scopes.has('inventory:write'),
              },
            },
          },
        };
      },
    );
  }
}
