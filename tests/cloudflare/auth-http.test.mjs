import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
let mf,
  db,
  jwksForTest,
  ipSequence = 1;
const origin = 'https://cf.auth-test.invalid';
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'output/cloudflare-auth/auth-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      outboundService: async (req) => {
        if (req.url === 'https://cimd.example.org/redirect.json')
          return Response.redirect('https://127.0.0.1/', 302);
        if (req.url === 'https://cimd.example.org/client.json') {
          assert.equal(req.headers.get('authorization'), null);
          assert.equal(req.headers.get('cookie'), null);
          return Response.json({
            client_id: req.url,
            client_name: 'CIMD regression',
            application_type: 'native',
            redirect_uris: ['http://127.0.0.1/callback'],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          });
        }
        if (req.url === origin + '/api/auth/jwks' && jwksForTest)
          return new Response(jwksForTest, { headers: { 'content-type': 'application/json' } });
        throw new Error('Unexpected external request ' + new URL(req.url).origin);
      },
      serviceBindings: {
        ASSETS: async () =>
          new Response('<!doctype html><title>Isolated UI fixture</title>', {
            headers: { 'content-type': 'text/html' },
          }),
      },
      r2Buckets: { BLOBS: 'test-blobs', BACKUPS: 'test-backups' },
      d1Databases: { AUTH_DB: 'auth-http' },
      durableObjects: {
        HOUSEHOLDS: { className: 'HouseholdStore', useSQLite: true },
        UPLOADS: { className: 'AttachmentUpload', useSQLite: true },
      },
      bindings: {
        ORIGIN: origin,
        AUTH_SECRET: 'test-only-independent-secret-32-characters',
        ENVIRONMENT: 'test',
        RELEASE_VERSION: 'test',
        RELEASE_COMMIT: 'test',
        TERMINAL_CLIENT_ID: 'test-terminal',
      },
    }),
  );
  db = await mf.getD1Database('AUTH_DB');
  for (const name of ['0001_better_auth.sql', '0002_directory.sql', '0004_account_commands.sql'])
    for (const stmt of (await readFile('apps/cloudflare/migrations/auth/' + name, 'utf8'))
      .split(';')
      .filter((v) => v.trim()))
      await db.prepare(stmt).run();
});
after(async () => {
  await mf?.dispose();
});
test('CIMD SDK redirect:error works on workerd while HTTP redirects stay forbidden', async () => {
  const a = await fixture();
  for (const [path, allowed] of [
    ['client.json', true],
    ['redirect.json', false],
  ]) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'https://cimd.example.org/' + path,
      redirect_uri: 'http://127.0.0.1:45123/callback',
      resource: origin + '/mcp',
      scope: 'openid inventory:read',
      state: 'cimd-test',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256')
        .update('cimd-test-verifier-'.repeat(4))
        .digest('base64url'),
    });
    const response = await a.request('/oauth2/authorize?' + params, undefined, {
      accept: 'text/html',
      'sec-fetch-mode': 'navigate',
    });
    if (allowed) assert.ok([200, 302].includes(response.status), JSON.stringify(response.data));
    else {
      assert.equal(response.status, 400);
      assert.equal(response.data.error, 'invalid_client');
    }
  }
});
async function fixture() {
  const user = crypto.randomUUID(),
    email = user + '@example.invalid',
    password = 'synthetic-password-123',
    now = new Date().toISOString(),
    ip = '203.0.113.' + ipSequence++;
  await db
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?1,?2,?3,1,?4,?4,1,0)',
    )
    .bind(user, '测试账号', email, now)
    .run();
  await db
    .prepare(
      "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?1,?2,'credential',?2,?3,?4,?4)",
    )
    .bind(crypto.randomUUID(), user, await hashPassword(password), now)
    .run();
  let cookie = '';
  const client = {
    get cookie() {
      return cookie;
    },
    user,
    email,
    password,
    request: async (path, body, headers = {}) => {
      const res = await mf.dispatchFetch(
        origin + (path.startsWith('/api/') || path === '/mcp' ? path : '/api/auth' + path),
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            origin,
            cookie,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            'cf-connecting-ip': ip,
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const cookies = res.headers.getSetCookie();
      if (cookies.length)
        cookie = [
          ...new Map(
            [...cookie.split('; ').filter(Boolean), ...cookies.map((s) => s.split(';')[0])].map(
              (c) => [c.split('=')[0], c],
            ),
          ).values(),
        ].join('; ');
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        const line = text.split('\n').find((l) => l.startsWith('data: '));
        try {
          data = JSON.parse(line?.slice(6) ?? 'null');
        } catch {
          data = text;
        }
      }
      return { status: res.status, data, headers: res.headers };
    },
  };
  const signed = await client.request('/sign-in/email', { email, password });
  assert.equal(signed.status, 200, JSON.stringify(signed));
  assert.match(signed.headers.get('set-cookie'), /acornary-test/);
  assert.match(signed.headers.get('set-cookie'), /Secure/);
  assert.match(signed.headers.get('set-cookie'), /HttpOnly/);
  return client;
}
test('real Better Auth D1 login uses isolated secure cookies, closed enrollment and guarded credentials', async () => {
  const a = await fixture();
  assert.equal((await a.request('/account/capabilities')).data.registration, false);
  assert.equal(
    (
      await a.request('/sign-up/email', {
        email: 'unknown@example.invalid',
        password: a.password,
        name: 'Unknown',
      })
    ).status,
    404,
  );
  assert.equal(
    (await a.request('/account/email/start', { email: a.email, purpose: 'recover' })).status,
    403,
  );
  const credentials = await a.request('/account/credentials');
  assert.equal(credentials.status, 200, JSON.stringify(credentials));
  assert.equal(credentials.data.password, true);
  assert.equal((await a.request('/account/password', { password: null })).status, 400);
  assert.equal(
    (
      await a.request(
        '/account/password',
        { password: 'synthetic-replacement-123' },
        { origin: 'https://evil.invalid' },
      )
    ).status,
    403,
  );
  const changed = await a.request('/account/password', { password: 'synthetic-replacement-123' });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.equal(
    (await db.prepare('SELECT auth_version FROM user WHERE id=?').bind(a.user).first())
      .auth_version,
    1,
  );
  assert.equal((await a.request('/account/passkey/options', { enrollment: false })).status, 200);
  assert.equal((await a.request('/account/passkey/complete', { response: {} })).status, 400);
  await db.prepare('UPDATE user SET enabled=0 WHERE id=?').bind(a.user).run();
  assert.equal((await a.request('/account/credentials')).status, 401);
});
test('household tasks create, invite, redeem, rename and revoke access through authoritative DO membership', async () => {
  const a = await fixture(),
    b = await fixture();
  const created = await a.request('/account/household', {
    action: 'create',
    name: '云原生测试家庭',
  });
  assert.equal(created.status, 200, JSON.stringify(created));
  const hh = created.data.household_id;
  assert.equal((await a.request('/account/households')).data.households[0].household_id, hh);
  const invite = await a.request('/account/household', { action: 'invite', household_id: hh });
  assert.equal(invite.status, 200, JSON.stringify(invite));
  const token = new URL(invite.data.url).searchParams.get('token');
  assert.equal((await b.request('/account/invitation', { token })).data.name, '云原生测试家庭');
  assert.equal((await b.request('/account/household', { action: 'join', token })).status, 200);
  assert.equal(
    (await a.request('/account/household', { action: 'members', household_id: hh })).data.members
      .length,
    2,
  );
  assert.equal(
    (
      await b.request('/account/household', {
        action: 'rename',
        household_id: hh,
        name: '新的家庭名称',
      })
    ).status,
    200,
  );
  assert.equal((await a.request('/account/households')).data.households[0].name, '新的家庭名称');
  assert.equal(
    (await b.request('/account/household', { action: 'leave', household_id: hh })).status,
    200,
  );
  assert.equal(
    (await b.request('/account/household', { action: 'members', household_id: hh })).status,
    403,
  );
  assert.equal((await b.request('/account/households')).data.households.length, 0);
  assert.equal(
    (await a.request('/account/household', { action: 'leave', household_id: hh })).status,
    400,
  );
  assert.equal((await a.request('/account/households')).data.households.length, 1);
  const pending = await db
    .prepare("SELECT count(*) n FROM cf_account_tasks WHERE status='PENDING'")
    .first();
  assert.equal(pending.n, 0);
});
test('OAuth discovery advertises the preview issuer and public PKCE endpoints', async () => {
  const response = await mf.dispatchFetch(
    origin + '/.well-known/oauth-authorization-server/api/auth',
  );
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.issuer, origin + '/api/auth');
  assert.ok(data.code_challenge_methods_supported.includes('S256'));
  const res = await mf.dispatchFetch(origin + '/.well-known/oauth-protected-resource/mcp');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).resource, origin + '/mcp');
});
async function inventory(a) {
  const created = await a.request('/account/household', { action: 'create', name: '接口测试家庭' });
  assert.equal(created.status, 200, JSON.stringify(created));
  const hh = created.data.household_id,
    headers = {
      'x-acornary-household': hh,
      'x-acornary-account': a.user,
      'x-acornary-protocol': '2',
      'x-acornary-request': 'web',
    };
  const run = (name, input = {}) =>
    a.request(
      '/api/' +
        (['query_items', 'get_item', 'get_connection_context'].includes(name)
          ? 'read/'
          : 'write/') +
        name,
      input,
      headers,
    );
  const operation = {
    idempotency_key: crypto.randomUUID(),
    kind: 'SKU',
    name: '接口测试牛奶',
    profile: 'CONSUMABLE',
  };
  const proposed = await run('propose_catalog_change', {
    idempotency_key: crypto.randomUUID(),
    proposal: {
      kind: 'catalog_command',
      operation: 'create_catalog_node',
      input: operation,
      reason: 'Isolated acceptance',
    },
  });
  assert.equal(proposed.status, 200, JSON.stringify(proposed));
  const review = await a.request(
    '/api/ui/catalog-review',
    { proposal_id: proposed.data.proposal_id },
    headers,
  );
  assert.equal(review.status, 200, JSON.stringify(review));
  const confirm = await a.request(
    '/api/ui/catalog-confirm',
    { proposal_id: proposed.data.proposal_id, challenge: review.data.challenge },
    headers,
  );
  assert.equal(confirm.status, 200, JSON.stringify(confirm));
  const catalog = await run('create_catalog_node', {
    ...operation,
    approval_id: confirm.data.approval_id,
  });
  assert.equal(catalog.status, 200, JSON.stringify(catalog));
  const input = {
    idempotency_key: crypto.randomUUID(),
    catalog_node_id: catalog.data.affected_objects[0].id,
    count: 1,
    initial_attributes: [
      {
        template_id: 'contents',
        template_version: 1,
        values: { remaining: { value: '1000', unit: 'mL' } },
      },
    ],
  };
  const item = await run('create_items', input);
  assert.equal(item.status, 200, JSON.stringify(item));
  assert.deepEqual((await run('create_items', input)).data, item.data);
  return { hh, headers, run, item: item.data.affected_objects[0].id };
}
test('Fetch REST preserves protocol, approvals, revision errors, inspector redaction and sync contracts', async () => {
  const a = await fixture(),
    inv = await inventory(a);
  assert.equal((await a.request('/api/ui/snapshot', undefined, inv.headers)).data.items.length, 1);
  const protocol = await a.request(
    '/api/read/query_items',
    {},
    { ...inv.headers, 'x-acornary-protocol': '1' },
  );
  assert.equal(protocol.status, 409);
  assert.equal(protocol.data.error.code, 'PROTOCOL_VERSION_UNSUPPORTED');
  const stale = await inv.run('consume_item_content', {
    idempotency_key: crypto.randomUUID(),
    item_id: inv.item,
    amount: { value: '1', unit: 'mL' },
    expected_revisions: { [inv.item]: 100 },
  });
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.equal(stale.data.error.code, 'REVISION_CONFLICT');
  assert.equal((await a.request('/api/sync/state', undefined, inv.headers)).status, 200);
  for (const table of ['items', 'events', 'operations', 'migrations', 'installations']) {
    const debug = await a.request(
      '/api/debug?input=' + encodeURIComponent(JSON.stringify({ view: 'system', table })),
      undefined,
      inv.headers,
    );
    assert.equal(debug.status, 200, table + JSON.stringify(debug));
    assert.ok(Array.isArray(debug.data.rows));
  }
  const foreign = await fixture();
  assert.equal(
    (
      await foreign.request('/api/ui/snapshot', undefined, {
        ...inv.headers,
        'x-acornary-account': foreign.user,
      })
    ).status,
    403,
  );
});
async function client(id, resource, redirect) {
  const scopes = ['openid', 'offline_access', 'inventory:read', 'inventory:write'],
    now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO oauthClient(id,clientId,disabled,skipConsent,scopes,createdAt,updatedAt,name,redirectUris,tokenEndpointAuthMethod,applicationType,grantTypes,responseTypes,requirePKCE) VALUES(?1,?1,0,0,?2,?3,?3,?1,?4,'none','native',?5,?6,1)",
    )
    .bind(
      id,
      JSON.stringify(scopes),
      now,
      JSON.stringify([redirect]),
      JSON.stringify(['authorization_code', 'refresh_token']),
      JSON.stringify(['code']),
    )
    .run();
  await db
    .prepare(
      "INSERT INTO oauthResource(id,identifier,name,accessTokenTtl,refreshTokenTtl,allowedScopes,disabled,createdAt,updatedAt,policyVersion) VALUES(?1,?2,'Test',300,2592000,?3,0,?4,?4,1) ON CONFLICT(identifier) DO NOTHING",
    )
    .bind(crypto.randomUUID(), resource, JSON.stringify(scopes), now)
    .run();
  await db
    .prepare(
      'INSERT INTO oauthClientResource(id,clientId,resourceId,createdAt) VALUES(?1,?2,?3,?4)',
    )
    .bind(crypto.randomUUID(), id, resource, now)
    .run();
}
async function token(body) {
  const response = await mf.dispatchFetch(origin + '/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: response.status, data: await response.json() };
}
async function grant(
  a,
  client_id,
  resource,
  redirect_uri,
  scope = 'openid offline_access inventory:read inventory:write',
  wrongVerifier = false,
) {
  const verifier = crypto.randomUUID() + crypto.randomUUID(),
    params = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri,
      scope,
      resource,
      state: 'fixture-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
  const authorized = await a.request('/oauth2/authorize?' + params, undefined, {
    accept: 'text/html',
    'sec-fetch-mode': 'navigate',
  });
  assert.ok([200, 302].includes(authorized.status), JSON.stringify(authorized));
  let location = new URL(authorized.headers.get('location') ?? authorized.data.url, origin);
  if (location.pathname === '/consent') {
    const consent = await a.request('/oauth2/consent', {
      accept: true,
      oauth_query: location.search.slice(1),
    });
    assert.equal(consent.status, 200, JSON.stringify(consent));
    location = new URL(consent.data.redirect_uri ?? consent.data.url);
  }
  assert.equal(location.searchParams.get('state'), 'fixture-state', location.toString());
  return token({
    grant_type: 'authorization_code',
    client_id,
    code: location.searchParams.get('code'),
    code_verifier: wrongVerifier ? 'incorrect-verifier-with-at-least-43-characters' : verifier,
    redirect_uri,
    resource,
  });
}
async function mcp(a, bearer, method, name, args = {}) {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'native-acceptance', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  return a.request(
    '/mcp',
    {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: method === 'tools/call' ? { name, arguments: args, _meta: meta } : { _meta: meta },
    },
    {
      authorization: 'Bearer ' + bearer,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(name ? { 'mcp-name': name } : {}),
    },
  );
}
test('OAuth PKCE, MCP scopes, commands, refresh rotation and Android share the native inventory', async () => {
  const a = await fixture(),
    inv = await inventory(a),
    id = 'mcp-' + crypto.randomUUID(),
    resource = origin + '/mcp',
    redirect = 'http://127.0.0.1:45219/callback';
  await client(id, resource, redirect);
  const bad = await grant(a, id, resource, redirect, undefined, true);
  assert.equal(bad.status, 401, JSON.stringify(bad));
  const full = await grant(a, id, resource, redirect);
  assert.equal(full.status, 200, JSON.stringify(full));
  const jwks = await mf.dispatchFetch(origin + '/api/auth/jwks');
  assert.equal(jwks.status, 200);
  jwksForTest = await jwks.text();
  const list = await mcp(a, full.data.access_token, 'tools/list');
  assert.equal(list.status, 200, JSON.stringify(list));
  const baseline = JSON.parse(await readFile('docs/cloudflare/contracts-baseline.json', 'utf8'));
  const tools = list.data.result.tools;
  for (const [name, contract] of Object.entries(baseline.operations)) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, name);
    assert.deepEqual(tool.inputSchema, contract.input, name + ' input schema');
    assert.equal(tool.annotations.readOnlyHint, contract.read, name + ' read-only annotation');
  }
  const queried = await mcp(a, full.data.access_token, 'tools/call', 'query_items', {});
  assert.equal(queried.status, 200, JSON.stringify(queried));
  assert.equal(queried.data.result.structuredContent.matching_count, 1);
  const read = await grant(a, id, resource, redirect, 'openid offline_access inventory:read');
  assert.equal(read.status, 200, JSON.stringify(read));
  const denied = await mcp(a, read.data.access_token, 'tools/call', 'consume_item_content', {});
  assert.equal(denied.status, 403, JSON.stringify(denied));
  assert.match(denied.headers.get('www-authenticate'), /inventory:write/);
  const write = {
    idempotency_key: crypto.randomUUID(),
    item_id: inv.item,
    amount: { value: '10', unit: 'mL' },
    expected_revisions: { [inv.item]: 1 },
  };
  const changed = await mcp(a, full.data.access_token, 'tools/call', 'consume_item_content', write);
  assert.equal(changed.status, 200, JSON.stringify(changed));
  assert.ok(changed.data.result.structuredContent.operation_id, JSON.stringify(changed));
  assert.deepEqual(
    (await mcp(a, full.data.access_token, 'tools/call', 'consume_item_content', write)).data.result
      .structuredContent,
    changed.data.result.structuredContent,
  );
  const refreshed = await token({
    grant_type: 'refresh_token',
    client_id: id,
    refresh_token: full.data.refresh_token,
    resource,
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed));
  assert.notEqual(refreshed.data.refresh_token, full.data.refresh_token);
  assert.equal(
    (
      await token({
        grant_type: 'refresh_token',
        client_id: id,
        refresh_token: full.data.refresh_token,
        resource,
      })
    ).status,
    400,
  );
  const terminalResource = origin + '/api/terminal/v1';
  await client('test-terminal', terminalResource, origin + '/android/oauth/callback');
  const terminal = await grant(
    a,
    'test-terminal',
    terminalResource,
    origin + '/android/oauth/callback',
  );
  assert.equal(terminal.status, 200, JSON.stringify(terminal));
  const terminalHeaders = { authorization: 'Bearer ' + terminal.data.access_token };
  const snapshot = await a.request('/api/terminal/v1/snapshot', undefined, terminalHeaders);
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot));
  assert.equal(snapshot.data.items[0].remaining.value, '990');
  assert.equal(
    (
      await a.request('/api/terminal/v1/snapshot', undefined, {
        authorization: 'Bearer ' + full.data.access_token,
      })
    ).status,
    401,
  );
  const spent = await a.request(
    '/api/terminal/v1/commands/consume_item_content',
    { ...write, idempotency_key: crypto.randomUUID(), expected_revisions: { [inv.item]: 2 } },
    terminalHeaders,
  );
  assert.equal(spent.status, 200, JSON.stringify(spent));
  await db.prepare('UPDATE user SET enabled=0 WHERE id=?').bind(a.user).run();
  assert.equal(
    (await mcp(a, refreshed.data.access_token, 'tools/call', 'query_items')).status,
    403,
  );
});
test('upload coordinator streams 25 MiB, preserves errors and verifies concurrent private uploads', async () => {
  const a = await fixture(),
    inv = await inventory(a);
  const bytes = Buffer.alloc(25 * 1024 * 1024, 65);
  bytes.write('%PDF-1.7\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const reserve = async () => {
    const r = await inv.run('create_attachment_upload', {
      idempotency_key: crypto.randomUUID(),
      filename: 'maximum.pdf',
      mime_type: 'application/pdf',
      target: { kind: 'ITEM', id: inv.item },
      file_size: bytes.length,
      sha256,
    });
    assert.equal(r.status, 200);
    return r.data;
  };
  const upload = (r, content = bytes, ticket) => {
    const headers = new Headers(inv.headers);
    for (const [k, v] of Object.entries(r.headers)) headers.set(k, v);
    headers.set('cookie', a.cookie);
    headers.set('origin', origin);
    if (ticket) headers.set('x-acornary-upload-ticket', ticket);
    return mf.dispatchFetch(origin + r.upload_url, { method: 'PUT', headers, body: content });
  };
  const first = await reserve(),
    second = await reserve();
  let bad = await upload(first, Buffer.from('%PDF-1.7\n'), 'incorrect-ticket');
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).error.code, 'FORBIDDEN');
  const corrupt = Buffer.from(bytes);
  corrupt[20] = 66;
  bad = await upload(first, corrupt);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'ATTRIBUTE_VALIDATION_FAILED');
  for (const r of await Promise.all([upload(first), upload(second)])) {
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await r.json(), { uploaded: true });
  }
  assert.equal((await upload(first)).status, 200);
  const completed = await inv.run('complete_attachment_upload', {
    idempotency_key: crypto.randomUUID(),
    upload_id: first.upload_id,
    target: { kind: 'ITEM', id: inv.item },
    expected_revisions: { [inv.item]: 1 },
  });
  assert.equal(completed.status, 200);
  const downloaded = await mf.dispatchFetch(
    origin + '/api/attachments/' + completed.data.attachment.id,
    {
      headers: { ...inv.headers, cookie: a.cookie },
    },
  );
  assert.equal(downloaded.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await downloaded.arrayBuffer()))
      .digest('hex'),
    sha256,
  );
});

