// First credential only, for an explicitly selected imported preview identity. No password reset.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { hashPassword } from 'better-auth/crypto';
const { values: v } = parseArgs({
  options: {
    config: { type: 'string' },
    user: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
  },
});
if (!v.config || !v.user || v.remote === Boolean(v['local-state']))
  throw new Error(
    'Explicit preview config, --user ID and exactly one of --remote or --local-state are required',
  );
const c = JSON.parse(await readFile(resolve(v.config), 'utf8'));
if (
  c.name !== 'acornary-cf-preview' ||
  c.vars?.ORIGIN !== 'https://cf.acornary.protium.top' ||
  c.vars?.ENVIRONMENT !== 'preview'
)
  throw new Error('Preview origin and environment required');
const temp = await mkdtemp(join(tmpdir(), 'acornary-preview-identity-'));
let proxy;
try {
  const config = join(temp, 'wrangler.json');
  await writeFile(
    config,
    JSON.stringify({
      name: 'acornary-preview-identity',
      account_id: c.account_id,
      compatibility_date: c.compatibility_date,
      d1_databases: c.d1_databases.map((d) => ({ ...d, remote: v.remote })),
    }),
  );
  proxy = await getPlatformProxy({
    configPath: config,
    envFiles: [],
    remoteBindings: v.remote,
    persist: v.remote ? false : { path: resolve(v['local-state']) },
  });
  const db = proxy.env.AUTH_DB,
    user = await db
      .prepare('SELECT id,email,emailVerified,enabled,auth_version FROM user WHERE id=?')
      .bind(v.user)
      .first();
  if (!user || user.enabled !== 1 || user.emailVerified !== 1)
    throw new Error('Existing enabled, verified preview identity required');
  const root = resolve('.local/cf-preview-credentials');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const scope = createHash('sha256')
      .update(
        JSON.stringify([c.d1_databases[0].database_id, v.remote, v['local-state'] ?? '', v.user]),
      )
      .digest('hex'),
    path = join(root, scope + '.json');
  let record;
  try {
    record = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (
      await db
        .prepare(
          "SELECT 1 FROM account WHERE userId=? AND providerId='credential' UNION ALL SELECT 1 FROM passkey WHERE userId=? LIMIT 1",
        )
        .bind(v.user, v.user)
        .first()
    )
      throw new Error('Identity already has credentials; this tool cannot reset them');
    const password = randomBytes(24).toString('base64url');
    record = {
      origin: c.vars.ORIGIN,
      user: v.user,
      email: user.email,
      password,
      hash: await hashPassword(password),
      credential: crypto.randomUUID(),
      mutation: crypto.randomUUID(),
      version: user.auth_version,
    };
    try {
      await writeFile(path, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      record = JSON.parse(await readFile(path, 'utf8'));
    }
  }
  if (record.user !== v.user || record.origin !== c.vars.ORIGIN)
    throw new Error('Credential plan differs');
  const old = await db
    .prepare('SELECT userId,password FROM account WHERE id=?')
    .bind(record.credential)
    .first();
  if (old) {
    if (old.userId !== v.user || old.password !== record.hash)
      throw new Error('Credential receipt differs');
  } else {
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "INSERT INTO cf_auth_mutations(id,user_id,kind,authorized,created_at) VALUES(?,?,'PREVIEW_INITIALIZE',CASE WHEN EXISTS(SELECT 1 FROM user WHERE id=? AND enabled=1 AND auth_version=?) AND NOT EXISTS(SELECT 1 FROM account WHERE userId=? AND providerId='credential') AND NOT EXISTS(SELECT 1 FROM passkey WHERE userId=?) THEN 1 ELSE 0 END,?)",
        )
        .bind(record.mutation, v.user, v.user, record.version, v.user, v.user, now),
      db
        .prepare(
          "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)",
        )
        .bind(record.credential, v.user, v.user, record.hash, now, now),
      db
        .prepare('UPDATE user SET auth_version=auth_version+1,updatedAt=? WHERE id=?')
        .bind(now, v.user),
    ]);
  }
  console.log(JSON.stringify({ initialized: true, user_id: v.user, credentials_file: path }));
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
