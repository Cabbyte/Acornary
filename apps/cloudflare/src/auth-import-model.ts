import { z } from 'zod';

const id = z.string().min(1).max(512);
const nullableText = z.string().nullable();
// Preserve the UTC timestamp text, including sub-millisecond source precision.
const date = z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const importRowSchema = z.discriminatedUnion('table', [
  z.strictObject({
    table: z.literal('user'),
    value: z.strictObject({
      id,
      name: z.string(),
      email: z.string().min(1),
      emailVerified: z.boolean(),
      image: nullableText,
      createdAt: date,
      updatedAt: date,
      enabled: z.boolean(),
      auth_version: count,
    }),
  }),
  z.strictObject({
    table: z.literal('account'),
    value: z.strictObject({
      id,
      accountId: id,
      providerId: id,
      userId: id,
      password: nullableText,
      scope: nullableText,
      createdAt: date,
      updatedAt: date,
    }),
  }),
  z.strictObject({
    table: z.literal('passkey'),
    value: z.strictObject({
      id,
      name: nullableText,
      publicKey: z.string().min(1),
      userId: id,
      credentialID: z.string().min(1),
      counter: z.number().int().min(0).max(4294967295),
      deviceType: z.string().min(1),
      backedUp: z.boolean(),
      transports: nullableText,
      createdAt: date.nullable(),
      aaguid: nullableText,
    }),
  }),
  z.strictObject({
    table: z.literal('household_directory'),
    value: z.strictObject({
      id,
      name: z.string(),
      state: z.literal('PENDING'),
      revision: z.literal(1),
    }),
  }),
  z.strictObject({
    table: z.literal('membership_directory'),
    value: z.strictObject({
      id,
      household_id: id,
      user_id: id,
      deleted: z.literal(0),
      revision: z.literal(1),
    }),
  }),
]);
export type AuthImportRow = z.infer<typeof importRowSchema>;
export const authImportTables = [
  'user',
  'account',
  'passkey',
  'household_directory',
  'membership_directory',
] as const;
export const importDescriptorSchema = z.strictObject({
  format: z.literal('acornary-d1-auth-import-v1'),
  manifest_hash: hashSchema,
  mode: z.enum(['preview', 'production']),
  chunks: z.array(hashSchema),
  counts: z.strictObject({
    user: count,
    account: count,
    passkey: count,
    household_directory: count,
    membership_directory: count,
  }),
});
export type AuthImportDescriptor = z.infer<typeof importDescriptorSchema>;
export const importChunkSchema = z.array(importRowSchema).min(1).max(50);
export const maxImportChunkBytes = 128 * 1024;
export async function chunkDigest(rows: AuthImportRow[]) {
  const encoded = new TextEncoder().encode(JSON.stringify(rows));
  if (encoded.byteLength > maxImportChunkBytes)
    throw new Error('Auth import chunk exceeds byte limit');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
