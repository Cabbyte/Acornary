// Shared protocol scenario helpers for real HTTP acceptance. No fake authentication transport.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
export function httpAcceptance({ mf, db, origin }) {
  let ipSequence = 1;
  async function fixture() {
    const user = crypto.randomUUID(),
      email = user + '@example.invalid',
      password = crypto.randomUUID() + '-acceptance',
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

  async function inventory(a) {
    const created = await a.request('/account/household', {
      action: 'create',
      name: '接口测试家庭',
    });
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

  return { fixture, inventory, client, token, grant, mcp };
}
