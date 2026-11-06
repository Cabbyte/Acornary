import { join } from 'node:path';
import { lines } from './files.js';
import { verifySnapshot } from './verify.js';
import {
  importRowSchema,
  hashSchema,
  chunkDigest,
  maxImportChunkBytes,
  type AuthImportDescriptor,
  type AuthImportRow,
} from '../../../apps/cloudflare/src/auth-import-model.js';

/** Build a deterministic, credential-filtered D1 plan from an operator-anchored snapshot. */
export async function prepareAuthImport(root: string, expectedManifestHash: string) {
  hashSchema.parse(expectedManifestHash);
  const verified = await verifySnapshot(root, expectedManifestHash);
  const chunks: AuthImportRow[][] = [];
  const descriptor: AuthImportDescriptor = {
    format: 'acornary-d1-auth-import-v1',
    manifest_hash: expectedManifestHash,
    mode: verified.mode,
    chunks: [],
    counts: { user: 0, account: 0, passkey: 0, household_directory: 0, membership_directory: 0 },
  };
  const disabledLegacyOwners = new Set<string>();
  for await (const line of lines(join(root, 'tables', 'auth_owners.ndjson'))) {
    const row = JSON.parse(line);
    if (row.enabled === false) disabledLegacyOwners.add(row.user_id);
  }
  let pending: AuthImportRow[] = [];
  async function flush() {
    if (!pending.length) return;
    descriptor.chunks.push(await chunkDigest(pending));
    chunks.push(pending);
    pending = [];
  }
  for (const table of [
    'user',
    ...(verified.mode === 'production' ? ['account', 'passkey'] : []),
    'households',
    'household_members',
  ]) {
    for await (const line of lines(join(root, 'tables', table + '.ndjson'))) {
      const row = JSON.parse(line);
      let mapped: unknown;
      if (table === 'user')
        mapped = {
          table,
          value: { ...row, enabled: row.enabled && !disabledLegacyOwners.has(row.id) },
        };
      else if (table === 'account') mapped = { table, value: row };
      else if (table === 'passkey') mapped = { table, value: row };
      else if (table === 'households')
        mapped = {
          table: 'household_directory',
          value: { id: row.id, name: row.name, state: 'PENDING', revision: 1 },
        };
      else
        mapped = {
          table: 'membership_directory',
          value: {
            id: row.id,
            household_id: row.household_id,
            user_id: row.user_id,
            deleted: 0,
            revision: 1,
          },
        };
      const checked = importRowSchema.parse(mapped);
      if (
        pending.length === 50 ||
        Buffer.byteLength(JSON.stringify([...pending, checked])) > maxImportChunkBytes
      )
        await flush();
      pending.push(checked);
      descriptor.counts[checked.table]++;
    }
    await flush();
  }
  // Detect accidental source-package edits during plan preparation before returning any importable plan.
  await verifySnapshot(root, expectedManifestHash);
  return { descriptor, chunks };
}
