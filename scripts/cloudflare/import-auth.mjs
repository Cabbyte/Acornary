// Operator CLI: uses Wrangler's authenticated binding proxy, never a public migration endpoint.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlatformProxy } from 'wrangler';
import { prepareAuthImport } from './migration/prepare-auth.ts';
import { AuthSnapshotImporter } from '../../apps/cloudflare/src/auth-import.ts';

const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    'expected-sha256': { type: 'string' },
    config: { type: 'string' },
    'database-id': { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
    mode: { type: 'string' },
  },
});
if (
  !values.snapshot ||
  !values['expected-sha256'] ||
  !values.config ||
  !values['database-id'] ||
  !['preview', 'production'].includes(values.mode) ||
  values.remote === Boolean(values['local-state'])
) {
  throw new Error(
    'Required: --snapshot PATH --expected-sha256 HASH --config JSON_PATH --database-id ID --mode preview|production and exactly one of --remote or --local-state PATH',
  );
}
const config = JSON.parse(await readFile(resolve(values.config), 'utf8'));
const binding = config.d1_databases?.find((b) => b.binding === 'AUTH_DB');
if (!binding || binding.database_id !== values['database-id'])
  throw new Error('Explicit destination database ID must match AUTH_DB in the config');
const { descriptor, chunks } = await prepareAuthImport(
  resolve(values.snapshot),
  values['expected-sha256'],
);
if (descriptor.mode !== values.mode)
  throw new Error('Snapshot mode does not match destination mode');
if (values.mode === 'production' && config.name?.includes('preview'))
  throw new Error('Production credentials cannot be imported into preview');
const temp = await mkdtemp(join(tmpdir(), 'acornary-d1-import-'));
let proxy;
try {
  const path = join(temp, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify({
      name: 'acornary-d1-migration',
      account_id: config.account_id,
      compatibility_date: config.compatibility_date,
      d1_databases: [
        {
          binding: 'AUTH_DB',
          database_name: binding.database_name,
          database_id: binding.database_id,
          remote: values.remote,
        },
      ],
    }),
    { mode: 0o600 },
  );
  proxy = await getPlatformProxy({
    configPath: path,
    envFiles: [],
    remoteBindings: values.remote,
    persist: values.remote ? false : { path: resolve(values['local-state']) },
  });
  const importer = new AuthSnapshotImporter(proxy.env.AUTH_DB);
  const job = await importer.start(descriptor);
  for (let i = job.next_chunk; i < chunks.length; i++)
    await importer.append(descriptor.manifest_hash, i, chunks[i]);
  const result = await importer.finish(descriptor.manifest_hash);
  console.log(
    JSON.stringify({
      ...result,
      database_id: binding.database_id,
      remote: values.remote,
      manifest_sha256: descriptor.manifest_hash,
      counts: descriptor.counts,
    }),
  );
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
