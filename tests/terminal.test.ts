import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../apps/server/src/app.js';
import { createAuth } from '../apps/server/src/auth.js';
import { initialize, createHousehold } from '../apps/server/src/initialize.js';
import { manageOwner } from '../apps/server/src/owner.js';
import { pool, query, transaction } from '../apps/server/src/db.js';
import { approvedExecute } from './catalog-helpers.js';
import { registerTerminalClient } from '../apps/server/src/register-terminal.js';
import { terminalSnapshot } from '../apps/server/src/terminal.js';
import { terminalPrefix as prefix, terminalCallback } from '../packages/contracts/src/terminal.js';
import type { RuntimeConfig } from '../apps/server/src/config.js';

const config: Extract<RuntimeConfig, { mode: 'cloud' }> = {
  mode: 'cloud',
  origin: 'https://terminal.example.test',
  resource: 'https://terminal.example.test/mcp',
  trustedProxy: '172.30.78.10',
  secret: 'isolated-test-only-secret-at-least-32-characters',
  terminal: { clientId: '', signingFingerprints: [Array(32).fill('AB').join(':')] },
};
let auth: ReturnType<typeof createAuth>, app: Awaited<ReturnType<typeof buildApp>>;
let ctx: any,
  userId: string,
  cookie: string,
  item: string,
  otherItem: string,
  container: string,
  token: string;
const resource = config.origin + prefix;
const request = (url: string, options: any = {}) =>
  app.inject({
    ...options,
    url,
    remoteAddress: config.trustedProxy,
    headers: { host: 'terminal.example.test', 'x-forwarded-proto': 'https', ...options.headers },
  });
const post = (url: string, payload: any, headers: any = {}) =>
  request(url, {
    method: 'POST',
    payload,
    headers: { 'content-type': 'application/json', ...headers },
  });
const bearer = (value = token) => ({ authorization: `Bearer ${value}` });
const write = (name: any, input: any, c = ctx) =>
  approvedExecute(c, name, { idempotency_key: randomUUID(), ...input });
async function client() {
  const id = await registerTerminalClient(config, 'test-terminal-' + randomUUID());
  await query(
    pool,
    'INSERT INTO "oauthClientResource" (id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING',
    [randomUUID(), id, config.resource],
  );
  return id;
}
async function grant(
  scopes = 'openid offline_access inventory:read inventory:write',
  target = resource,
  id = config.terminal!.clientId,
  wrongVerifier = false,
) {
  const verifier = randomUUID() + randomUUID();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: config.origin + terminalCallback,
    scope: scopes,
    resource: target,
    state: 'terminal-state',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const r = await request('/api/auth/oauth2/authorize?' + params, {
    headers: { cookie, accept: 'text/html' },
  });
  expect(r.statusCode, r.body).toBe(302);
  let location = new URL(r.headers.location!, config.origin);
  if (location.pathname === '/consent') {
    const consent = await post(
      '/api/auth/oauth2/consent',
      { accept: true, oauth_query: location.search.slice(1) },
      { cookie, origin: config.origin },
    );
    expect(consent.statusCode, consent.body).toBe(200);
    location = new URL(consent.json().redirect_uri ?? consent.json().url);
  }
  expect(location.pathname).toBe(terminalCallback);
  expect(location.searchParams.get('state')).toBe('terminal-state');
  const result = await request('/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: id,
      code: location.searchParams.get('code')!,
      code_verifier: wrongVerifier
        ? 'incorrect-verifier-with-at-least-43-characters-here'
        : verifier,
      redirect_uri: config.origin + terminalCallback,
      resource: target,
    }).toString(),
  });
  expect(result.statusCode, result.body).toBe(wrongVerifier ? 401 : 200);
  return result.json();
}
beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('acornary_test'))
    throw new Error('Isolated database required');
  ctx = { ...(await initialize()), source: 'TEST' };
  await query(pool, 'DELETE FROM "user" WHERE id IN (SELECT user_id FROM auth_owners)');
  const email = `terminal-${randomUUID()}@example.test`,
    password = 'Isolated-terminal-password-123!';
  await manageOwner('create', email, password);
  userId = (await query(pool, 'SELECT user_id FROM auth_owners')).rows[0].user_id;
  auth = createAuth(config);
  await auth.$context;
  config.terminal!.clientId = await client();
  app = await buildApp(ctx, 'not-a-cloud-token', false, config);
  await app.ready();
  const fetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: any, init: any) =>
    String(input instanceof Request ? input.url : input) === config.origin + '/api/auth/jwks'
      ? auth.handler(new Request(config.origin + '/api/auth/jwks', init))
      : fetch(input, init),
  );
  const login = await post(
    '/api/auth/sign-in/email',
    { email, password },
    { origin: config.origin },
  );
  expect(login.statusCode, login.body).toBe(200);
  cookie = (login.headers['set-cookie'] as string[]).map((s) => s.split(';')[0]).join('; ');
  const sku = (await write('create_catalog_node', { kind: 'SKU', name: '终端测试牛奶' }))
    .affected_objects[0].id;
  container = (
    await write('create_items', {
      catalog_node_id: ctx.container_catalog_id,
      display_name: '测试冰箱',
      count: 1,
      initial_attributes: [
        { template_id: 'container', template_version: 1, values: { can_contain: true } },
      ],
    })
  ).affected_objects[0].id;
  item = (
    await write('create_items', {
      catalog_node_id: sku,
      count: 1,
      parent_id: container,
      initial_attributes: [
        {
          template_id: 'contents',
          template_version: 1,
          values: { remaining: { value: '1000', unit: 'mL' }, accuracy: 'MEASURED' },
        },
        {
          template_id: 'lifecycle',
          template_version: 1,
          values: { expiry: { date: '2026-11-20', after_opening_days: 3 } },
        },
      ],
    })
  ).affected_objects[0].id;
  const other = {
    ...(await transaction((c) => createHousehold(c, 'Other', 'America/Los_Angeles'))),
    source: 'TEST',
  };
  const otherSku = (await write('create_catalog_node', { kind: 'SKU', name: 'Other' }, other))
    .affected_objects[0].id;
  otherItem = (await write('create_items', { catalog_node_id: otherSku, count: 1 }, other))
    .affected_objects[0].id;
  token = (await grant()).access_token;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  await pool.end();
});

