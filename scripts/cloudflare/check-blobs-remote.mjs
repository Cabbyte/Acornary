// Opt-in live R2 check; all objects and the uniquely named temporary bucket are removed.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import {
  BlobSnapshotImporter,
  blobObjectKey,
  sha256,
} from '../../apps/cloudflare/src/blob-import.ts';
const base = JSON.parse(await readFile('apps/cloudflare/resources.preview.json', 'utf8'));
const name = 'acornary-cf-check-' + randomUUID(),
  temp = await mkdtemp(join(tmpdir(), 'acornary-r2-check-'));
const configPath = join(temp, 'wrangler.json');
await writeFile(
  configPath,
  JSON.stringify({
    name,
    account_id: base.account_id,
    compatibility_date: base.compatibility_date,
    r2_buckets: [{ binding: 'BLOBS', bucket_name: name, remote: true }],
  }),
);
const exec = promisify(execFile);
const wrangler = async (args) =>
  exec('pnpm', ['exec', 'wrangler', ...args, '--config', configPath], {
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    maxBuffer: 1024 * 1024,
  });
let created = false,
  proxy;
const keys = ['a'.repeat(64), 'b'.repeat(64)];
try {
  await wrangler(['r2', 'bucket', 'create', name]);
  created = true;
  proxy = await getPlatformProxy({
    configPath,
    envFiles: [],
    remoteBindings: true,
    persist: false,
  });
  const bucket = proxy.env.BLOBS,
    importer = new BlobSnapshotImporter(bucket);
  for (let i = 0; i < keys.length; i++) {
    const body = new Uint8Array(i === 0 ? 32 : 25 * 1024 * 1024).fill(42).buffer;
    const expected = { bytes: body.byteLength, sha256: await sha256(body) };
    assert.equal((await importer.put(keys[i], body, expected)).replayed, false);
    assert.equal((await importer.put(keys[i], body, expected)).replayed, true);
    const other = new Uint8Array(64).fill(7).buffer;
    await assert.rejects(
      importer.put(keys[i], other, { bytes: 64, sha256: await sha256(other) }),
      /R2 attachment/,
    );
  }
  console.log(
    JSON.stringify({
      remote_r2_import: 'PASS',
      max_attachment_bytes: 25 * 1024 * 1024,
      stored_bytes_verified: true,
    }),
  );
} finally {
  if (proxy) {
    try {
      await proxy.env.BLOBS.delete(keys.map(blobObjectKey));
    } finally {
      await proxy.dispose();
    }
  }
  if (created) {
    await wrangler(['r2', 'bucket', 'delete', name]);
    console.log('Disposable R2 bucket deleted');
  }
  await rm(temp, { recursive: true, force: true });
}
