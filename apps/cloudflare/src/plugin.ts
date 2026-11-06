import { reviewCatalogProposal, confirmCatalogProposal } from './business-client.js';
import {
  catalogReviewSchema,
  catalogConfirmSchema,
} from '../../../packages/contracts/src/intake.js';
import { deferredInput } from './mcp-input.js';
import { failure, traceMetadata, timed, traces } from './inventory/telemetry.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import {
  pluginMetaKey,
  pluginReviewTool,
  pluginConfirmTool,
  pluginReviewMetaKey,
  pluginOpenTool,
  pluginViewTool,
  pluginWriteTool,
  pluginWriteSchema,
  pluginWriteResultSchema,
} from '../../../packages/contracts/src/plugin.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { execute, type BusinessContext as Context } from './business-client.js';
import { webSnapshotV2 } from './business-client.js';
import { inventoryIcons } from './plugin-icons.js';

// MCP Apps have no authenticated binary channel. Reject before issuing tickets
// or committing uploads, including attempts through the app-only command tool.
export function assertMcpAttachmentTransport(operation: string) {
  if (operation === 'create_attachment_upload' || operation === 'complete_attachment_upload')
    throw new DomainError(
      'ATTACHMENT_TRANSPORT_UNSUPPORTED',
      'MCP Apps cannot upload or download attachment bytes. Use the Acornary website.',
    );
}

export function mcpFailure(error: unknown) {
  const rejected = failure(error);
  return rejected.code === 'ATTACHMENT_TRANSPORT_UNSUPPORTED'
    ? { ...rejected, recovery: 'USE_WEB' }
    : rejected;
}

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
export async function pluginResource(assets: Fetcher, origin: string) {
  const response = await assets.fetch(new Request(origin + '/plugin/index.html'));
  const html = response.ok ? await response.text() : null;
  const hash = createHash('sha256')
    .update('plugin-envelope:2\n')
    .update(html ?? 'not-built')
    .digest('hex')
    .slice(0, 16);
  return { html, uri: `ui://acornary/inventory-v2-${hash}.html` };
}
export function registerInventoryApp(
  server: McpServer,
  resource: Awaited<ReturnType<typeof pluginResource>>,
  identity: () => PluginIdentity | undefined,
  cloud: boolean,
) {
  for (const tool of [pluginReviewTool, pluginConfirmTool]) {
    registerAppTool(
      server,
      tool,
      {
        title: tool === pluginReviewTool ? '查看分类变更确认卡片' : '确认卡片中的分类变更',
        description:
          '仅供当前身份的界面使用。确认凭证绑定具体提案、依赖版本和当前会话，不能通过来源或布尔标记替代。',
        inputSchema: (tool === pluginReviewTool
          ? catalogReviewSchema
          : catalogConfirmSchema
        ).extend({ expected_scope: z.string() }) as any,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: tool === pluginConfirmTool,
          openWorldHint: false,
        },
        _meta: {
          ui: { visibility: ['app'] },
          ...(cloud ? { securitySchemes: [{ type: 'oauth2', scopes: ['inventory:write'] }] } : {}),
        },
      },
      async (args: any) => {
        try {
          const current = identity();
          if (!current?.scopes.has('inventory:write'))
            throw new DomainError('FORBIDDEN', 'OAuth write scope is required.');
          const scope = pluginScope(current, cloud);
          if (args.expected_scope !== scope)
            throw new DomainError('SESSION_CHANGED', 'The UI authorization context has changed.');
          const { expected_scope: _, ...input } = args;
          const result =
            tool === pluginReviewTool
              ? await reviewCatalogProposal(current.ctx, scope, input)
              : await confirmCatalogProposal(current.ctx, scope, input);
          return tool === pluginReviewTool
            ? {
                content: [
                  { type: 'text' as const, text: '确认卡片已加载。请在界面核对具体变更。' },
                ],
                _meta: { [pluginReviewMetaKey]: result },
              }
            : {
                content: [{ type: 'text' as const, text: JSON.stringify(result) }],
                structuredContent: result,
              };
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          const error = { code: e.code, message: e.message, details: e.details };
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
            structuredContent: { error },
          };
        }
      },
    );
  }
  registerAppTool(
    server,
    pluginWriteTool,
    {
      title: '提交库存界面修改',
      description: '仅提交当前 UI 会话的明确修改。预期会话只用于一致性检查，不选择身份或家庭。',
      inputSchema: deferredInput(pluginWriteSchema),
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
    async (raw) => {
      try {
        const parsed = pluginWriteSchema.safeParse(raw);
        if (!parsed.success)
          throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid UI command.', {
            issues: parsed.error.issues,
          });
        const args = parsed.data;
        const current = identity();
        if (!current?.scopes.has('inventory:write'))
          throw new DomainError('FORBIDDEN', 'OAuth write scope is required.');
        if (args.expected_scope !== pluginScope(current, cloud))
          throw new DomainError('SESSION_CHANGED', 'The UI authorization context has changed.');
        // Compare before entering execute(), including its idempotency replay.
        // This request's authenticated context is fixed; the input cannot replace it.
        assertMcpAttachmentTransport(args.operation);
        const result = pluginWriteResultSchema.parse(
          await execute({ ...current.ctx, source: 'MCP_UI' }, args.operation, args.input),
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
          _meta: { 'acornary/trace': traceMetadata() },
        };
      } catch (error) {
        const rejected = mcpFailure(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ error: rejected }) }],
          structuredContent: { error: rejected },
          _meta: { 'acornary/trace': traceMetadata() },
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
        title: name === pluginOpenTool ? 'Acornary' : '刷新库存视图',
        ...(name === pluginOpenTool ? { icons: inventoryIcons } : {}),
        description:
          name === pluginOpenTool
            ? '打开 Acornary 库存界面。选择具体物品后可在对话中指代该物品；选择本身不授权写入。'
            : '读取当前已授权家庭的完整界面投影。身份和家庭由服务端认证决定。',
        inputSchema: deferredInput(z.strictObject({})),
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
      async (raw) => {
        try {
          const trace = traces.getStore();
          if (trace) trace.tool = name;
          if (!z.strictObject({}).safeParse(raw).success)
            throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'This tool accepts no arguments.');
          const current = identity();
          if (!current?.scopes.has('inventory:read'))
            throw new DomainError('FORBIDDEN', 'OAuth read scope is required.');
          const snapshot = await timed('business_ms', () => webSnapshotV2(current.ctx));
          if (trace) trace.outcome = 'SUCCESS';
          const summary = {
            household: snapshot.household.name,
            items: snapshot.items.length,
            catalog: snapshot.catalog.length,
          };
          return {
            content: [{ type: 'text', text: JSON.stringify(summary) }],
            structuredContent: summary,
            _meta: {
              'acornary/trace': traceMetadata(),
              [pluginMetaKey]: {
                version: 2,
                protocol: 2,
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
        } catch (error) {
          const rejected = mcpFailure(error);
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ error: rejected }) }],
            structuredContent: { error: rejected },
            _meta: { 'acornary/trace': traceMetadata() },
          };
        }
      },
    );
  }
}
