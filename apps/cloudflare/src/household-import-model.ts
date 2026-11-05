import { createHash } from 'node:crypto';
import { z } from 'zod';
import { columnTypes } from './inventory/schema.js';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
// FK-safe table order. Self-referencing catalogs/items are topologically ordered by the offline planner.
export const householdImportTables = [
  'households',
  'actors',
  'attribute_templates',
  'catalog_nodes',
  'items',
  'operations',
  'events',
  'household_settings',
  'installations',
  'notes',
  'barcode_index',
  'catalog_policy_versions',
  'catalog_proposals',
  'catalog_identity_keys',
  'date_facts',
  'household_sync_state',
  'sync_changes',
  'sync_object_versions',
  'label_projection_checkpoint',
  'attachment_blobs',
  'attachments',
  'sensitive_access_audit',
  'item_splits',
  'attribute_references',
  'household_members',
  'household_invitations',
] as const;
export type ImportTable = (typeof householdImportTables)[number];
export const householdImportDescriptor = z.strictObject({
  format: z.literal('acornary-household-import-v1'),
  household_id: z.string().regex(/^household_[a-f0-9-]{36}$/),
  manifest_hash: digest,
  mode: z.enum(['preview', 'production']),
  root_hash: digest,
  chunks: z.number().int().positive().max(1_000_000),
  counts: z.record(z.string(), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
});
export type HouseholdImportDescriptor = z.infer<typeof householdImportDescriptor>;
export const importPart = z.strictObject({
  table: z.enum(householdImportTables),
  row: z.number().int().nonnegative(),
  part: z.number().int().nonnegative(),
  parts: z.number().int().positive().max(128),
  // Each fragment is UTF-8 text at most 128 KiB. A logical row may contain a 4 MiB receipt.
  text: z.string(),
});
export type ImportPart = z.infer<typeof importPart>;
export const sha = (text: string | Uint8Array) => createHash('sha256').update(text).digest('hex');
export const leafHash = (ordinal: number, body: string) => sha('leaf:' + ordinal + ':' + body);
export const parentHash = (left: string, right: string) => sha('node:' + left + ':' + right);
export function merkle(hashes: string[]) {
  if (!hashes.length) throw new Error('Empty import');
  const layers = [hashes];
  while (layers.at(-1)!.length > 1) {
    const prior = layers.at(-1)!,
      next: string[] = [];
    for (let i = 0; i < prior.length; i += 2)
      next.push(parentHash(prior[i], prior[i + 1] ?? prior[i]));
    layers.push(next);
  }
  return {
    root: layers.at(-1)![0],
    proof: (ordinal: number) => {
      const proof: string[] = [];
      let i = ordinal;
      for (const layer of layers.slice(0, -1)) {
        proof.push(layer[i ^ 1] ?? layer[i]);
        i = Math.floor(i / 2);
      }
      return proof;
    },
  };
}
export function verifyPart(
  descriptor: HouseholdImportDescriptor,
  ordinal: number,
  body: string,
  proof: string[],
) {
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= descriptor.chunks ||
    Buffer.byteLength(body) > 384 * 1024
  )
    throw new Error('Invalid import chunk');
  if (
    proof.length !== Math.ceil(Math.log2(descriptor.chunks)) ||
    proof.some((h) => !digest.safeParse(h).success)
  )
    throw new Error('Invalid import proof');
  let hash = leafHash(ordinal, body),
    i = ordinal;
  for (const sibling of proof) {
    hash = i % 2 ? parentHash(sibling, hash) : parentHash(hash, sibling);
    i = Math.floor(i / 2);
  }
  if (hash !== descriptor.root_hash)
    throw new Error('Import chunk does not match the anchored snapshot plan');
  const part = importPart.parse(JSON.parse(body));
  if (part.part >= part.parts || Buffer.byteLength(part.text) > 128 * 1024)
    throw new Error('Invalid row fragment');
  return { part, digest: leafHash(ordinal, body) };
}
export function importColumns(table: ImportTable) {
  return Object.keys(columnTypes[table]);
}
