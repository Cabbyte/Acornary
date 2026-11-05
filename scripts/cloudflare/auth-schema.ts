// Build-time only. Runtime uses D1; node:sqlite is never bundled into Workers.
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { passkey } from '@better-auth/passkey';
import { cimd } from '@better-auth/cimd';
import { readFile, writeFile } from 'node:fs/promises';
const db = new DatabaseSync(':memory:');
try {
  const migrations = await getMigrations({
    database: db,
    user: { additionalFields: {
      enabled: { type: 'boolean', defaultValue: true, input: false },
      auth_version: { type: 'number', defaultValue: 0, input: false },
    } },
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [jwt(), passkey(), mcp({
      resource: 'https://cf.acornary.protium.top/mcp',
      loginPage: '/login', consentPage: '/consent',
      allowDynamicClientRegistration: false,
    }), cimd({ metadataProfile: 'mcp-2026-07-28', fetchClientMetadataResource: async () => { throw new Error('Schema generation must not fetch metadata'); } })],
  });
  const sql = '-- Generated from locked Better Auth 1.7.5 schemas. Do not edit manually.\n' + await migrations.compileMigrations() + '\n';
  const path = 'apps/cloudflare/migrations/auth/0001_better_auth.sql';
  if (process.argv.includes('--capture')) await writeFile(path, sql);
  else if (await readFile(path, 'utf8') !== sql) throw new Error('Authentication schema drift');
  db.exec(sql);
  console.log('Better Auth SQLite schema compiled and validated');
} finally { db.close(); }
