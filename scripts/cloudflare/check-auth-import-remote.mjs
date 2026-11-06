// Opt-in live check. Creates and deletes only a uniquely named, disposable D1 database.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { AuthSnapshotImporter } from '../../apps/cloudflare/src/auth-import.ts';
import { chunkDigest } from '../../apps/cloudflare/src/auth-import-model.ts';

const base = JSON.parse(await readFile('apps/cloudflare/resources.preview.json', 'utf8'));
const name = 'acornary-cf-check-' + randomUUID();
const temp = await mkdtemp(join(tmpdir(), 'acornary-cf-check-'));
const configPath = join(temp, 'wrangler.json');
const config = { name, account_id: base.account_id, compatibility_date: base.compatibility_date };
await writeFile(configPath, JSON.stringify(config));
const exec = promisify(execFile);
const wrangler = async (args) =>
  (
    await exec('pnpm', ['exec', 'wrangler', ...args, '--config', configPath], {
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
let created = false,
  proxy;
try {
  const output = await wrangler([
    'd1',
    'create',
    name,
    '--location',
    'apac',
    '--update-config=false',
  ]);
  created = true;
  const databaseId = output.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1];
  if (!databaseId) throw new Error('Could not parse disposable D1 ID');
  await writeFile(
    configPath,
    JSON.stringify({
      ...config,
      d1_databases: [
        {
          binding: 'AUTH_DB',
          database_name: name,
          database_id: databaseId,
          remote: true,
          migrations_dir: resolve('apps/cloudflare/migrations/auth'),
        },
      ],
    }),
  );
  await wrangler(['d1', 'migrations', 'apply', 'AUTH_DB', '--remote']);
  proxy = await getPlatformProxy({
    configPath,
    envFiles: [],
    remoteBindings: true,
    persist: false,
  });
  const db = proxy.env.AUTH_DB,
    importer = new AuthSnapshotImporter(db);
  const chunks = [
    [
      {
        table: 'user',
        value: {
          id: 'remote-test-user',
          name: 'Migration check',
          email: 'migration@example.invalid',
          emailVerified: true,
          image: null,
          createdAt: '2026-11-05T00:00:00Z',
          updatedAt: '2026-11-05T00:00:00Z',
          enabled: false,
          auth_version: 3,
        },
      },
    ],
    [
      {
        table: 'household_directory',
        value: { id: 'test-household', name: 'Migration check', state: 'PENDING', revision: 1 },
      },
      {
        table: 'membership_directory',
        value: {
          id: 'test-membership',
          household_id: 'test-household',
          user_id: 'remote-test-user',
          deleted: 0,
          revision: 1,
        },
      },
    ],
  ];
  const descriptor = {
    format: 'acornary-d1-auth-import-v1',
    manifest_hash: 'a'.repeat(64),
    mode: 'preview',
    chunks: await Promise.all(chunks.map(chunkDigest)),
    counts: { user: 1, account: 0, passkey: 0, household_directory: 1, membership_directory: 1 },
  };
  await importer.start(descriptor);
  await assert.rejects(importer.append(descriptor.manifest_hash, 1, chunks[1]));
  assert.equal((await db.prepare('SELECT count(*) n FROM household_directory').first()).n, 0);
  const results = await Promise.all(
    Array.from({ length: 4 }, () => importer.append(descriptor.manifest_hash, 0, chunks[0])),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const resumed = new AuthSnapshotImporter(db);
  assert.equal((await resumed.start(descriptor)).next_chunk, 1);
  await resumed.append(descriptor.manifest_hash, 1, chunks[1]);
  await resumed.finish(descriptor.manifest_hash);
  assert.equal((await resumed.append(descriptor.manifest_hash, 1, chunks[1])).replayed, true);
  const result = await db.prepare('SELECT enabled,auth_version FROM user').all();
  assert.deepEqual(result.results, [{ enabled: 0, auth_version: 3 }]);
  assert.equal(
    (await db.prepare('SELECT state FROM household_directory').first()).state,
    'PENDING',
  );
  console.log(
    JSON.stringify({
      remote_d1_import: 'PASS',
      served_by_region: result.meta.served_by_region,
      served_by_primary: result.meta.served_by_primary,
    }),
  );
} finally {
  await proxy?.dispose();
  if (created) {
    await wrangler(['d1', 'delete', name, '--skip-confirmation']);
    console.log('Disposable D1 deleted');
  }
  await rm(temp, { recursive: true, force: true });
}
