import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireMcpAuth } from '@better-auth/mcp';
import type { Auth } from './auth.js';
import type { RuntimeConfig } from './config.js';
import { activeUser, tokenContext } from './memberships.js';
import { pool, query, transaction } from './db.js';
import { execute, type Context } from './service.js';
import { DomainError, reminderDate } from '../../../packages/domain/src/index.js';
import { entityId } from '../../../packages/contracts/src/ids.js';
import { attr, ancestors, itemName, locationName, isTerminal, isContainer, type InventoryData } from '../../../packages/contracts/src/web.js';
import { terminalPrefix, terminalCallback, terminalCommands, terminalCommand, historyQuery, type TerminalItem, type TerminalSnapshot } from '../../../packages/contracts/src/terminal.js';

type Cloud = Extract<RuntimeConfig, { mode: 'cloud' }>;
type Identity = Context & { account: { id: string; name: string } };

/** Read the entire projection in one MVCC snapshot; no per-item SQL. */
export async function terminalSnapshot(ctx: Context, itemId?: string): Promise<TerminalSnapshot & { notes?: unknown[] }> {
  return transaction(async (c) => {
    await query(c, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const household = (await query(c, 'SELECT id,name,timezone FROM households WHERE id=$1', [ctx.household_id])).rows[0];
    const data: InventoryData = {
      household, container_catalog_id: '', cached_at: new Date().toISOString(), notes: [],
      catalog: (await query(c, 'SELECT id,parent_id,kind,name,revision,attributes FROM catalog_nodes WHERE household_id=$1', [ctx.household_id])).rows,
      items: (await query(c, 'SELECT id,parent_id,catalog_node_id,display_name,revision,attributes,created_at FROM items WHERE household_id=$1 ORDER BY created_at,id', [ctx.household_id])).rows,
    };
    const catalog = new Map(data.catalog.map((r) => [r.id, r]));
    const selected = data.items.filter((i) => itemId ? i.id === itemId : !isTerminal(i));
    if (itemId && !selected.length) throw new DomainError('NOT_FOUND', '物品不存在或不属于当前家庭。');
    const items: TerminalItem[] = selected.map((i) => {
      const life = attr(i, 'lifecycle');
      const contents = attr(i, 'contents');
      const sku = catalog.get(i.catalog_node_id);
      const product = sku && attr(sku, 'product');
      return {
        id: i.id, name: itemName(i, data), brand: product?.brand ?? '', specification: product?.specification ?? '',
        revision: i.revision, is_container: isContainer(i), terminal: isTerminal(i), state: life?.state ?? null,
        opening_state: life?.opening?.state ?? null, opened_at: life?.opening?.opened_at ?? null,
        expiry_date: life?.expiry?.date ?? null, expiry_kind: life?.expiry?.date_kind ?? null,
        after_opening_days: life?.expiry?.after_opening_days ?? null,
        remaining: contents?.remaining ?? null, accuracy: contents?.accuracy ?? null,
        reminder: reminderDate(life, household.timezone), location_ids: ancestors(i.parent_id, data.items).map((x) => x.id),
        location: locationName(i, data),
      };
    });
    return { version: 1, household, synced_at: data.cached_at, items,
      ...(itemId ? { notes: (await query(c, 'SELECT id,title,body,updated_at FROM notes WHERE household_id=$1 AND item_id=$2 ORDER BY updated_at DESC,id', [ctx.household_id, itemId])).rows } : {}),
    };
  });
}

export function registerTerminal(app: FastifyInstance, auth: Auth, config: Cloud) {
  const identities = new WeakMap<FastifyRequest, Identity>();
  const resource = config.origin + terminalPrefix;
  const requireIdentity = async (req: FastifyRequest, reply: any) => {
    if (!config.terminal?.clientId) return reply.code(503).send({ error: { code: 'TERMINAL_UNAVAILABLE', message: '终端授权尚未配置。' } });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const response = await requireMcpAuth(auth, async (_request, claims) => {
      if (claims.client_id !== config.terminal!.clientId || typeof claims.sub !== 'string' || typeof claims.acornary_reference !== 'string')
        return new Response(null, { status: 403 });
      const ctx = await tokenContext(claims.sub, claims.acornary_reference);
      const user = ctx && await activeUser(claims.sub);
      if (!ctx || !user) return new Response(null, { status: 403 });
      identities.set(req, { ...ctx, source: 'ANDROID', account: { id: user.id, name: user.name } });
      return new Response(null, { status: 204 });
    }, { resource, requiredScopes: [req.method === 'POST' ? 'inventory:write' : 'inventory:read'] })(new Request(config.origin + req.url, { headers }));
    if (response.status !== 204) {
      const challenge = response.headers.get('www-authenticate');
      if (challenge) reply.header('WWW-Authenticate', challenge);
      return reply.code(response.status).send({ error: { code: 'TERMINAL_AUTH_INVALID', message: '请重新登录并授权当前家庭。' } });
    }
  };
  const context = (req: FastifyRequest) => identities.get(req)!;
  const itemId = (value: unknown) => { const parsed = entityId('item').safeParse(value); if (!parsed.success) throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', '物品标识无效。'); return parsed.data; };
  const historyInput = (value: unknown) => { const parsed = historyQuery.safeParse(value); if (!parsed.success) throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', '历史分页参数无效。'); return parsed.data; };
  app.get(`${terminalPrefix}/config`, async (_req, reply) => {
    if (!config.terminal?.clientId) return reply.code(503).send({ error: { code: 'TERMINAL_UNAVAILABLE', message: '终端授权尚未配置。' } });
    return { version: 1, client_id: config.terminal.clientId, resource, redirect_uri: config.origin + terminalCallback,
      authorization_endpoint: config.origin + '/api/auth/oauth2/authorize', token_endpoint: config.origin + '/api/auth/oauth2/token',
      revocation_endpoint: config.origin + '/api/auth/oauth2/revoke', scopes: ['openid', 'offline_access', 'inventory:read', 'inventory:write'] };
  });
  app.get('/.well-known/assetlinks.json', async () => config.terminal?.signingFingerprints.length ? [{
    relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'top.protium.acornary', sha256_cert_fingerprints: config.terminal.signingFingerprints },
  }] : []);
  app.get(terminalCallback, async (_req, reply) => reply.type('text/html').send('<!doctype html><meta charset="utf-8"><title>返回松仓终端</title><p>请返回松仓终端完成登录。若未自动返回，请检查 Android 的“打开支持的链接”设置。</p>'));
  app.get(`${terminalPrefix}/context`, { preHandler: requireIdentity }, async (req) => ({
    account: context(req).account,
    household: (await query(pool, 'SELECT id,name,timezone FROM households WHERE id=$1', [context(req).household_id])).rows[0],
    commands: terminalCommands,
  }));
  app.get(`${terminalPrefix}/snapshot`, { preHandler: requireIdentity }, (req) => terminalSnapshot(context(req)));
  app.get(`${terminalPrefix}/items/:id`, { preHandler: requireIdentity }, async (req) => {
    const id = itemId((req.params as any).id);
    const result = await terminalSnapshot(context(req), id);
    return { item: result.items[0], notes: result.notes, household: result.household, synced_at: result.synced_at };
  });
  app.get(`${terminalPrefix}/items/:id/history`, { preHandler: requireIdentity }, async (req) => {
    const id = itemId((req.params as any).id);
    // Verify existence and household before returning history, even for an empty event list.
    await execute(context(req), 'get_item', { item_id: id });
    return execute(context(req), 'get_history', { ...historyInput(req.query), target: { kind: 'ITEM', id } });
  });
  app.post(`${terminalPrefix}/commands/:operation`, { preHandler: requireIdentity }, async (req) => {
    const name = (req.params as any).operation;
    let input;
    try { input = terminalCommand(name, req.body); } catch { throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', '操作参数无效，终端仅支持单件操作。'); }
    if (!input) throw new DomainError('FORBIDDEN', '终端不支持此操作。');
    const ctx = context(req);
    const replay = (await query(pool, 'SELECT 1 FROM operations WHERE household_id=$1 AND actor_id=$2 AND idempotency_key=$3', [ctx.household_id, ctx.actor_id, input.idempotency_key])).rowCount;
    if (replay) return execute(ctx, name, input);
    // Containers are location navigation, never consumable from the terminal.
    const id = 'item_id' in input ? input.item_id : input.item_ids[0];
    const item = (await terminalSnapshot(context(req), id)).items[0];
    if (item.is_container) throw new DomainError('FORBIDDEN', '请在电脑上管理容器。');
    return execute(context(req), name, input);
  });
  app.get(`${terminalPrefix}/operations/:key`, { preHandler: requireIdentity }, async (req) => {
    const key = (req.params as any).key;
    if (typeof key !== 'string' || key.length > 200) throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid operation key.');
    const ctx = context(req);
    const result = (await query(pool, 'SELECT result FROM operations WHERE household_id=$1 AND actor_id=$2 AND idempotency_key=$3', [ctx.household_id, ctx.actor_id, key])).rows[0]?.result;
    return result ? { status: 'committed', result } : { status: 'unknown' };
  });
}
