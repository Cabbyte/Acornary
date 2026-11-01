import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pool, query } from './db.js';
import { definitionHashes } from './registry.js';
import { findTemplate, templateDefinition } from '../../../packages/contracts/src/index.js';
type Release = { version: string; commit: string; migrations: Record<string, string> };
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function localMigrations() {
  return Object.fromEntries(
    readdirSync('migrations')
      .filter((n) => n.endsWith('.sql'))
      .sort()
      .map((name) => [name, hash(readFileSync(`migrations/${name}`))]),
  );
}
function load(): Release {
  try {
    const value = JSON.parse(readFileSync('release.json', 'utf8'));
    if (
      typeof value.version !== 'string' ||
      !/^[0-9a-f]{40}$/.test(value.commit) ||
      !value.migrations ||
      !Object.keys(value.migrations).length ||
      Object.entries(value.migrations).some(
        ([name, checksum]) =>
          !/^[\w.-]+\.sql$/.test(name) ||
          typeof checksum !== 'string' ||
          !/^[a-f0-9]{64}$/.test(checksum),
      )
    )
      throw new Error('Invalid release metadata');
    // A stale release.json must not silently omit a newly shipped migration.
    if (
      JSON.stringify(Object.entries(value.migrations).sort()) !==
      JSON.stringify(Object.entries(localMigrations()).sort())
    )
      throw new Error('Release migration manifest differs from shipped migrations');
    return value;
  } catch (e: any) {
    if (e.code === 'ENOENT')
      return { version: 'development', commit: 'unknown', migrations: localMigrations() };
    throw e;
  }
}
export const release = load();
export async function verifyReleaseMigrations(database = pool, expected = release.migrations) {
  const applied = new Map(
    (await query(database, 'SELECT name,checksum,status FROM migrations')).rows.map((r) => [
      r.name,
      r,
    ]),
  );
  for (const [name, checksum] of Object.entries(expected)) {
    const row = applied.get(name);
    if (!row || row.status !== 'APPLIED' || row.checksum !== checksum)
      throw new Error(`Release migration missing, unverified or changed: ${name}`);
  }
  return { status: 'ok' as const, count: Object.keys(expected).length };
}
export async function verifyTemplateSchemas(database = pool) {
  const rows = (
    await query(database, 'SELECT id,version,target_kind,definition FROM attribute_templates')
  ).rows;
  const hashes = new Set<string>();
  for (const row of rows) {
    const actual = definitionHashes(row.definition).schema_hash;
    const known = findTemplate(row.id, row.version);
    if (
      (known &&
        (row.target_kind !== known.target_kind ||
          actual !== definitionHashes(templateDefinition(row.id, row.version)).schema_hash)) ||
      (row.definition.schema_hash && row.definition.schema_hash !== actual)
    )
      throw new Error('Published template schema hash mismatch');
    hashes.add(`${row.id}@${row.version}:${actual}`);
  }
  return { status: 'ok' as const, hash: hash(JSON.stringify([...hashes].sort())) };
}
export async function verifyAttachmentStorage(
  root = resolve(process.env.ACORNARY_ATTACHMENT_ROOT ?? '.local/attachments'),
) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `.readiness-${randomUUID()}`);
  const file = await open(path, 'wx+', 0o600);
  try {
    await file.writeFile('acornary');
    await file.sync();
    const bytes = Buffer.alloc(8);
    await file.read(bytes, 0, bytes.length, 0);
    if (bytes.toString() !== 'acornary') throw new Error('Attachment storage readback failed');
  } finally {
    await file.close();
    await unlink(path);
  }
  return { status: 'ok' as const };
}
export async function verifyStartup() {
  const migrations = await verifyReleaseMigrations();
  const templates = await verifyTemplateSchemas();
  const storage = await verifyAttachmentStorage();
  return { migrations, templates, storage };
}
export async function healthStatus() {
  // Keep failure diagnostics private: no paths, table names, connection details or payloads.
  const checks = await Promise.allSettled([
    verifyReleaseMigrations(),
    verifyTemplateSchemas(),
    verifyAttachmentStorage(),
  ]);
  const ok = checks.every((result) => result.status === 'fulfilled');
  return {
    status: ok ? 'ok' : 'unavailable',
    version: release.version,
    commit: release.commit,
    migrations: checks[0].status === 'fulfilled' ? checks[0].value : { status: 'failed' },
    templates: checks[1].status === 'fulfilled' ? checks[1].value : { status: 'failed' },
    storage: checks[2].status === 'fulfilled' ? checks[2].value : { status: 'failed' },
    backup: { status: 'unverified' },
  };
}
