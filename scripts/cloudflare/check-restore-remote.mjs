// Rehearse a verified preview backup into separate, unrouted Cloudflare resources.
import assert from 'node:assert/strict';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
const { values: v } = parseArgs({
  options: {
    'backup-id': { type: 'string' },
    'expected-sha256': { type: 'string' },
  },
});
assert.match(v['backup-id'] ?? '', /^[a-f0-9-]{36}$/);
assert.match(v['expected-sha256'] ?? '', /^[a-f0-9]{64}$/);
const source = JSON.parse(await readFile('apps/cloudflare/wrangler.preview.json', 'utf8'));
assert.equal(source.name, 'acornary-cf-preview');
assert.equal(source.vars.ORIGIN, 'https://cf.acornary.protium.top');
const root = resolve('.local/cf-restore-acceptance'),
  path = resolve(root, 'wrangler.json');
await mkdir(root, { recursive: true, mode: 0o700 });
let state;
try {
  state = JSON.parse(await readFile(resolve(root, 'state.json'), 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  state = { name: 'acornary-cf-restore-' + randomBytes(4).toString('hex') };
}
assert.match(state.name, /^acornary-cf-restore-[a-f0-9]{8}$/);
const save = () =>
  writeFile(resolve(root, 'state.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
await save();
const config = {
  name: state.name,
  account_id: source.account_id,
  compatibility_date: source.compatibility_date,
};
await writeFile(path, JSON.stringify(config), { mode: 0o600 });
const run = async (args) => {
  const result = await promisify(execFile)(
    'pnpm',
    ['exec', 'wrangler', ...args, '--config', path],
    {
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return result.stdout;
};
if (!state.database_id) {
  state.database_id = (
    await run(['d1', 'create', state.name, '--location', 'apac', '--update-config=false'])
  ).match(/"database_id":\s*"([a-f0-9-]{36})"/)?.[1];
  assert.ok(state.database_id);
  await save();
}
for (const key of ['blobs', 'backups'])
  if (!state[key]) {
    await run(['r2', 'bucket', 'create', state.name + '-' + key]);
    state[key] = true;
    await save();
  }
if (!state.jobs) {
  await run(['queues', 'create', state.name + '-jobs']);
  state.jobs = true;
  await save();
}
Object.assign(config, {
  main: resolve('apps/cloudflare/src/worker.ts'),
  compatibility_flags: source.compatibility_flags,
  workers_dev: false,
  preview_urls: false,
  routes: [],
  triggers: { crons: [] },
  d1_databases: [
    {
      binding: 'AUTH_DB',
      database_name: state.name,
      database_id: state.database_id,
      migrations_dir: resolve('apps/cloudflare/migrations/auth'),
    },
  ],
  r2_buckets: ['blobs', 'backups'].map((key) => ({
    binding: key.toUpperCase(),
    bucket_name: state.name + '-' + key,
  })),
  durable_objects: source.durable_objects,
  migrations: source.migrations,
  queues: {
    producers: [{ binding: 'JOBS', queue: state.name + '-jobs' }],
    consumers: [{ queue: state.name + '-jobs', max_batch_size: 1, max_retries: 3 }],
  },
  assets: { ...source.assets, directory: resolve('apps/web/dist') },
  vars: source.vars,
  observability: source.observability,
});
await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
await run(['d1', 'migrations', 'apply', 'AUTH_DB', '--remote']);
await run(['deploy']);
state.deployed = true;
await save();
console.log('Deployed separate unrouted restore Worker');
const operatorPath = resolve(root, 'operator.json');
await writeFile(
  operatorPath,
  JSON.stringify({
    name: state.name + '-operator',
    account_id: config.account_id,
    compatibility_date: config.compatibility_date,
    d1_databases: config.d1_databases.map((d) => ({ ...d, remote: true })),
    r2_buckets: [
      ...config.r2_buckets.map((b) => ({ ...b, remote: true })),
      {
        binding: 'SOURCE',
        bucket_name: source.r2_buckets.find((b) => b.binding === 'BACKUPS').bucket_name,
        remote: true,
      },
    ],
    services: [
      { binding: 'BACKUP', service: state.name, entrypoint: 'BackupEntrypoint', remote: true },
    ],
  }),
  { mode: 0o600 },
);
const proxy = await getPlatformProxy({
  configPath: operatorPath,
  remoteBindings: true,
  envFiles: [],
  persist: false,
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const id = v['backup-id'],
    hash = v['expected-sha256'],
    prefix = `backups/${id}/`;
  const rootObject = await proxy.env.SOURCE.get(prefix + 'manifest.json');
  assert.ok(rootObject);
  const rootBytes = Buffer.from(await rootObject.arrayBuffer());
  assert.equal(sha(rootBytes), hash);
  const manifest = JSON.parse(rootBytes);
  assert.equal(manifest.origin, source.vars.ORIGIN);
  assert.equal(manifest.environment, 'preview');
  const copies = new Set();
  let cursor;
  do {
    const page = await proxy.env.SOURCE.list({ prefix, limit: 100, ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) copies.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const h of manifest.households) {
    const o = await proxy.env.SOURCE.get(`${prefix}households/${h.id}/manifest.json`);
    assert.ok(o);
    const bytes = Buffer.from(await o.arrayBuffer());
    assert.equal(sha(bytes), h.sha256);
    for (const blob of JSON.parse(bytes).blobs) copies.add(`objects/${blob.sha256}`);
  }
  for (const key of copies) {
    const o = await proxy.env.SOURCE.get(key);
    assert.ok(o);
    assert.ok(o.size <= 25 * 1024 * 1024);
    const bytes = Buffer.from(await o.arrayBuffer()),
      digest = sha(bytes);
    await proxy.env.BACKUPS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, sha256: digest });
    const stored = await proxy.env.BACKUPS.get(key);
    assert.ok(stored);
    assert.equal(sha(Buffer.from(await stored.arrayBuffer())), digest);
  }
  console.log(`Verified ${copies.size} copied backup objects`);
  const call = async (path, body) => {
    const r = await proxy.env.BACKUP.fetch('https://operator.internal' + path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 200, `Private restore step ${path} rejected`);
    return (await r.json()).data;
  };
  const body = { id, sha256: hash },
    started = Date.now();
  await call('/restore/begin', body);
  while (!(await call('/restore/auth', body)).complete) {}
  for (const h of manifest.households) {
    while (!(await call('/restore/household', { ...body, household_id: h.id })).complete) {}
    console.log('Verified restored household');
  }
  const result = await call('/restore/finish', body);
  assert.equal(result.complete, true);
  assert.equal(result.households, manifest.households.length);
  assert.equal(
    (
      await proxy.env.AUTH_DB.prepare(
        "SELECT count(*) n FROM household_directory WHERE state='ACTIVE'",
      ).first()
    ).n,
    manifest.households.length,
  );
  for (const table of ['session', 'oauthAccessToken', 'oauthRefreshToken'])
    assert.equal(
      (await proxy.env.AUTH_DB.prepare(`SELECT count(*) n FROM "${table}"`).first()).n,
      0,
    );
  const report = {
    completed_at: new Date().toISOString(),
    status: 'PASS',
    worker: state.name,
    backup_id: id,
    manifest_sha256: hash,
    copied_objects: copies.size,
    households: result.households,
    restore_seconds: (Date.now() - started) / 1000,
    public_routes: [],
    resources: { d1: state.database_id, r2: config.r2_buckets },
  };
  await writeFile(resolve(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally {
  await proxy.dispose();
}
