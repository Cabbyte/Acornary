import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { getPlatformProxy } from 'wrangler';
import { exportSnapshot } from '../../scripts/cloudflare/migration/export.ts';
import { verifySnapshot } from '../../scripts/cloudflare/migration/verify.ts';
import { prepareAuthImport } from '../../scripts/cloudflare/migration/prepare-auth.ts';
import { AuthSnapshotImporter } from '../../apps/cloudflare/src/auth-import.ts';
import { AuthDirectory } from '../../apps/cloudflare/src/auth-directory.ts';
import { chunkDigest } from '../../apps/cloudflare/src/auth-import-model.ts';
const container = 'acornary-cf-snapshot-test-' + randomUUID();
let pool, root, blobs, hh;
const commit = '18f7e0496ecb4fb960a6619f12f57c68b3898410';
const key = 'a'.repeat(64),
  bytes = Buffer.from('%PDF-1.7\nSnapshot attachment\n');
const sha = createHash('sha256').update(bytes).digest('hex');
function docker(args, env = process.env) {
  const r = spawnSync('docker', args, { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error('Disposable Docker operation failed: ' + r.stderr);
  return r.stdout.trim();
}
before(
  async () => {
    root = await mkdtemp(join(tmpdir(), 'acornary-cf-snapshot-'));
    blobs = join(root, 'source-blobs');
    await mkdir(blobs);
    const password = randomBytes(24).toString('hex');
    docker(
      [
        'run',
        '--rm',
        '-d',
        '--name',
        container,
        '-e',
        'POSTGRES_PASSWORD',
        '-e',
        'POSTGRES_DB=acornary_test',
        '-p',
        '127.0.0.1::5432',
        'postgres:18-bookworm',
      ],
      { ...process.env, POSTGRES_PASSWORD: password },
    );
    const port = docker(['port', container, '5432/tcp']).split(':').at(-1);
    const url = new URL('postgresql://postgres@127.0.0.1:' + port + '/acornary_test');
    url.password = password;
    pool = new pg.Pool({ connectionString: url.href, max: 3 });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        await pool.query('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert.ok(ready, 'Disposable PostgreSQL did not start');
    const init = spawnSync(process.execPath, ['--import', 'tsx', 'apps/server/src/initialize.ts'], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(init.status, 0, init.stderr);
    const initialized = JSON.parse(init.stdout.trim());
    hh = initialized.household_id;
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified") VALUES('user','Snapshot user','snapshot@example.invalid',true)`,
    );
    await pool.query(
      `INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt","accessToken") VALUES('credential','user','credential','user','password-hash',now(),'must-not-export')`,
    );
    await pool.query(
      `INSERT INTO session(id,"expiresAt",token,"updatedAt","userId") VALUES('session',now()+interval '1 day','must-not-export-session',now(),'user')`,
    );
    await pool.query(
      `INSERT INTO household_members(id,user_id,household_id,actor_id) VALUES('member','user',$1,$2)`,
      [hh, initialized.actor_id],
    );
    await pool.query(
      `INSERT INTO auth_owners(user_id,household_id,actor_id,enabled) VALUES('user',$1,$2,false)`,
      [hh, initialized.actor_id],
    );
    await pool.query(
      `INSERT INTO passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp") VALUES('passkey','public-key','user','credential-id',4294967295,'multiDevice',true)`,
    );
    await pool.query(
      'INSERT INTO attachment_blobs(id,household_id,storage_key,mime_type,file_size,sha256) VALUES($1,$2,$3,$4,$5,$6)',
      ['blob_fixture', hh, key, 'application/pdf', bytes.length, sha],
    );
    await writeFile(join(blobs, key + '.blob'), bytes);
    await pool.query(
      'INSERT INTO household_sync_state(household_id,last_committed_change_id) VALUES($1,$2) ON CONFLICT(household_id) DO UPDATE SET last_committed_change_id=excluded.last_committed_change_id',
      [hh, '9007199254740993'],
    );
  },
  { timeout: 120000 },
);
after(async () => {
  await pool?.end();
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
  if (root) await rm(root, { recursive: true, force: true });
});
async function snapshot(mode = 'preview', onTable) {
  const output = join(root, randomUUID());
  const result = await exportSnapshot(pool, {
    output,
    attachmentsRoot: blobs,
    sourceCommit: commit,
    mode,
    onTable,
  });
  return {
    output,
    result,
    manifest: JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
  };
}
test('complete schema snapshot excludes credentials, preserves int64, verifies attachment bytes', async () => {
  const { output, result, manifest } = await snapshot();
  assert.equal(result.attachment_bytes, 'VERIFIED');
  assert.equal(result.blobs, 1);
  assert.equal(manifest.excluded.account.reason, 'preview_credentials');
  assert.equal(manifest.excluded.session.rows, 1);
  await assert.rejects(access(join(output, 'tables', 'account.ndjson')));
  const state = JSON.parse(
    (await readFile(join(output, 'tables', 'household_sync_state.ndjson'), 'utf8')).trim(),
  );
  assert.equal(state.last_committed_change_id, '9007199254740993');
  assert.deepEqual(await readFile(join(output, 'blobs', key + '.blob')), bytes);
  assert.equal((await stat(output)).mode & 0o777, 0o700);
  assert.equal((await stat(join(output, 'manifest.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await verifySnapshot(output, result.manifest_sha256), result);
  await assert.rejects(verifySnapshot(output, '0'.repeat(64)), /Manifest checksum/);
});
test('all tables share a consistent snapshot despite concurrent writes', async () => {
  await pool.query("UPDATE \"user\" SET name='Before' WHERE id='user'");
  let changed = false;
  const { output } = await snapshot('preview', async (table) => {
    if (table === 'households') {
      await pool.query("UPDATE \"user\" SET name='After' WHERE id='user'");
      changed = true;
    }
  });
  assert.ok(changed);
  assert.equal(
    JSON.parse((await readFile(join(output, 'tables', 'user.ndjson'), 'utf8')).trim()).name,
    'Before',
  );
  assert.equal(
    (await pool.query('SELECT name FROM "user" WHERE id=$1', ['user'])).rows[0].name,
    'After',
  );
});
test('production package retains password hashes but never copies OAuth bearer secrets', async () => {
  const { output, manifest } = await snapshot('production');
  const row = JSON.parse((await readFile(join(output, 'tables', 'account.ndjson'), 'utf8')).trim());
  assert.equal(row.password, 'password-hash');
  assert.equal(row.accessToken, undefined);
  assert.ok(manifest.tables.passkey);
  assert.equal(manifest.excluded.session.reason, 'transient');
});
test('corruption, incomplete coverage, missing files and symlinks cannot pass verification', async () => {
  const { output } = await snapshot();
  const blob = join(output, 'blobs', key + '.blob');
  await writeFile(blob, 'corrupted');
  await assert.rejects(verifySnapshot(output), /Blob checksum/);
  await rm(blob);
  await assert.rejects(verifySnapshot(output), /missing blob/);
  await symlink(join(blobs, key + '.blob'), blob);
  await assert.rejects(verifySnapshot(output));
  await rm(blob);
  await writeFile(blob, bytes);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  delete manifest.tables.events;
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifySnapshot(output), /coverage/);
});
test('unknown source tables abort before creating an apparently complete package', async () => {
  await pool.query('CREATE TABLE future_inventory_fact(id text)');
  try {
    await assert.rejects(snapshot(), /Source schema differs/);
  } finally {
    await pool.query('DROP TABLE future_inventory_fact');
  }
});
test('missing source blob leaves no completed manifest', async () => {
  const output = join(root, randomUUID());
  await rm(join(blobs, key + '.blob'));
  try {
    await assert.rejects(
      exportSnapshot(pool, {
        output,
        attachmentsRoot: blobs,
        sourceCommit: commit,
        mode: 'preview',
      }),
    );
    await assert.rejects(access(join(output, 'manifest.json')));
  } finally {
    await writeFile(join(blobs, key + '.blob'), bytes);
  }
});

async function withD1(run) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("migration test"); } };',
      compatibilityDate: '2026-11-05',
      d1Databases: { AUTH_DB: 'migration' },
    }),
  );
  try {
    const db = await mf.getD1Database('AUTH_DB');
    for (const file of ['0001_better_auth.sql', '0002_directory.sql', '0003_snapshot_import.sql']) {
      for (const statement of (await readFile('apps/cloudflare/migrations/auth/' + file, 'utf8'))
        .split(';')
        .filter((s) => s.trim()))
        await db.prepare(statement).run();
    }
    return await run(db, new AuthSnapshotImporter(db));
  } finally {
    await mf.dispose();
  }
}
test('real PG snapshot imports into D1 without restoring disabled accounts or activating families', async () => {
  const { output, result } = await snapshot('production');
  const { descriptor, chunks } = await prepareAuthImport(output, result.manifest_sha256);
  await withD1(async (db, importer) => {
    assert.equal((await importer.start(descriptor)).next_chunk, 0);
    await assert.rejects(importer.finish(descriptor.manifest_hash), /incomplete/);
    await assert.rejects(importer.append(descriptor.manifest_hash, 1, chunks[1]));
    assert.equal((await importer.start(descriptor)).next_chunk, 0);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => importer.append(descriptor.manifest_hash, 0, chunks[0])),
    );
    assert.equal(concurrent.filter((r) => !r.replayed).length, 1);
    // A fresh importer instance resumes the persisted journal after a lost client/process.
    const resumed = new AuthSnapshotImporter(db);
    assert.equal((await resumed.start(descriptor)).next_chunk, 1);
    for (let i = 1; i < chunks.length; i++)
      await resumed.append(descriptor.manifest_hash, i, chunks[i]);
    assert.deepEqual(await resumed.finish(descriptor.manifest_hash), { state: 'AUTH_IMPORTED' });
    assert.equal(
      (await db.prepare('SELECT password FROM account').first()).password,
      'password-hash',
    );
    assert.equal((await db.prepare('SELECT counter FROM passkey').first()).counter, 4294967295);
    assert.equal((await db.prepare('SELECT count(*) n FROM session').first()).n, 0);
    assert.equal((await db.prepare('SELECT accessToken FROM account').first()).accessToken, null);
    assert.equal(
      (await db.prepare('SELECT state FROM household_directory').first()).state,
      'PENDING',
    );
    assert.equal(await new AuthDirectory(db).principal('user'), null);
    assert.equal(await new AuthDirectory(db).routeMembership('user', 'member'), null);
    assert.equal((await resumed.append(descriptor.manifest_hash, 0, chunks[0])).replayed, true);
    await assert.rejects(
      resumed.start({ ...descriptor, manifest_hash: '0'.repeat(64) }),
      /identical/,
    );
    const changed = structuredClone(chunks[0]);
    changed[0].value.name = 'Changed';
    await assert.rejects(resumed.append(descriptor.manifest_hash, 0, changed), /frozen plan/);
  });
});
test('D1 import rolls back the entire chunk and its receipt on a foreign-key failure', async () => {
  const { output, result } = await snapshot('preview');
  const { descriptor, chunks } = await prepareAuthImport(output, result.manifest_sha256);
  const invalid = [
    ...chunks[0],
    {
      table: 'membership_directory',
      value: { id: 'bad', household_id: 'missing', user_id: 'user', deleted: 0, revision: 1 },
    },
  ];
  descriptor.chunks = [await chunkDigest(invalid)];
  descriptor.counts.membership_directory = 1;
  await withD1(async (db, importer) => {
    await importer.start(descriptor);
    await assert.rejects(importer.append(descriptor.manifest_hash, 0, invalid), /FOREIGN KEY/);
    assert.equal((await db.prepare('SELECT count(*) n FROM user').first()).n, 0);
    assert.equal((await db.prepare('SELECT count(*) n FROM cf_auth_import_chunks').first()).n, 0);
    assert.equal((await importer.start(descriptor)).next_chunk, 0);
  });
});
test('preview import excludes credentials, rejects plan tampering and cannot overwrite an existing database', async () => {
  const { output, result } = await snapshot();
  const { descriptor, chunks } = await prepareAuthImport(output, result.manifest_sha256);
  await withD1(async (db, importer) => {
    await importer.start(descriptor);
    for (let i = 0; i < chunks.length; i++)
      await importer.append(descriptor.manifest_hash, i, chunks[i]);
    await importer.finish(descriptor.manifest_hash);
    assert.equal((await db.prepare('SELECT count(*) n FROM account').first()).n, 0);
    assert.equal((await db.prepare('SELECT count(*) n FROM passkey').first()).n, 0);
  });
  await withD1(async (db, importer) => {
    await db
      .prepare(
        `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES('existing','Existing','existing@example.invalid',1,'2026-11-05T00:00:00Z','2026-11-05T00:00:00Z',1,0)`,
      )
      .run();
    await assert.rejects(importer.start(descriptor), /empty database/);
    assert.equal((await db.prepare('SELECT count(*) n FROM cf_auth_import').first()).n, 0);
  });
});

