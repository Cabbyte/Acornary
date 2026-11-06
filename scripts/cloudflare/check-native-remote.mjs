import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { httpAcceptance } from '../../tests/cloudflare/http-acceptance.mjs';
const root = resolve('.local/cf-native-acceptance'),
  state = JSON.parse(await readFile(resolve(root, 'state.json'), 'utf8'));
if (!state.deployed || !/^acornary-cf-accept-[a-f0-9]{8}$/.test(state.name))
  throw new Error('Prepare isolated native acceptance resources first');
const origin = state.origin,
  proxy = await getPlatformProxy({
    configPath: resolve(root, 'operator.json'),
    envFiles: [],
    remoteBindings: true,
    persist: false,
  });
const report = { origin, started_at: new Date().toISOString(), checks: [] };
const passed = (name) => {
  report.checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
};
try {
  const db = proxy.env.AUTH_DB;
  const helpers = httpAcceptance({
    origin,
    db,
    mf: {
      dispatchFetch: (url, options) => {
        // Only local workerd fixtures may set the connecting IP. Cloudflare owns it on ingress.
        const headers = new Headers(options?.headers);
        headers.delete('cf-connecting-ip');
        return fetch(url, { ...options, headers, redirect: 'manual' });
      },
    },
  });
  let health = await fetch(origin + '/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).runtime, 'cloudflare');
  passed('live D1/R2 health');
  for (const path of ['/login', '/items', '/settings/households']) {
    const r = await fetch(origin + path);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<html/);
  }
  assert.equal(
    (await fetch(origin + '/api/nonexistent')).headers
      .get('content-type')
      .includes('application/json'),
    true,
  );
  passed('Static Assets SPA and API routing');
  const discovery = await (
    await fetch(origin + '/.well-known/oauth-authorization-server/api/auth')
  ).json();
  assert.equal(discovery.issuer, origin + '/api/auth');
  passed('OAuth discovery');
  const a = await helpers.fixture(),
    inv = await helpers.inventory(a);
  passed('real password login, D1 tasks, DO approvals, REST inventory and idempotency');
  const failure = await inv.run('consume_item_content', {
    idempotency_key: crypto.randomUUID(),
    item_id: inv.item,
    amount: { value: '1', unit: 'mL' },
    expected_revisions: { [inv.item]: 99 },
  });
  assert.equal(failure.data.error.code, 'REVISION_CONFLICT');
  passed('domain error contract across real RPC');
  const client = 'remote-mcp-' + crypto.randomUUID(),
    resource = origin + '/mcp',
    redirect = 'http://127.0.0.1:45219/callback';
  await helpers.client(client, resource, redirect);
  const grant = await helpers.grant(a, client, resource, redirect);
  assert.equal(grant.status, 200);
  const tools = await helpers.mcp(a, grant.data.access_token, 'tools/list');
  assert.equal(tools.status, 200);
  const baseline = JSON.parse(await readFile('docs/cloudflare/contracts-baseline.json', 'utf8'));
  for (const [name, contract] of Object.entries(baseline.operations)) {
    const found = tools.data.result.tools.find((t) => t.name === name);
    assert.ok(found, name);
    assert.deepEqual(found.inputSchema, contract.input);
  }
  const queried = await helpers.mcp(a, grant.data.access_token, 'tools/call', 'query_items', {});
  assert.equal(queried.status, 200);
  assert.notEqual(queried.data.result.isError, true);
  passed('OAuth PKCE, public JWKS fetch and MCP schema/query');
  const refreshed = await helpers.token({
    grant_type: 'refresh_token',
    client_id: client,
    refresh_token: grant.data.refresh_token,
    resource,
  });
  assert.equal(refreshed.status, 200);
  passed('refresh rotation');
  const plugin = await helpers.mcp(a, refreshed.data.access_token, 'resources/list');
  assert.equal(plugin.status, 200);
  assert.ok(plugin.data.result.resources.some((r) => r.uri.startsWith('ui://')));
  const resourceUI = plugin.data.result.resources.find((r) => r.uri.startsWith('ui://'));
  const contentUI = await helpers.mcp(
    a,
    refreshed.data.access_token,
    'resources/read',
    resourceUI.uri,
  );
  assert.equal(contentUI.status, 200);
  assert.match(contentUI.data.result.contents[0].text, /<html/);
  passed('MCP UI asset resource');
  const bytes = Buffer.alloc(25 * 1024 * 1024, 65);
  bytes.write('%PDF-1.7\n');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const reserved = await inv.run('create_attachment_upload', {
    idempotency_key: crypto.randomUUID(),
    filename: 'remote.pdf',
    mime_type: 'application/pdf',
    target: { kind: 'ITEM', id: inv.item },
    file_size: bytes.length,
    sha256: sha,
  });
  assert.equal(reserved.status, 200);
  const uploadHeaders = new Headers(inv.headers);
  for (const [key, value] of Object.entries(reserved.data.headers)) uploadHeaders.set(key, value);
  uploadHeaders.set('origin', origin);
  uploadHeaders.set('cookie', a.cookie);
  const upload = await fetch(origin + reserved.data.upload_url, {
    method: 'PUT',
    headers: uploadHeaders,
    body: bytes,
  });
  const uploadText = await upload.text();
  if (upload.status !== 200)
    report.failure = {
      step: '25 MiB attachment upload',
      http_status: upload.status,
      cloudflare_error: uploadText.match(/cf-error-code[^>]*>(\d+)/)?.[1],
      ray_id: upload.headers.get('cf-ray'),
    };
  assert.equal(upload.status, 200, '25 MiB attachment upload failed; inspect report.json');
  const attached = await inv.run('complete_attachment_upload', {
    idempotency_key: crypto.randomUUID(),
    upload_id: reserved.data.upload_id,
    target: { kind: 'ITEM', id: inv.item },
    expected_revisions: { [inv.item]: 1 },
  });
  assert.equal(attached.status, 200);
  const download = await fetch(origin + '/api/attachments/' + attached.data.attachment.id, {
    headers: { ...inv.headers, cookie: a.cookie },
  });
  assert.equal(download.status, 200);
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await download.arrayBuffer()))
      .digest('hex'),
    sha,
  );
  passed('25 MiB real R2 upload, confirmation and private download');
  const network = async (url) => {
    const r = await proxy.env.NETWORK.fetch('https://operator.internal/check', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  const publicResult = await network(origin + '/__acceptance__/small');
  assert.equal(publicResult.status, 200);
  const publicBody = JSON.parse(publicResult.body);
  assert.equal(publicBody.marker, 'public-worker-front-door');
  assert.equal(publicBody.authorization, null);
  assert.equal(publicBody.cookie, null);
  passed('public Worker front door and CIMD credential stripping');
  for (const suffix of ['redirect', 'large', 'slow']) {
    const r = await network(origin + '/__acceptance__/' + suffix);
    assert.equal(r.rejected, true, suffix);
  }
  for (const url of [
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://169.254.169.254/',
    'https://10.0.0.1/',
    'http://example.com/',
  ])
    assert.equal((await network(url)).rejected, true, url);
  const dns = await network('https://127.0.0.1.sslip.io/');
  assert.ok(dns.rejected || dns.status >= 400);
  report.private_dns_result = dns;
  passed('CIMD redirect, size, deadline, private IP and private DNS defenses');
  const backupId = crypto.randomUUID(),
    call = async (path, body) => {
      const r = await proxy.env.BACKUP.fetch('https://operator.internal' + path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      assert.equal(r.status, 200);
      return (await r.json()).data;
    };
  await call('/start', { id: backupId });
  let backup;
  for (let i = 0; i < 60; i++) {
    backup = await call('/status', { id: backupId });
    if (backup.status === 'COMPLETE') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.equal(backup.status, 'COMPLETE');
  report.backup = backup;
  passed('live Queue consumer and unified R2 backup manifest');
  report.completed_at = new Date().toISOString();
  report.status = 'PASS';
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log('Native Cloudflare acceptance passed');
} catch (error) {
  report.status = 'FAIL';
  report.completed_at = new Date().toISOString();
  // Do not leave a previous PASS receipt in place after a failed rerun, or persist
  // arbitrary response bodies that could contain account data or credentials.
  report.failure ??= { step: 'after ' + (report.checks.at(-1)?.name ?? 'setup') };
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  throw error;
} finally {
  await proxy.dispose();
}
