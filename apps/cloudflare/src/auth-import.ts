import {
  authImportTables,
  importChunkSchema,
  importDescriptorSchema,
  chunkDigest,
  hashSchema,
  type AuthImportDescriptor,
  type AuthImportRow,
} from './auth-import-model.js';

// Internal migration capability only. No public HTTP route exposes these methods.
// The caller must authenticate the migration operator and verify the frozen snapshot manifest.
export class AuthSnapshotImporter {
  constructor(private readonly database: D1Database) {}

  private session() {
    return this.database.withSession('first-primary');
  }

  async start(input: AuthImportDescriptor) {
    const descriptor = importDescriptorSchema.parse(input);
    if (descriptor.mode === 'preview' && (descriptor.counts.account || descriptor.counts.passkey))
      throw new Error('Preview credentials cannot be imported');
    const text = JSON.stringify(descriptor);
    // A single conditional INSERT checks empty application tables and reserves the database.
    // Never turn this into an UPSERT of account data: imports must not overwrite a live database.
    const emptyTables = [
      ...authImportTables,
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
    ];
    const db = this.session();
    await db
      .prepare(
        `INSERT INTO cf_auth_import(singleton,manifest_hash,descriptor,state)
      SELECT 1,?,?,'IMPORTING' WHERE ${emptyTables.map((t) => `NOT EXISTS(SELECT 1 FROM "${t}")`).join(' AND ')}
      ON CONFLICT(singleton) DO NOTHING`,
      )
      .bind(descriptor.manifest_hash, text)
      .run();
    const job = await db
      .prepare('SELECT descriptor,next_chunk,state FROM cf_auth_import WHERE singleton=1')
      .first<{ descriptor: string; next_chunk: number; state: string }>();
    if (!job || job.descriptor !== text)
      throw new Error('Auth import requires an empty database or the identical migration plan');
    return { next_chunk: job.next_chunk, state: job.state };
  }

  async append(manifestHash: string, index: number, input: AuthImportRow[]) {
    hashSchema.parse(manifestHash);
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid import chunk index');
    const rows = importChunkSchema.parse(input),
      digest = await chunkDigest(rows);
    const db = this.session();
    const job = await db
      .prepare('SELECT descriptor FROM cf_auth_import WHERE singleton=1 AND manifest_hash=?')
      .bind(manifestHash)
      .first<{ descriptor: string }>();
    if (!job) throw new Error('Unknown auth import');
    const descriptor = importDescriptorSchema.parse(JSON.parse(job.descriptor));
    if (descriptor.chunks[index] !== digest)
      throw new Error('Auth import chunk does not match the frozen plan');
    if (
      descriptor.mode === 'preview' &&
      rows.some((row) => row.table === 'account' || row.table === 'passkey')
    )
      throw new Error('Preview credentials cannot be imported');
    const receipt = () =>
      db
        .prepare('SELECT sha256 FROM cf_auth_import_chunks WHERE chunk_index=? AND manifest_hash=?')
        .bind(index, manifestHash)
        .first<{ sha256: string }>();
    if ((await receipt())?.sha256 === digest) return { replayed: true };
    try {
      await db.batch([
        // CHECK and FK constraints make a stale/out-of-order chunk fail inside the same transaction as data writes.
        db
          .prepare(
            `INSERT INTO cf_auth_import_chunks(chunk_index,sha256,manifest_hash,valid_sequence)
          VALUES(?,?,?,CASE WHEN EXISTS(SELECT 1 FROM cf_auth_import WHERE singleton=1 AND manifest_hash=? AND state='IMPORTING' AND next_chunk=?) THEN 1 ELSE 0 END)`,
          )
          .bind(index, digest, manifestHash, manifestHash, index),
        ...rows.map((row) => {
          const columns = Object.keys(row.value);
          return db
            .prepare(
              `INSERT INTO "${row.table}"(${columns.map((c) => '"' + c + '"').join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            )
            .bind(...Object.values(row.value).map((v) => (typeof v === 'boolean' ? Number(v) : v)));
        }),
        db.prepare('UPDATE cf_auth_import SET next_chunk=next_chunk+1 WHERE singleton=1'),
      ]);
      return { replayed: false };
    } catch (error) {
      // Handles a lost response or concurrent delivery only after the atomic receipt is visible.
      if ((await receipt())?.sha256 === digest) return { replayed: true };
      throw error;
    }
  }

  async finish(manifestHash: string) {
    hashSchema.parse(manifestHash);
    const db = this.session();
    const job = await db
      .prepare('SELECT descriptor FROM cf_auth_import WHERE singleton=1 AND manifest_hash=?')
      .bind(manifestHash)
      .first<{ descriptor: string }>();
    if (!job) throw new Error('Unknown auth import');
    const descriptor = importDescriptorSchema.parse(JSON.parse(job.descriptor));
    const result = await db
      .prepare(
        `UPDATE cf_auth_import SET state='AUTH_IMPORTED'
      WHERE singleton=1 AND manifest_hash=? AND next_chunk=?
      AND ${authImportTables.map((t) => `(SELECT count(*) FROM "${t}")=?`).join(' AND ')} RETURNING state`,
      )
      .bind(
        manifestHash,
        descriptor.chunks.length,
        ...authImportTables.map((t) => descriptor.counts[t]),
      )
      .first();
    if (!result) throw new Error('Auth import is incomplete or row counts differ');
    return { state: 'AUTH_IMPORTED' as const };
  }
}
