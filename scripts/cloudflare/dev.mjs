// Local-only native development. This command cannot select remote resources or a public route.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { hashPassword } from 'better-auth/crypto';
const root = resolve('.local/cloudflare-dev'),
  exec = promisify(execFile);
await access('apps/web/dist/index.html').catch(() => {
  throw new Error('Run pnpm build before pnpm start');
});
await mkdir(root, { recursive: true, mode: 0o700 });
const config = JSON.parse(await readFile('apps/cloudflare/wrangler.preview.json', 'utf8'));
Object.assign(config, {
  name: 'acornary-cf-local',
  main: resolve('apps/cloudflare/src/worker.ts'),
  routes: [],
  triggers: { crons: [] },
  d1_databases: [
    {
      binding: 'AUTH_DB',
      database_name: 'acornary-cf-local',
      database_id: '00000000-0000-4000-8000-000000000001',
      migrations_dir: resolve('apps/cloudflare/migrations/auth'),
    },
  ],
  r2_buckets: [
    { binding: 'BLOBS', bucket_name: 'acornary-cf-local-blobs' },
    { binding: 'BACKUPS', bucket_name: 'acornary-cf-local-backups' },
  ],
  queues: {
    producers: [{ binding: 'JOBS', queue: 'acornary-cf-local-jobs' }],
    consumers: [{ queue: 'acornary-cf-local-jobs', max_batch_size: 1 }],
  },
});
config.assets.directory = resolve('apps/web/dist');
config.vars = {
  ORIGIN: 'https://localhost:3210',
  ENVIRONMENT: 'test',
  RELEASE_VERSION: 'local-native',
  RELEASE_COMMIT: 'development',
};
const path = root + '/wrangler.json';
await writeFile(path, JSON.stringify(config, null, 2));
try {
  await access(root + '/.dev.vars');
} catch {
  await writeFile(
    root + '/.dev.vars',
    'AUTH_SECRET=' + randomBytes(48).toString('base64url') + '\n',
    { mode: 0o600 },
  );
}
await exec(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    'AUTH_DB',
    '--local',
    '--persist-to',
    root + '/state',
    '--config',
    path,
  ],
  { env: { ...process.env, CI: 'true' } },
);
let fixture;
try {
  fixture = JSON.parse(await readFile(root + '/credentials.json', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  fixture = {
    id: crypto.randomUUID(),
    email: 'developer@example.invalid',
    password: randomBytes(24).toString('base64url'),
  };
  await writeFile(root + '/credentials.json', JSON.stringify(fixture), { mode: 0o600 });
}
const identityConfig = root + '/identity.json';
await writeFile(
  identityConfig,
  JSON.stringify({
    name: 'acornary-cf-local-identity',
    compatibility_date: config.compatibility_date,
    d1_databases: config.d1_databases,
  }),
);
const proxy = await getPlatformProxy({
  configPath: identityConfig,
  envFiles: [],
  remoteBindings: false,
  persist: { path: root + '/state/v3' },
});
try {
  const db = proxy.env.AUTH_DB;
  if (!(await db.prepare('SELECT 1 FROM user WHERE id=?').bind(fixture.id).first())) {
    if (await db.prepare('SELECT 1 FROM user LIMIT 1').first())
      throw new Error(
        'Local database already has accounts; refusing to initialize another identity',
      );
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt,enabled,auth_version) VALUES(?,?,?,1,?,?,1,0)',
        )
        .bind(fixture.id, '本地开发', fixture.email, now, now),
      db
        .prepare(
          "INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,'credential',?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          fixture.id,
          fixture.id,
          await hashPassword(fixture.password),
          now,
          now,
        ),
    ]);
  }
} finally {
  await proxy.dispose();
}
console.log('Local native UI: https://localhost:3210');
console.log('Synthetic local login credentials: ' + root + '/credentials.json');
const child = spawn(
  'pnpm',
  [
    'exec',
    'wrangler',
    'dev',
    '--local',
    '--local-protocol',
    'https',
    '--port',
    '3210',
    '--persist-to',
    root + '/state',
    '--config',
    path,
  ],
  { stdio: 'inherit' },
);
const code = await new Promise((r) => child.on('exit', r));
process.exitCode = code ?? 1;
