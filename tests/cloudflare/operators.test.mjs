import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { verifyPassword } from 'better-auth/crypto';
const exec = promisify(execFile);
test('preview credential and terminal operators resume safely and reject existing credentials or another origin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acornary-operators-')),
    config = join(root, 'wrangler.json'),
    state = join(root, 'state');
  const c = {
    name: 'acornary-cf-preview',
    compatibility_date: '2026-11-05',
    d1_databases: [
      { binding: 'AUTH_DB', database_name: 'isolated-operators', database_id: crypto.randomUUID() },
    ],
    vars: {
      ORIGIN: 'https://cf.acornary.protium.top',
      ENVIRONMENT: 'preview',
      TERMINAL_CLIENT_ID: 'acornary-cf-preview-android-v1',
    },
  };
  await writeFile(config, JSON.stringify(c));
  const proxy = await getPlatformProxy({
    configPath: config,
    envFiles: [],
    remoteBindings: false,
    persist: { path: state },
  });
  let credentials;
  try {
    const db = proxy.env.AUTH_DB;
    for (const file of (await readdir('apps/cloudflare/migrations/auth')).sort())
      for (const sql of (await readFile('apps/cloudflare/migrations/auth/' + file, 'utf8'))
        .split(';')
        .filter((s) => s.trim()))
        await db.prepare(sql).run();
    const user = crypto.randomUUID(),
      now = new Date().toISOString();
    await db
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?,?,?,1,?,?,1,0)',
      )
      .bind(user, 'Isolated preview operator', user + '@example.invalid', now, now)
      .run();
    const run = (script, args = []) =>
      exec(process.execPath, [
        'scripts/cloudflare/' + script,
        '--config',
        config,
        '--local-state',
        state,
        ...args,
      ]);
    const initialize = () => run('init-preview-account.mjs', ['--user', user]);
    const first = JSON.parse((await initialize()).stdout);
    credentials = first.credentials_file;
    assert.equal(JSON.parse((await initialize()).stdout).credentials_file, credentials);
    const secret = JSON.parse(await readFile(credentials, 'utf8'));
    const account = await db
      .prepare('SELECT password FROM account WHERE userId=?')
      .bind(user)
      .first();
    assert.ok(await verifyPassword({ hash: account.password, password: secret.password }));
    assert.equal(
      (await db.prepare('SELECT auth_version FROM user WHERE id=?').bind(user).first())
        .auth_version,
      1,
    );
    await rename(credentials, credentials + '.saved');
    try {
      await assert.rejects(initialize(), /already has credentials/);
    } finally {
      await rename(credentials + '.saved', credentials);
    }
    await db.prepare('UPDATE user SET enabled=0 WHERE id=?').bind(user).run();
    await assert.rejects(initialize(), /enabled, verified/);
    await run('provision-terminal.mjs');
    await run('provision-terminal.mjs');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM oauthClient').first()).n, 1);
    await db.prepare('UPDATE oauthClient SET requirePKCE=0').run();
    await assert.rejects(run('provision-terminal.mjs'), /refusing to overwrite/);
    c.vars.ORIGIN = 'https://acornary.protium.top';
    await writeFile(config, JSON.stringify(c));
    await assert.rejects(initialize(), /Preview origin/);
    await assert.rejects(run('provision-terminal.mjs'), /isolated preview/);
  } finally {
    await proxy.dispose();
    if (credentials) await rm(credentials, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
