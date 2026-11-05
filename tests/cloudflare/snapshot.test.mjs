import { prepareHouseholdImports } from '../../scripts/cloudflare/migration/prepare-households.ts';
import { prepareReference } from '../../scripts/cloudflare/reference.mjs';
import { pathToFileURL } from 'node:url';
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
import { BlobSnapshotImporter, blobObjectKey } from '../../apps/cloudflare/src/blob-import.ts';
const container = 'acornary-cf-snapshot-test-' + randomUUID();
let pool, root, blobs, hh, sourcePool, sourceExecute, sourceApproved, sourceContext;
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
    const reference = await prepareReference();
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
      cwd: reference,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(init.status, 0, init.stderr);
    const initialized = JSON.parse(init.stdout.trim());
    hh = initialized.household_id;
    process.env.DATABASE_URL = url.href;
    sourcePool = (await import(pathToFileURL(join(reference, 'apps/server/src/db.ts')).href)).pool;
    sourceExecute = (
      await import(pathToFileURL(join(reference, 'apps/server/src/service.ts')).href)
    ).execute;
    sourceApproved = (await import(pathToFileURL(join(reference, 'tests/catalog-helpers.ts')).href))
      .approvedExecute;
    sourceContext = { ...initialized, source: 'TEST' };
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
  await sourcePool?.end();
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
      r2Buckets: { BLOBS: 'migration-blobs' },
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
    return await run(db, new AuthSnapshotImporter(db), await mf.getR2Bucket('BLOBS'));
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

