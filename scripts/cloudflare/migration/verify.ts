import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { validateManifest } from './format.js';
import { directory, fingerprint, lines, regularFile } from './files.js';

export async function readSnapshotManifest(root: string, expectedManifestHash?: string) {
  await directory(root);
  const handle = await regularFile(join(root, 'manifest.json'));
  let content: string;
  try {
    if ((await handle.stat()).size > 32 * 1024 * 1024) throw new Error('Manifest is too large');
    content = await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
  const manifestHash = createHash('sha256').update(content).digest('hex');
  if (expectedManifestHash && expectedManifestHash !== manifestHash)
    throw new Error('Manifest checksum mismatch');
  const manifest = validateManifest(JSON.parse(content));
  return { manifest, manifestHash };
}

export async function verifySnapshot(root: string, expectedManifestHash?: string) {
  const { manifest, manifestHash } = await readSnapshotManifest(root, expectedManifestHash);
  await directory(join(root, 'tables'));
  await directory(join(root, 'blobs'));
  if (
    (await readdir(join(root, 'tables'))).sort().join('|') !==
    Object.keys(manifest.tables)
      .map((t) => t + '.ndjson')
      .sort()
      .join('|')
  )
    throw new Error('Unexpected or missing table files');
  if (
    (await readdir(join(root, 'blobs'))).sort().join('|') !==
    Object.keys(manifest.blobs)
      .map((k) => k + '.blob')
      .sort()
      .join('|')
  )
    throw new Error('Unexpected or missing blob files');
  const references = new Set<string>();
  for (const [table, expected] of Object.entries(manifest.tables)) {
    const path = join(root, 'tables', table + '.ndjson');
    const actual = await fingerprint(path);
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error(`Table checksum mismatch: ${table}`);
    let rows = 0;
    for await (const line of lines(path)) {
      const row = JSON.parse(line);
      if (!row || Array.isArray(row) || typeof row !== 'object')
        throw new Error(`Invalid row: ${table}`);
      for (const column of expected.decimal_columns)
        if (row[column] !== null && typeof row[column] !== 'string')
          throw new Error(`Lossy decimal encoding: ${table}.${column}`);
      if (
        table === 'account' &&
        ['accessToken', 'refreshToken', 'idToken'].some((k) => row[k] != null)
      )
        throw new Error('OAuth secrets must not be exported');
      if (table === 'attachment_blobs') {
        const blob = manifest.blobs[row.storage_key];
        if (!blob || blob.sha256 !== row.sha256 || String(blob.bytes) !== String(row.file_size))
          throw new Error('Attachment metadata/content mismatch');
        references.add(row.storage_key);
        if (row.thumbnail_key !== null) {
          if (!manifest.blobs[row.thumbnail_key]) throw new Error('Missing thumbnail');
          references.add(row.thumbnail_key);
        }
      }
      rows++;
    }
    if (rows !== expected.rows) throw new Error(`Row count mismatch: ${table}`);
  }
  if (references.size !== Object.keys(manifest.blobs).length)
    throw new Error('Unreferenced blob in snapshot');
  for (const [key, expected] of Object.entries(manifest.blobs)) {
    const actual = await fingerprint(join(root, 'blobs', key + '.blob'));
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error(`Blob checksum mismatch: ${key}`);
  }
  return {
    snapshot_id: manifest.snapshot_id,
    mode: manifest.mode,
    manifest_sha256: manifestHash,
    tables: Object.keys(manifest.tables).length,
    blobs: references.size,
    attachment_bytes: 'VERIFIED' as const,
  };
}
