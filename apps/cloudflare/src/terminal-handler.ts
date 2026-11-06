import { requireMcpAuth } from '@better-auth/mcp';
import type { Auth } from './auth.js';
import type { Env } from './environment.js';
import { Memberships } from './memberships.js';
import { invoke, execute, type BusinessContext } from './business-client.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { entityId } from '../../../packages/contracts/src/ids.js';
import {
  terminalPrefix,
  terminalCallback,
  terminalCommands,
  historyQuery,
} from '../../../packages/contracts/src/terminal.js';
export async function handleTerminal(request: Request, env: Env, auth: Auth): Promise<Response> {
  const url = new URL(request.url),
    path = url.pathname,
    resource = env.ORIGIN + terminalPrefix;
  const unavailable = () =>
    Response.json(
      { error: { code: 'TERMINAL_UNAVAILABLE', message: '终端授权尚未配置。' } },
      { status: 503 },
    );
  if (!env.TERMINAL_CLIENT_ID) return unavailable();
  if (path === terminalPrefix + '/config' && request.method === 'GET')
    return Response.json({
      version: 1,
      client_id: env.TERMINAL_CLIENT_ID,
      resource,
      redirect_uri: env.ORIGIN + terminalCallback,
      authorization_endpoint: env.ORIGIN + '/api/auth/oauth2/authorize',
      token_endpoint: env.ORIGIN + '/api/auth/oauth2/token',
      revocation_endpoint: env.ORIGIN + '/api/auth/oauth2/revoke',
      scopes: ['openid', 'offline_access', 'inventory:read', 'inventory:write'],
    });
  const memberships = new Memberships(env);
  return requireMcpAuth(
    auth,
    async (_request, claims) => {
      if (
        claims.client_id !== env.TERMINAL_CLIENT_ID ||
        typeof claims.sub !== 'string' ||
        typeof claims.acornary_reference !== 'string'
      )
        return Response.json(
          { error: { code: 'TERMINAL_AUTH_INVALID', message: '请重新登录并授权当前家庭。' } },
          { status: 403 },
        );
      const identity = await memberships.tokenContext(claims.sub, claims.acornary_reference),
        user = identity && (await memberships.accounts.principal(claims.sub));
      if (!identity || !user)
        return Response.json(
          { error: { code: 'TERMINAL_AUTH_INVALID', message: '请重新登录并授权当前家庭。' } },
          { status: 403 },
        );
      const ctx: BusinessContext = { ...identity, env, source: 'ANDROID' };
      if (path === terminalPrefix + '/context' && request.method === 'GET')
        return Response.json({
          account: { id: user.id, name: user.name },
          household: (await invoke(ctx, 'context')).household,
          commands: terminalCommands,
        });
      if (path === terminalPrefix + '/snapshot' && request.method === 'GET')
        return Response.json(await invoke(ctx, 'terminalSnapshot'));
      const item = path.match(/^\/api\/terminal\/v1\/items\/([^/]+)(\/history)?$/);
      if (item && request.method === 'GET') {
        const parsed = entityId('item').safeParse(item[1]);
        if (!parsed.success) throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', '物品标识无效。');
        if (item[2]) {
          const query = historyQuery.safeParse(Object.fromEntries(url.searchParams));
          if (!query.success)
            throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', '历史分页参数无效。');
          await execute(ctx, 'get_item', { item_id: parsed.data });
          return Response.json(
            await execute(ctx, 'get_history', {
              ...query.data,
              target: { kind: 'ITEM', id: parsed.data },
            }),
          );
        }
        const result = await invoke(ctx, 'terminalSnapshot', { itemId: parsed.data });
        return Response.json({
          item: result.items[0],
          notes: result.notes,
          household: result.household,
          synced_at: result.synced_at,
        });
      }
      const command = path.match(/^\/api\/terminal\/v1\/commands\/([^/]+)$/);
      if (command && request.method === 'POST')
        return Response.json(
          await invoke(ctx, 'terminalCommand', { name: command[1], input: await request.json() }),
        );
      const operation = path.match(/^\/api\/terminal\/v1\/operations\/([^/]+)$/);
      if (operation && request.method === 'GET')
        return Response.json(
          await invoke(ctx, 'operation', { key: decodeURIComponent(operation[1]) }),
        );
      throw new DomainError('NOT_FOUND', 'Not found.');
    },
    {
      resource,
      requiredScopes: [request.method === 'POST' ? 'inventory:write' : 'inventory:read'],
    },
  )(request);
}