it('provisions a fixed public PKCE client idempotently without a secret', async () => {
  const softwareId = 'idempotent-test-' + randomUUID();
  const id = await registerTerminalClient(config, softwareId);
  expect(await registerTerminalClient(config, softwareId)).toBe(id);
  const client = (
    await query(
      pool,
      'SELECT "clientSecret","requirePKCE","tokenEndpointAuthMethod","skipConsent" FROM "oauthClient" WHERE "clientId"=$1',
      [id],
    )
  ).rows[0];
  expect(client).toMatchObject({
    clientSecret: null,
    requirePKCE: true,
    tokenEndpointAuthMethod: 'none',
    skipConsent: false,
  });
});
it('publishes only public config and verifies Android certificate associations', async () => {
  expect((await request(prefix + '/config')).json()).toMatchObject({
    client_id: config.terminal!.clientId,
    resource,
    redirect_uri: config.origin + terminalCallback,
  });
  expect((await request('/.well-known/assetlinks.json')).json()[0].target.package_name).toBe(
    'top.protium.acornary',
  );
  expect((await request(prefix + '/snapshot')).statusCode).toBe(401);
  expect((await request(prefix + '/snapshot', { headers: { cookie } })).statusCode).toBe(401);
});
it('rejects wrong audience, other clients, missing scope and cross-family reads', async () => {
  const wrongAudience = await grant(undefined, config.resource);
  expect(
    (await request(prefix + '/snapshot', { headers: bearer(wrongAudience.access_token) }))
      .statusCode,
  ).toBe(401);
  const wrongClient = await grant(undefined, resource, await client());
  expect(
    (await request(prefix + '/snapshot', { headers: bearer(wrongClient.access_token) })).statusCode,
  ).toBe(403);
  expect((await request(prefix + '/items/' + otherItem, { headers: bearer() })).statusCode).toBe(
    404,
  );
  const snapshot = (
    await request(prefix + '/snapshot', {
      headers: { ...bearer(), 'x-acornary-household': 'untrusted-household' },
    })
  ).json();
  expect(snapshot.household.id).toBe(ctx.household_id);
  expect(snapshot.items.find((i: any) => i.id === item)).toMatchObject({
    location: '测试冰箱',
    remaining: { value: '1000', unit: 'mL' },
  });
  const readOnly = await grant('openid inventory:read');
  expect(
    (await post(prefix + '/commands/open_item', {}, bearer(readOnly.access_token))).statusCode,
  ).toBe(403);
});
it('uses household reminder dates, preserves idempotency and records ANDROID', async () => {
  const body = {
    item_id: item,
    opened_at: '2026-10-29T17:00:00Z',
    expected_revisions: { [item]: 1 },
    idempotency_key: randomUUID(),
  };
  const first = await post(prefix + '/commands/open_item', body, bearer());
  expect(first.statusCode, first.body).toBe(200);
  expect((await post(prefix + '/commands/open_item', body, bearer())).json()).toEqual(first.json());
  const detail = (await request(prefix + '/items/' + item, { headers: bearer() })).json();
  expect(detail.item.reminder.date).toBe('2026-11-02');
  expect(detail.item.revision).toBe(2);
  expect(
    (await request(prefix + '/operations/' + body.idempotency_key, { headers: bearer() })).json(),
  ).toMatchObject({ status: 'committed', result: first.json() });
  expect(
    (await request(prefix + '/operations/' + randomUUID(), { headers: bearer() })).json(),
  ).toEqual({ status: 'unknown' });
  const events = (
    await request(prefix + '/items/' + item + '/history', { headers: bearer() })
  ).json();
  expect(events.data.some((e: any) => e.source === 'ANDROID')).toBe(true);
});
it('enforces single-item capability, revision conflicts and exact decimal subtraction', async () => {
  expect((await post(prefix + '/commands/create_items', {}, bearer())).statusCode).toBe(403);
  expect(
    (
      await post(
        prefix + '/commands/consume_items',
        {
          item_ids: [item, container],
          expected_revisions: { [item]: 2, [container]: 1 },
          idempotency_key: randomUUID(),
        },
        bearer(),
      )
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        prefix + '/commands/consume_items',
        {
          item_ids: [container],
          expected_revisions: { [container]: 1 },
          idempotency_key: randomUUID(),
        },
        bearer(),
      )
    ).statusCode,
  ).toBe(403);
  const input = {
    item_id: item,
    expected_revisions: { [item]: 1 },
    amount: { value: '0.1', unit: 'mL' },
    idempotency_key: randomUUID(),
  };
  expect((await post(prefix + '/commands/consume_item_content', input, bearer())).statusCode).toBe(
    409,
  );
  const result = await post(
    prefix + '/commands/consume_item_content',
    { ...input, expected_revisions: { [item]: 2 } },
    bearer(),
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(
    (await request(prefix + '/items/' + item, { headers: bearer() })).json().item.remaining.value,
  ).toBe('999.9');
});
it('removes consumed items from snapshot but keeps scan detail available', async () => {
  expect(
    (
      await post(
        prefix + '/commands/consume_items',
        { item_ids: [item], expected_revisions: { [item]: 3 }, idempotency_key: randomUUID() },
        bearer(),
      )
    ).statusCode,
  ).toBe(200);
  expect((await terminalSnapshot(ctx)).items.some((i) => i.id === item)).toBe(false);
  expect(
    (await request(prefix + '/items/' + item, { headers: bearer() })).json().item.terminal,
  ).toBe(true);
});
it('rejects invalid PKCE, malformed IDs and missing explicit opening time', async () => {
  await grant(undefined, resource, config.terminal!.clientId, true);
  expect((await request(prefix + '/items/not-an-item', { headers: bearer() })).statusCode).toBe(
    400,
  );
  expect(
    (await request(prefix + '/items/' + item + '/history?limit=999', { headers: bearer() }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await post(
        prefix + '/commands/open_item',
        { item_id: item, expected_revisions: { [item]: 4 }, idempotency_key: randomUUID() },
        bearer(),
      )
    ).statusCode,
  ).toBe(400);
});
it('rotates refresh tokens for the terminal audience and rejects reuse', async () => {
  const initial = await grant();
  expect(typeof initial.refresh_token).toBe('string');
  const refresh = (value: string) =>
    request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.terminal!.clientId,
        refresh_token: value,
        resource,
      }).toString(),
    });
  const next = await refresh(initial.refresh_token);
  expect(next.statusCode, next.body).toBe(200);
  expect(typeof next.json().refresh_token).toBe('string');
  expect(next.json().refresh_token).not.toBe(initial.refresh_token);
  expect(
    (await request(prefix + '/context', { headers: bearer(next.json().access_token) })).statusCode,
  ).toBe(200);
  expect((await refresh(initial.refresh_token)).statusCode).toBe(400);
});
it('rejects disabled accounts without waiting for token expiry', async () => {
  await query(pool, 'UPDATE "user" SET enabled=false WHERE id=$1', [userId]);
  expect((await request(prefix + '/snapshot', { headers: bearer() })).statusCode).toBe(403);
  await query(pool, 'UPDATE "user" SET enabled=true WHERE id=$1', [userId]);
});
it('rejects a removed household membership immediately', async () => {
  const member = (
    await query(
      pool,
      'DELETE FROM household_members WHERE user_id=$1 AND household_id=$2 RETURNING *',
      [userId, ctx.household_id],
    )
  ).rows[0];
  expect((await request(prefix + '/snapshot', { headers: bearer() })).statusCode).toBe(403);
  await query(
    pool,
    'INSERT INTO household_members(id,user_id,household_id,actor_id,joined_at) VALUES($1,$2,$3,$4,$5)',
    [member.id, member.user_id, member.household_id, member.actor_id, member.joined_at],
  );
});
it('rejects a previously valid token immediately after authorization version changes', async () => {
  await query(pool, 'UPDATE "user" SET auth_version=auth_version+1 WHERE id=$1', [userId]);
  expect((await request(prefix + '/snapshot', { headers: bearer() })).statusCode).toBe(403);
});