test('operator CLI imports and resumes against the explicitly selected persistent local D1', async () => {
  const { output, result } = await snapshot();
  const databaseId = randomUUID(),
    config = join(root, 'local-import.json'),
    state = join(root, 'd1-state');
  await writeFile(
    config,
    JSON.stringify({
      name: 'acornary-cf-preview-test',
      compatibility_date: '2026-11-05',
      d1_databases: [
        { binding: 'AUTH_DB', database_name: 'migration-test', database_id: databaseId },
      ],
    }),
  );
  const options = {
    configPath: config,
    envFiles: [],
    remoteBindings: false,
    persist: { path: state },
  };
  let proxy = await getPlatformProxy(options);
  try {
    for (const file of ['0001_better_auth.sql', '0002_directory.sql', '0003_snapshot_import.sql'])
      for (const sql of (await readFile('apps/cloudflare/migrations/auth/' + file, 'utf8'))
        .split(';')
        .filter((s) => s.trim()))
        await proxy.env.AUTH_DB.prepare(sql).run();
  } finally {
    await proxy.dispose();
  }
  const args = [
    '--import',
    'tsx',
    'scripts/cloudflare/import-auth.mjs',
    '--snapshot',
    output,
    '--expected-sha256',
    result.manifest_sha256,
    '--config',
    config,
    '--database-id',
    databaseId,
    '--mode',
    'preview',
    '--local-state',
    state,
  ];
  for (let i = 0; i < 2; i++) {
    const imported = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /AUTH_IMPORTED/);
  }
  proxy = await getPlatformProxy(options);
  try {
    assert.equal((await proxy.env.AUTH_DB.prepare('SELECT count(*) n FROM user').first()).n, 1);
    assert.equal(
      (await proxy.env.AUTH_DB.prepare('SELECT state FROM cf_auth_import').first()).state,
      'AUTH_IMPORTED',
    );
  } finally {
    await proxy.dispose();
  }
});
