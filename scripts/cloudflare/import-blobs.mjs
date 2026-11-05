import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlatformProxy } from 'wrangler';
import { verifySnapshot, readSnapshotManifest } from './migration/verify.ts';
import { regularFile } from './migration/files.ts';
import { BlobSnapshotImporter } from '../../apps/cloudflare/src/blob-import.ts';

const { values } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    'expected-sha256': { type: 'string' },
    config: { type: 'string' },
    bucket: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
    mode: { type: 'string' },
  },
});
if (
  !values.snapshot ||
  !values['expected-sha256'] ||
  !values.config ||
  !values.bucket ||
  !['preview', 'production'].includes(values.mode) ||
  values.remote === Boolean(values['local-state'])
)
  throw new Error(
    'Required: --snapshot PATH --expected-sha256 HASH --config JSON_PATH --bucket NAME --mode preview|production and exactly one of --remote or --local-state PATH',
  );
const root = resolve(values.snapshot),
  verified = await verifySnapshot(root, values['expected-sha256']);
if (verified.mode !== values.mode) throw new Error('Snapshot mode does not match destination mode');
const config = JSON.parse(await readFile(resolve(values.config), 'utf8'));
const binding = config.r2_buckets?.find((b) => b.binding === 'BLOBS');
if (!binding || binding.bucket_name !== values.bucket)
  throw new Error('Explicit destination bucket must match BLOBS in the config');
if (values.mode === 'production' && config.name?.includes('preview'))
  throw new Error('Production snapshot cannot be imported into preview');
const { manifest } = await readSnapshotManifest(root, values['expected-sha256']);
const temp = await mkdtemp(join(tmpdir(), 'acornary-r2-import-'));
let proxy;
try {
  const path = join(temp, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify({
      name: 'acornary-r2-migration',
      account_id: config.account_id,
      compatibility_date: config.compatibility_date,
      r2_buckets: [{ binding: 'BLOBS', bucket_name: binding.bucket_name, remote: values.remote }],
    }),
    { mode: 0o600 },
  );
  proxy = await getPlatformProxy({
    configPath: path,
    envFiles: [],
    remoteBindings: values.remote,
    persist: values.remote ? false : { path: resolve(values['local-state']) },
  });
  const importer = new BlobSnapshotImporter(proxy.env.BLOBS);
  let replayed = 0;
  for (const [key, expected] of Object.entries(manifest.blobs)) {
    const file = await regularFile(join(root, 'blobs', key + '.blob'));
    try {
      if ((await file.stat()).size !== expected.bytes)
        throw new Error('Source attachment size changed');
      const bytes = await file.readFile();
      const result = await importer.put(
        key,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        expected,
      );
      if (result.replayed) replayed++;
    } finally {
      await file.close();
    }
  }
  await verifySnapshot(root, values['expected-sha256']);
  console.log(
    JSON.stringify({
      state: 'BLOBS_VERIFIED',
      bucket: binding.bucket_name,
      remote: values.remote,
      manifest_sha256: verified.manifest_sha256,
      blobs: verified.blobs,
      replayed,
    }),
  );
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
