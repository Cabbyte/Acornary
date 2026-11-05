// Creates only uniquely named disposable resources and a full application acceptance Worker.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const exec = promisify(execFile),
  root = resolve('.local/cf-native-acceptance');
await mkdir(root, { recursive: true, mode: 0o700 });
const path = resolve(root, 'wrangler.json'),
  statePath = resolve(root, 'state.json');
let state;
try {
  state = JSON.parse(await readFile(statePath, 'utf8'));
} catch {
  state = { name: 'acornary-cf-accept-' + randomBytes(4).toString('hex') };
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
}
if (state.cleaned_at)
  throw new Error('Archive the completed acceptance state before provisioning again');
if (!/^acornary-cf-accept-[a-f0-9]{8}$/.test(state.name))
  throw new Error('Unexpected acceptance resource name');
const base = JSON.parse(await readFile('apps/cloudflare/resources.preview.json', 'utf8'));
const config = {
  name: state.name,
  account_id: base.account_id,
  compatibility_date: base.compatibility_date,
  compatibility_flags: base.compatibility_flags,
};
await writeFile(path, JSON.stringify(config), { mode: 0o600 });
const wrangler = async (args, stdin) => {
  const child = exec('pnpm', ['exec', 'wrangler', ...args, '--config', path], {
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stdin) child.child.stdin.end(stdin);
  try {
    return (await child).stdout;
  } catch (e) {
    throw new Error('Wrangler ' + args.slice(0, 2).join(' ') + ': ' + (e.stderr ?? e.message));
  }
};
const save = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
if (!state.database_id) {
  const out = await wrangler([
    'd1',
    'create',
    state.name,
    '--location',
    'apac',
    '--update-config=false',
  ]);
  state.database_id = out.match(/"database_id":\s*"([a-f0-9-]{36})"/)?.[1];
  if (!state.database_id) throw new Error('D1 ID absent');
  await save();
  console.log('Created isolated D1');
}
for (const key of ['blobs', 'backups'])
  if (!state[key]) {
    await wrangler(['r2', 'bucket', 'create', state.name + '-' + key]);
    state[key] = true;
    await save();
    console.log('Created isolated R2 ' + key);
  }
for (const key of ['jobs', 'failed'])
  if (!state[key]) {
    await wrangler(['queues', 'create', state.name + '-' + key]);
    state[key] = true;
    await save();
    console.log('Created isolated Queue ' + key);
  }
const origin = `https://${state.name}.litang0617.workers.dev`;
Object.assign(config, {
  main: resolve('tests/cloudflare/remote-worker.ts'),
  workers_dev: true,
  preview_urls: false,
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
  durable_objects: {
    bindings: [
      { name: 'HOUSEHOLDS', class_name: 'HouseholdStore' },
      { name: 'UPLOADS', class_name: 'AttachmentUpload' },
    ],
  },
  migrations: [
    { tag: 'native-v1', new_sqlite_classes: ['HouseholdStore'] },
    { tag: 'native-v2-uploads', new_sqlite_classes: ['AttachmentUpload'] },
  ],
  queues: {
    producers: [{ binding: 'JOBS', queue: state.name + '-jobs' }],
    consumers: [
      {
        queue: state.name + '-jobs',
        max_batch_size: 1,
        max_retries: 3,
        dead_letter_queue: state.name + '-failed',
      },
    ],
  },
  assets: {
    directory: resolve('apps/web/dist'),
    binding: 'ASSETS',
    html_handling: 'none',
    not_found_handling: 'single-page-application',
    run_worker_first: [
      '/api/*',
      '/api',
      '/mcp',
      '/mcp/*',
      '/.well-known/*',
      '/.well-known',
      '/health',
      '/android/oauth/callback',
      '/__acceptance__/*',
    ],
  },
  vars: {
    ORIGIN: origin,
    ENVIRONMENT: 'test',
    RELEASE_VERSION: 'native-acceptance',
    RELEASE_COMMIT: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(),
    TERMINAL_CLIENT_ID: 'acceptance-terminal',
  },
  observability: {
    enabled: true,
    logs: { enabled: true, invocation_logs: false },
    traces: { enabled: false },
  },
});
await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
await wrangler(['d1', 'migrations', 'apply', 'AUTH_DB', '--remote']);
console.log('Applied native D1 schema');
await wrangler(['deploy']);
state.deployed = true;
state.origin = origin;
await save();
console.log('Deployed isolated full application ' + origin);
const secretPath = resolve(root, 'auth-secret');
try {
  await access(secretPath);
} catch {
  await writeFile(secretPath, randomBytes(48).toString('base64url'), { mode: 0o600 });
}
await wrangler(['secret', 'put', 'AUTH_SECRET'], await readFile(secretPath, 'utf8'));
console.log('Installed isolated authentication secret');
await writeFile(
  resolve(root, 'operator.json'),
  JSON.stringify({
    name: state.name + '-operator',
    account_id: base.account_id,
    compatibility_date: base.compatibility_date,
    d1_databases: [
      {
        binding: 'AUTH_DB',
        database_name: state.name,
        database_id: state.database_id,
        remote: true,
      },
    ],
    r2_buckets: config.r2_buckets.map((b) => ({ ...b, remote: true })),
    services: [
      { binding: 'BACKUP', service: state.name, entrypoint: 'BackupEntrypoint', remote: true },
      { binding: 'NETWORK', service: state.name, entrypoint: 'NetworkCheck', remote: true },
    ],
  }),
  { mode: 0o600 },
);
console.log('Remote acceptance resources ready');
