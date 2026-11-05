import { z } from 'zod';

// Explicit coverage: additions to the source schema must be classified, never silently omitted.
export const retainedTables = [
  'households',
  'actors',
  'catalog_nodes',
  'items',
  'attribute_templates',
  'notes',
  'events',
  'operations',
  'barcode_index',
  'installations',
  'household_settings',
  'migrations',
  'catalog_policy_versions',
  'catalog_proposals',
  'catalog_identity_keys',
  'date_facts',
  'household_sync_state',
  'sync_changes',
  'sync_object_versions',
  'label_projection_checkpoint',
  'attachments',
  'attachment_blobs',
  'sensitive_access_audit',
  'item_splits',
  'attribute_references',
  'household_members',
  'household_invitations',
  'user',
  'auth_owners',
  'acornary_timezone_names',
] as const;
export const transientTables = [
  'session',
  'verification',
  'jwks',
  'oauthClient',
  'oauthResource',
  'oauthClientResource',
  'oauthRefreshToken',
  'oauthAccessToken',
  'oauthConsent',
  'oauthClientAssertion',
  'rateLimit',
  'auth_enrollments',
  'auth_ceremonies',
  'auth_attempts',
  'auth_oauth_selections',
  'upload_sessions',
  'frozen_exports',
  'frozen_export_rows',
] as const;
export const credentialTables = ['account', 'passkey'] as const;
export const sourceTables = [...retainedTables, ...transientTables, ...credentialTables].sort();
export type Mode = 'preview' | 'production';
export function includedTables(mode: Mode): string[] {
  return [...retainedTables, ...(mode === 'production' ? credentialTables : [])].sort();
}
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const manifestSchema = z.strictObject({
  format: z.literal('acornary-cloudflare-snapshot-v1'),
  snapshot_id: z.uuid(),
  mode: z.enum(['preview', 'production']),
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  source_snapshot: z.string().regex(/^\d+:\d+:[\d,]*$/),
  exported_at: z.iso.datetime(),
  tables: z.record(
    z.string(),
    z.strictObject({
      rows: count,
      bytes: count,
      sha256: digest,
      // Top-level PostgreSQL int8/numeric values are decimal strings on the migration wire.
      decimal_columns: z.array(z.string()),
    }),
  ),
  excluded: z.record(
    z.string(),
    z.strictObject({ rows: count, reason: z.enum(['transient', 'preview_credentials']) }),
  ),
  blobs: z.record(digest, z.strictObject({ bytes: count, sha256: digest })),
});
export type SnapshotManifest = z.infer<typeof manifestSchema>;
export function validateManifest(raw: unknown): SnapshotManifest {
  const m = manifestSchema.parse(raw);
  if (Object.keys(m.tables).sort().join('|') !== includedTables(m.mode).join('|'))
    throw new Error('Incomplete snapshot table coverage');
  if (
    [...Object.keys(m.tables), ...Object.keys(m.excluded)].sort().join('|') !==
    sourceTables.join('|')
  )
    throw new Error('Incomplete source schema coverage');
  for (const [table, info] of Object.entries(m.excluded)) {
    if (
      info.reason !==
      (credentialTables.includes(table as 'account' | 'passkey')
        ? 'preview_credentials'
        : 'transient')
    )
      throw new Error('Invalid table exclusion');
  }
  return m;
}
