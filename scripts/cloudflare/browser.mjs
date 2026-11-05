// Disposable local workerd + real built Web/MCP UI. No production accounts, files or services.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createServer as httpServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { hashPassword } from 'better-auth/crypto';
import { httpAcceptance } from '../../tests/cloudflare/http-acceptance.mjs';
const exec = promisify(execFile),
  origin = 'https://localhost:3210',
  root = resolve('.local/cf-browser-ci/' + randomBytes(6).toString('hex')),
  assets = resolve('apps/web/dist');
await mkdir(root, { recursive: true, mode: 0o700 });
await mkdir('output/playwright', { recursive: true });
await exec('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-keyout',
  root + '/key.pem',
  '-out',
  root + '/cert.pem',
  '-days',
  '1',
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost',
]);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};
let mf, host;
try {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      host: '127.0.0.1',
      port: 3210,
      https: true,
      httpsKey: await readFile(root + '/key.pem', 'utf8'),
      httpsCert: await readFile(root + '/cert.pem', 'utf8'),
      scriptPath: 'output/cloudflare-browser/worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      durableObjects: { HOUSEHOLDS: { className: 'HouseholdStore', useSQLite: true } },
      d1Databases: { AUTH_DB: 'browser' },
      r2Buckets: { BLOBS: 'blobs', BACKUPS: 'backups' },
      queueProducers: { JOBS: 'browser-jobs' },
      queueConsumers: { 'browser-jobs': { maxBatchSize: 1 } },
      bindings: {
        ORIGIN: origin,
        AUTH_SECRET: randomBytes(48).toString('hex'),
        ENVIRONMENT: 'test',
        RELEASE_VERSION: 'native-browser',
        RELEASE_COMMIT: 'local-test',
        TERMINAL_CLIENT_ID: 'browser-terminal',
      },
      // Only loop back the real local issuer's JWKS. Never intercept external CIMD resources.
      outboundService: async (request) => {
        if (request.url === origin + '/api/auth/jwks') return mf.dispatchFetch(request.url);
        throw new Error('Unexpected browser-fixture outbound request');
      },
      serviceBindings: {
        ASSETS: async (request) => {
          let file = resolve(assets, '.' + new URL(request.url).pathname);
          if (!file.startsWith(assets + sep)) file = assets + '/index.html';
          let bytes;
          try {
            bytes = await readFile(file);
          } catch {
            file = assets + '/index.html';
            bytes = await readFile(file);
          }
          return new Response(bytes, {
            headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' },
          });
        },
      },
    }),
  );
  const db = await mf.getD1Database('AUTH_DB');
  for (const file of (await readdir('apps/cloudflare/migrations/auth')).sort())
    for (const sql of (await readFile('apps/cloudflare/migrations/auth/' + file, 'utf8'))
      .split(';')
      .filter((s) => s.trim()))
      await db.prepare(sql).run();
  const helpers = httpAcceptance({ mf, db, origin }),
    a = await helpers.fixture();
  await db.prepare('UPDATE user SET email=? WHERE id=?').bind('browser@example.test', a.user).run();
  await db
    .prepare('UPDATE account SET password=? WHERE userId=?')
    .bind(await hashPassword('Browser-test-password-123!'), a.user)
    .run();
  const created = await a.request('/account/household', {
    action: 'create',
    name: '浏览器验收家庭',
  });
  assert.equal(created.status, 200);
  const headers = {
    'x-acornary-household': created.data.household_id,
    'x-acornary-protocol': '2',
    'x-acornary-request': 'web',
  };
  const post = async (path, input) => {
    const result = await a.request(path, input, headers);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  const command = async (name, input) => {
    const data = { idempotency_key: crypto.randomUUID(), ...input };
    if (name === 'create_catalog_node') {
      const proposed = await post('/api/write/propose_catalog_change', {
        idempotency_key: crypto.randomUUID(),
        proposal: {
          kind: 'catalog_command',
          operation: name,
          input: data,
          reason: 'Synthetic browser fixture',
        },
      });
      const review = await post('/api/ui/catalog-review', { proposal_id: proposed.proposal_id });
      data.approval_id = (
        await post('/api/ui/catalog-confirm', {
          proposal_id: proposed.proposal_id,
          challenge: review.challenge,
        })
      ).approval_id;
    }
    return post('/api/write/' + name, data);
  };
  const attr = (template_id, values) => ({ template_id, template_version: 1, values });
  const context = await post('/api/read/get_connection_context', {});
  const snapshot = await post('/api/ui/snapshot');
  const group = (await command('create_catalog_node', { kind: 'GROUP', name: '验收目录' }))
    .affected_objects[0].id;
  const sku = (
    await command('create_catalog_node', {
      kind: 'SKU',
      name: '验收牛奶 1L',
      profile: 'CONSUMABLE',
      parent_id: group,
      initial_attributes: [attr('product', { brand: '示例', barcodes: ['TEST-MILK-1L'] })],
    })
  ).affected_objects[0].id;
  const container = async (display_name, parent_id = null) =>
    (
      await command('create_items', {
        catalog_node_id: snapshot.container_catalog_id,
        count: 1,
        display_name,
        parent_id,
        initial_attributes: [attr('container', { can_contain: true })],
      })
    ).affected_objects[0].id;
  const kitchen = await container('验收厨房'),
    room = await container('验收储藏室'),
    bag = await container('验收行李箱', kitchen);
  const milk = (
    await command('create_items', {
      catalog_node_id: sku,
      parent_id: bag,
      count: 6,
      initial_attributes: [
        attr('contents', { remaining: { value: '1000', unit: 'mL' }, accuracy: 'MEASURED' }),
        {
          template_id: 'lifecycle',
          template_version: 2,
          values: { expiry: { date: '2026-10-01' } },
        },
      ],
    })
  ).affected_objects;
  const id = milk.map((o) => o.id).sort()[0];
  await command('open_item', { item_id: id, expected_revisions: { [id]: 1 } });
  await command('consume_item_content', {
    item_id: id,
    expected_revisions: { [id]: 2 },
    amount: { value: '200', unit: 'mL' },
    accuracy: 'MEASURED',
  });
  await command('move_item', { item_id: bag, parent_id: room, expected_revisions: { [bag]: 1 } });
  const note = await command('add_note', {
    target: { kind: 'ITEM', id },
    expected_revisions: { [id]: 3 },
    title: '验收笔记',
    body: '初始笔记',
  });
  await command('update_note', {
    note_id: note.note_id,
    expected_revisions: { [id]: 4 },
    body: '已核对：剩余 **800 mL**，位于行李箱。<script>alert(1)</script>',
  });
  await helpers.client('browser-client', origin + '/mcp', 'http://127.0.0.1:45219/callback');
  const b = await helpers.fixture();
  assert.equal(
    (await b.request('/account/household', { action: 'create', name: '第二家庭' })).status,
    200,
  );
  const clients = [];
  for (const [i, account] of [a, b].entries()) {
    const client = 'plugin-browser-' + i;
    await helpers.client(client, origin + '/mcp', 'http://127.0.0.1:45219/callback');
    const grant = await helpers.grant(
      account,
      client,
      origin + '/mcp',
      'http://127.0.0.1:45219/callback',
    );
    assert.equal(grant.status, 200);
    clients.push({ client, token: grant.data, expires: Date.now() + 240000, account });
  }
  host = httpServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/rpc') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const { method, params, family = 0 } = JSON.parse(Buffer.concat(chunks).toString()),
          c = clients[family === 1 ? 1 : 0];
        if (Date.now() > c.expires) {
          const refreshed = await helpers.token({
            grant_type: 'refresh_token',
            client_id: c.client,
            refresh_token: c.token.refresh_token,
            resource: origin + '/mcp',
          });
          assert.equal(refreshed.status, 200);
          c.token = refreshed.data;
          c.expires = Date.now() + 240000;
        }
        const result = await c.account.request(
          '/mcp',
          {
            jsonrpc: '2.0',
            id: 1,
            method,
            params: {
              ...params,
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'native-browser-host', version: '1' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          },
          {
            authorization: 'Bearer ' + c.token.access_token,
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': method,
            ...(params?.name || params?.uri ? { 'mcp-name': params.name ?? params.uri } : {}),
          },
        );
        assert.equal(result.status, 200, JSON.stringify(result.data));
        if (result.data.error) throw new Error('MCP protocol error');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result.data.result));
        return;
      }
      const file = req.url === '/host.js' ? 'plugin-host.js' : 'plugin-host.html';
      res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(await readFile('tests/fixtures/' + file));
    } catch {
      res.writeHead(500);
      res.end('MCP browser fixture error');
    }
  });
  await mf.ready;
  await new Promise((r) => host.listen(3212, '127.0.0.1', r));
  console.log('Native browser fixtures ready: real workerd/D1/DO/R2, WebUI and OAuth MCP host');
  const args = ['exec', 'playwright', 'test', '--max-failures=1', ...process.argv.slice(2)];
  const child = spawn('pnpm', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ACORNARY_E2E_CLOUD: '1',
      ACORNARY_E2E_NATIVE: '1',
      ACORNARY_E2E_ORIGIN: origin,
      ACORNARY_TEST_TLS_DIR: root,
    },
  });
  const code = await new Promise((r) => child.on('exit', r));
  if (code !== 0) throw new Error('Native browser acceptance failed');
} finally {
  host?.closeAllConnections();
  await Promise.all([host && new Promise((r) => host.close(r))]);
  await mf?.dispose();
}