test('operator CLIs import and resume against explicitly selected persistent local D1 and R2', async () => {
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
      r2_buckets: [{ binding: 'BLOBS', bucket_name: 'migration-blobs' }],
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
  const blobArgs = [
    '--import',
    'tsx',
    'scripts/cloudflare/import-blobs.mjs',
    '--snapshot',
    output,
    '--expected-sha256',
    result.manifest_sha256,
    '--config',
    config,
    '--bucket',
    'migration-blobs',
    '--mode',
    'preview',
    '--local-state',
    state,
  ];
  for (let i = 0; i < 2; i++) {
    const imported = spawnSync(process.execPath, blobArgs, { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    assert.match(imported.stdout, /BLOBS_VERIFIED/);
    assert.match(imported.stdout, new RegExp('"replayed":' + i));
  }
  proxy = await getPlatformProxy(options);
  try {
    assert.equal((await proxy.env.AUTH_DB.prepare('SELECT count(*) n FROM user').first()).n, 1);
    assert.equal(
      (await proxy.env.AUTH_DB.prepare('SELECT state FROM cf_auth_import').first()).state,
      'AUTH_IMPORTED',
    );
    assert.deepEqual(
      Buffer.from(await (await proxy.env.BLOBS.get(blobObjectKey(key))).arrayBuffer()),
      bytes,
    );
  } finally {
    await proxy.dispose();
  }
});

test('R2 migration checks real bytes, handles concurrent replay and never overwrites a different blob', async () => {
  await withD1(async (_db, _auth, bucket) => {
    const importer = new BlobSnapshotImporter(bucket),
      body = Uint8Array.from(bytes).buffer;
    const expected = { bytes: bytes.length, sha256: sha };
    const results = await Promise.all(
      Array.from({ length: 4 }, () => importer.put(key, body, expected)),
    );
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    const other = Uint8Array.from(Buffer.from('different')).buffer;
    await assert.rejects(importer.put(key, other, expected), /Source attachment checksum/);
    await assert.rejects(
      importer.put(key, other, {
        bytes: other.byteLength,
        sha256: createHash('sha256').update(new Uint8Array(other)).digest('hex'),
      }),
      /R2 attachment/,
    );
    assert.deepEqual(
      Buffer.from(await (await bucket.get(blobObjectKey(key))).arrayBuffer()),
      bytes,
    );
    await bucket.delete(blobObjectKey(key));
    await assert.rejects(importer.verify(key, expected), /Missing R2/);
  });
});
test('R2 migration preserves the full 25 MiB attachment limit', async () => {
  await withD1(async (_db, _auth, bucket) => {
    const importer = new BlobSnapshotImporter(bucket),
      body = new Uint8Array(25 * 1024 * 1024).fill(42).buffer;
    const expected = {
      bytes: body.byteLength,
      sha256: createHash('sha256').update(new Uint8Array(body)).digest('hex'),
    };
    assert.equal((await importer.put('b'.repeat(64), body, expected)).replayed, false);
    await assert.rejects(
      importer.put('c'.repeat(64), body, { ...expected, bytes: expected.bytes + 1 }),
      /Invalid attachment descriptor/,
    );
  });
});

test('real PostgreSQL household facts import into native DO with Merkle validation, resumption and lossless receipts', async () => {
  const actor = (await pool.query("SELECT actor_id FROM household_members WHERE user_id='user'"))
    .rows[0].actor_id;
  const operation = 'operation_' + randomUUID(),
    large = '迁移'.repeat(680000);
  await pool.query(
    'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)',
    [
      hh,
      actor,
      'large-migration-receipt',
      'original-source-fingerprint',
      JSON.stringify({ operation_id: operation, preserved: large, opaque: 'raw-literal' }).replace(
        '"raw-literal"',
        '900719925474099312345',
      ),
    ],
  );
  await pool.query("SELECT setval(pg_get_serial_sequence('sync_changes','change_id'),$1::bigint)", [
    '9007199254740993',
  ]);
  const catalog = await sourceApproved(sourceContext, 'create_catalog_node', {
    idempotency_key: randomUUID(),
    kind: 'SKU',
    name: '迁移牛奶',
    profile: 'CONSUMABLE',
  });
  const created = await sourceExecute(sourceContext, 'create_items', {
    idempotency_key: randomUUID(),
    catalog_node_id: catalog.affected_objects[0].id,
    count: 1,
    initial_attributes: [
      {
        template_id: 'contents',
        template_version: 1,
        values: { remaining: { value: '1000', unit: 'mL' } },
      },
    ],
  });
  const itemId = created.affected_objects[0].id;
  await sourceExecute(sourceContext, 'add_note', {
    idempotency_key: randomUUID(),
    target: { kind: 'ITEM', id: itemId },
    title: '迁移笔记',
    body: '保留备注',
    expected_revisions: { [itemId]: 1 },
  });
  const cursor = (
    await pool.query(
      'SELECT last_committed_change_id::text AS cursor FROM household_sync_state WHERE household_id=$1',
      [hh],
    )
  ).rows[0].cursor;
  const { output, result } = await snapshot('production');
  const plans = await prepareHouseholdImports(output, result.manifest_sha256);
  assert.equal(plans.length, 1);
  const { descriptor, chunks } = plans[0];
  assert.ok(chunks.length > 25);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'output/cloudflare-inventory/inventory-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { HOUSEHOLDS: { className: 'TestInventory', useSQLite: true } },
    }),
  );
  const invoke = async (method, ...args) => {
    const r = await mf.dispatchFetch('https://test.invalid/', {
      method: 'POST',
      body: JSON.stringify({ route: hh, method, args }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message);
    return data;
  };
  try {
    assert.equal((await invoke('beginImport', descriptor)).next_chunk, 0);
    await assert.rejects(invoke('finishImport', descriptor.manifest_hash), /incomplete/);
    await assert.rejects(
      invoke('importPart', descriptor.manifest_hash, 1, chunks[1].body, chunks[1].proof),
      /sequential/,
    );
    await assert.rejects(
      invoke('importPart', descriptor.manifest_hash, 0, chunks[0].body + ' ', chunks[0].proof),
      /anchored/,
    );
    await invoke('importPart', descriptor.manifest_hash, 0, chunks[0].body, chunks[0].proof);
    await invoke('importPart', descriptor.manifest_hash, 0, chunks[0].body, chunks[0].proof);
    assert.equal((await invoke('beginImport', descriptor)).next_chunk, 1);
    const ctx = { household_id: hh, user_id: 'user', actor_id: actor, source: 'TEST' };
    await assert.rejects(invoke('command', ctx, 'query_items', {}), /incomplete/);
    for (const chunk of chunks.slice(1))
      await invoke('importPart', descriptor.manifest_hash, chunk.ordinal, chunk.body, chunk.proof);
    assert.equal((await invoke('finishImport', descriptor.manifest_hash)).status, 'VALIDATED');
    const originalGeneration = (
      await pool.query('SELECT sync_generation FROM household_sync_state WHERE household_id=$1', [
        hh,
      ])
    ).rows[0].sync_generation;
    await assert.rejects(invoke('command', ctx, 'query_items', {}), /incomplete/);
    await assert.rejects(invoke('activateImport', descriptor.manifest_hash), /attachment bytes/);
    await invoke('confirmImportedBlob', descriptor.manifest_hash, key, bytes.length, sha);
    assert.equal((await invoke('activateImport', descriptor.manifest_hash)).status, 'ACTIVE');
    const state = await invoke('synchronize', ctx, 'state', {});
    assert.equal(state.last_change_id, cursor);
    assert.notEqual(state.generation, originalGeneration);
    const stored = (
      await invoke(
        'inspect',
        'SELECT result,result_payload,operation_id FROM operations WHERE idempotency_key=?1',
        ['large-migration-receipt'],
      )
    )[0];
    assert.equal(stored.operation_id, operation);
    assert.equal(stored.result.preserved, large);
    assert.ok(stored.result_payload);
    // Inspect payload bytes through hexadecimal SQL chunks, never through JSON number parsing.
    const parts = await invoke(
      'inspect',
      'SELECT hex(data) AS bytes FROM cf_payload_chunks WHERE payload_id=?1 ORDER BY ordinal',
      [stored.result_payload],
    );
    const raw = Buffer.concat(parts.map((p) => Buffer.from(p.bytes, 'hex'))).toString();
    assert.match(raw, /900719925474099312345/);
    assert.equal((await invoke('activateImport', descriptor.manifest_hash)).status, 'ACTIVE');
    assert.equal((await invoke('synchronize', ctx, 'state', {})).generation, state.generation);
    const input = {
      idempotency_key: randomUUID(),
      item_id: itemId,
      amount: { value: '0.1', unit: 'mL' },
      expected_revisions: { [itemId]: 2 },
    };
    const before = await sourceExecute(sourceContext, 'consume_item_content', input),
      after = await invoke('command', ctx, 'consume_item_content', input);
    assert.deepEqual(after.affected_objects, before.affected_objects);
    assert.deepEqual(await invoke('command', ctx, 'consume_item_content', input), after);
    const item = await invoke('command', ctx, 'get_item', { item_id: itemId });
    assert.equal(
      item.attributes.find((a) => a.template_id === 'contents').values.remaining.value,
      '999.9',
    );
    await assert.rejects(
      invoke('beginImport', { ...descriptor, manifest_hash: '0'.repeat(64) }),
      /another import/,
    );
  } finally {
    await mf.dispose();
  }
});
test('internal migration service activates only after matching D1 identities and actual R2 byte verification', async () => {
  const { output, result } = await snapshot('production'),
    hash = result.manifest_sha256;
  const { descriptor, chunks } = await prepareAuthImport(output, hash),
    plans = await prepareHouseholdImports(output, hash);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      name: 'migration-service-test',
      modules: true,
      scriptPath: 'output/cloudflare-inventory/inventory-worker.js',
      compatibilityDate: '2026-11-05',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { HOUSEHOLDS: { className: 'TestInventory', useSQLite: true } },
      d1Databases: { AUTH_DB: 'migration-service-auth' },
      r2Buckets: { BLOBS: 'migration-service-blobs', BACKUPS: 'migration-service-backups' },
      bindings: { ENVIRONMENT: 'production', ORIGIN: 'https://migration-test.invalid' },
      serviceBindings: {
        MIGRATION: { name: 'migration-service-test', entrypoint: 'MigrationEntrypoint' },
      },
    }),
  );
  try {
    const db = await mf.getD1Database('AUTH_DB'),
      bucket = await mf.getR2Bucket('BLOBS'),
      backups = await mf.getR2Bucket('BACKUPS'),
      service = (await mf.getBindings()).MIGRATION;
    for (const name of [
      '0001_better_auth.sql',
      '0002_directory.sql',
      '0003_snapshot_import.sql',
      '0004_account_commands.sql',
    ])
      for (const stmt of (await readFile('apps/cloudflare/migrations/auth/' + name, 'utf8'))
        .split(';')
        .filter((s) => s.trim()))
        await db.prepare(stmt).run();
    const call = async (path, body = {}) => {
      const r = await service.fetch('https://migration.internal' + path, {
        method: 'POST',
        body: JSON.stringify({ manifest_hash: hash, household_id: hh, ...body }),
      });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await call('/begin', { descriptor: plans[0].descriptor })).status, 409);
    const auth = new AuthSnapshotImporter(db);
    await auth.start(descriptor);
    for (let i = 0; i < chunks.length; i++) await auth.append(hash, i, chunks[i]);
    await auth.finish(hash);
    assert.equal((await call('/begin', { descriptor: plans[0].descriptor })).status, 200);
    for (const chunk of plans[0].chunks) {
      const r = await call('/part', chunk);
      assert.equal(r.status, 200, JSON.stringify(r));
    }
    assert.equal((await call('/finish')).status, 200);
    assert.equal((await call('/activate')).status, 409);
    assert.equal((await call('/verify-blobs')).status, 409);
    await backups.put(
      `migrations/${hash}/manifest.json`,
      await readFile(join(output, 'manifest.json')),
    );
    await bucket.put(blobObjectKey(key), 'corrupt');
    assert.equal((await call('/verify-blobs')).status, 409);
    await bucket.delete(blobObjectKey(key));
    await new BlobSnapshotImporter(bucket).put(key, Uint8Array.from(bytes).buffer, {
      bytes: bytes.length,
      sha256: sha,
    });
    const verified = await call('/verify-blobs');
    assert.equal(verified.status, 200, JSON.stringify(verified));
    assert.equal(verified.data.data.verified, 1);
    const active = await call('/activate');
    assert.equal(active.status, 200, JSON.stringify(active));
    assert.equal(active.data.data.status, 'ACTIVE');
    assert.equal(
      (await db.prepare('SELECT state FROM household_directory WHERE id=?').bind(hh).first()).state,
      'ACTIVE',
    );
    assert.equal(await new AuthDirectory(db).principal('user'), null);
    assert.equal((await call('/activate')).status, 200);
  } finally {
    await mf.dispose();
  }
});
