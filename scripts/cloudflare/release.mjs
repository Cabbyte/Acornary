import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  householdSchema,
  householdSchemaVersion,
} from '../../apps/cloudflare/src/inventory/schema.ts';
import { registry } from '../../packages/contracts/src/index.ts';
import { z } from 'zod';
const { values } = parseArgs({ options: { deploy: { type: 'boolean', default: false } } }),
  exec = promisify(execFile);
const git = async (args) => (await exec('git', args)).stdout.trim();
if (await git(['status', '--porcelain', '--untracked-files=normal']))
  throw new Error('Release requires a clean, committed worktree');
const commit = await git(['rev-parse', 'HEAD']),
  version = 'build-' + commit.slice(0, 12);
const config = 'apps/cloudflare/wrangler.preview.json',
  c = JSON.parse(await readFile(config, 'utf8'));
if (
  c.name !== 'acornary-cf-preview' ||
  c.vars.ORIGIN !== 'https://cf.acornary.protium.top' ||
  c.routes.length !== 1 ||
  c.routes[0].pattern !== 'cf.acornary.protium.top'
)
  throw new Error('Preview release cannot change the production route');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const migrations = {};
for (const file of (await readdir('apps/cloudflare/migrations/auth')).sort())
  migrations[file] = sha(await readFile('apps/cloudflare/migrations/auth/' + file));
const manifest = {
  version,
  commit,
  environment: 'preview',
  origin: c.vars.ORIGIN,
  resources: { d1: c.d1_databases, r2: c.r2_buckets, queues: c.queues, do: c.durable_objects },
  d1: migrations,
  household_schema: { version: householdSchemaVersion, sha256: sha(householdSchema) },
  templates_sha256: sha(
    JSON.stringify(registry.map((t) => ({ ...t, schema: z.toJSONSchema(t.schema) }))),
  ),
};
await mkdir('output/cloudflare-release', { recursive: true });
await writeFile(
  'output/cloudflare-release/manifest.json',
  JSON.stringify(manifest, null, 2) + '\n',
);
const run = async (args) => {
  const child = exec('pnpm', args, {
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 16 * 1024 * 1024,
  });
  child.child.stdout.pipe(process.stdout);
  child.child.stderr.pipe(process.stderr);
  await child;
};
await run(['cf:build']);
await run([
  'exec',
  'wrangler',
  'deploy',
  '--dry-run',
  '--config',
  config,
  '--outdir',
  '../../output/cloudflare-release/worker',
  '--var',
  `RELEASE_VERSION:${version}`,
  '--var',
  `RELEASE_COMMIT:${commit}`,
]);
if (values.deploy) {
  await run([
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'AUTH_DB',
    '--remote',
    '--config',
    config,
  ]);
  await run([
    'exec',
    'wrangler',
    'deploy',
    '--config',
    config,
    '--var',
    `RELEASE_VERSION:${version}`,
    '--var',
    `RELEASE_COMMIT:${commit}`,
  ]);
}
console.log(
  JSON.stringify({
    version,
    commit,
    deployed: values.deploy,
    manifest: 'output/cloudflare-release/manifest.json',
  }),
);