test('directory failure leaves a recoverable task and stale indexes never retain household authority', async () => {
  const a = await fixture();
  await db
    .prepare(
      "CREATE TRIGGER reject_projection BEFORE INSERT ON household_directory BEGIN SELECT RAISE(ABORT,'injected directory outage'); END",
    )
    .run();
  const created = await a.request('/account/household', { action: 'create', name: '可恢复家庭' });
  assert.equal(created.status, 500);
  const task = await db
    .prepare("SELECT id,payload FROM cf_account_tasks WHERE user_id=? AND status='PENDING'")
    .bind(a.user)
    .first();
  assert.ok(task);
  await db.prepare('DROP TRIGGER reject_projection').run();
  const recovered = await a.request('/account/households');
  assert.equal(recovered.status, 200, JSON.stringify(recovered));
  assert.equal(recovered.data.households.length, 1);
  assert.equal(recovered.data.households[0].household_id, JSON.parse(task.payload).household_id);
  assert.equal(
    (await db.prepare('SELECT status FROM cf_account_tasks WHERE id=?').bind(task.id).first())
      .status,
    'COMPLETE',
  );
  const hh = recovered.data.households[0].household_id,
    invited = await a.request('/account/household', { action: 'invite', household_id: hh }),
    b = await fixture(),
    token = new URL(invited.data.url).searchParams.get('token');
  assert.equal((await b.request('/account/household', { action: 'join', token })).status, 200);
  await db
    .prepare(
      "CREATE TRIGGER reject_revocation BEFORE UPDATE ON membership_directory WHEN NEW.deleted=1 BEGIN SELECT RAISE(ABORT,'injected directory outage'); END",
    )
    .run();
  assert.equal(
    (await b.request('/account/household', { action: 'leave', household_id: hh })).status,
    500,
  );
  assert.equal(
    (
      await b.request('/api/ui/snapshot', undefined, {
        'x-acornary-protocol': '2',
        'x-acornary-household': hh,
      })
    ).status,
    403,
  );
  await db.prepare('DROP TRIGGER reject_revocation').run();
  assert.equal((await b.request('/account/households')).data.households.length, 0);
});
