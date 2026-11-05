// Operators use an account-authorized service binding; the public site has no migration endpoint.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlatformProxy } from 'wrangler';
import { prepareHouseholdImports } from './migration/prepare-households.ts';
import { sha } from '../../apps/cloudflare/src/household-import-model.ts';
const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    'expected-sha256': { type: 'string' },
    config: { type: 'string' },
    'worker-name': { type: 'string' },
    mode: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
    activate: { type: 'boolean', default: false },
  },
});
if (
  !values.snapshot ||
  !values['expected-sha256'] ||
  !values.config ||
  !values['worker-name'] ||
  !['preview', 'production'].includes(values.mode) ||
  values.remote === Boolean(values['local-state'])
)
  throw new Error(
    'Required: --snapshot PATH --expected-sha256 HASH --config JSON_PATH --worker-name NAME --mode preview|production and exactly one of --remote or --local-state PATH; --activate opens validated households',
  );
const config = JSON.parse(await readFile(resolve(values.config), 'utf8')),
  backups = config.r2_buckets?.find((b) => b.binding === 'BACKUPS');
if (
  config.name !== values['worker-name'] ||
  !backups ||
  (values.mode === 'production' && config.name.includes('preview'))
)
  throw new Error('Explicit isolated Worker/bucket destination required');
const root = resolve(values.snapshot),
  hash = values['expected-sha256'],
  plans = await prepareHouseholdImports(root, hash);
if (plans.some((p) => p.descriptor.mode !== values.mode))
  throw new Error('Snapshot mode does not match destination');
const temp = await mkdtemp(join(tmpdir(), 'acornary-household-import-'));
let proxy;
try {
  const path = join(temp, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify({
      name: 'acornary-household-migration',
      account_id: config.account_id,
      compatibility_date: config.compatibility_date,
      services: [
        {
          binding: 'MIGRATION',
          service: config.name,
          entrypoint: 'MigrationEntrypoint',
          remote: values.remote,
        },
      ],
      r2_buckets: [{ binding: 'BACKUPS', bucket_name: backups.bucket_name, remote: values.remote }],
    }),
    { mode: 0o600 },
  );
  proxy = await getPlatformProxy({
    configPath: path,
    envFiles: [],
    remoteBindings: values.remote,
    persist: values.remote ? false : { path: resolve(values['local-state']) },
  });
  const manifest = await readFile(join(root, 'manifest.json'));
  if (sha(manifest) !== hash) throw new Error('Manifest changed after plan preparation');
  const objectKey = `migrations/${hash}/manifest.json`;
  await proxy.env.BACKUPS.put(objectKey, manifest, {
    onlyIf: { etagDoesNotMatch: '*' },
    sha256: hash,
  });
  const stored = await proxy.env.BACKUPS.get(objectKey);
  if (!stored || sha(new Uint8Array(await stored.arrayBuffer())) !== hash)
    throw new Error('Stored manifest verification failed');
  let imported = 0;
  for (const { descriptor, chunks } of plans) {
    const call = async (path, body = {}) => {
      const response = await proxy.env.MIGRATION.fetch('https://migration.internal' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest_hash: hash,
          household_id: descriptor.household_id,
          ...body,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Import failed');
      return result.data;
    };
    const state = await call('/begin', { descriptor });
    if (state.status !== 'ACTIVE') {
      for (const chunk of chunks.slice(state.next_chunk)) await call('/part', chunk);
      await call('/finish');
      let after = '';
      for (;;) {
        const page = await call('/verify-blobs', { after });
        if (!page.next) break;
        after = page.next;
      }
    }
    if (values.activate) await call('/activate');
    imported++;
  }
  console.log(
    JSON.stringify({
      state: values.activate ? 'HOUSEHOLDS_ACTIVE' : 'HOUSEHOLDS_VALIDATED',
      worker: config.name,
      remote: values.remote,
      manifest_sha256: hash,
      households: imported,
    }),
  );
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
