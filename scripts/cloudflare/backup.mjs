// Explicit operator CLI; all mutations use the account-authorized private Worker service binding.
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlatformProxy } from 'wrangler';
import { createHash } from 'node:crypto';
const { values: v } = parseArgs({
  options: {
    config: { type: 'string' },
    action: { type: 'string' },
    id: { type: 'string' },
    'expected-sha256': { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
    pin: { type: 'boolean', default: false },
    wait: { type: 'boolean', default: false },
  },
});
if (
  !v.config ||
  !['start', 'status', 'resume', 'restore', 'pin'].includes(v.action) ||
  v.remote === Boolean(v['local-state'])
)
  throw new Error(
    'Required: --config JSON --action start|status|resume|restore|pin and exactly one of --remote or --local-state PATH. Restore also requires --id UUID --expected-sha256 HASH.',
  );
const c = JSON.parse(await readFile(resolve(v.config), 'utf8'));
if (!c.name?.startsWith('acornary-cf-') || !c.r2_buckets?.find((b) => b.binding === 'BACKUPS'))
  throw new Error('Explicit Cloudflare application config required');
const temp = await mkdtemp(join(tmpdir(), 'acornary-backup-'));
let proxy;
try {
  const path = join(temp, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify({
      name: 'acornary-backup-operator',
      account_id: c.account_id,
      compatibility_date: c.compatibility_date,
      services: [
        { binding: 'BACKUP', service: c.name, entrypoint: 'BackupEntrypoint', remote: v.remote },
      ],
      r2_buckets: [{ ...c.r2_buckets.find((b) => b.binding === 'BACKUPS'), remote: v.remote }],
    }),
    { mode: 0o600 },
  );
  proxy = await getPlatformProxy({
    configPath: path,
    envFiles: [],
    remoteBindings: v.remote,
    persist: v.remote ? false : { path: resolve(v['local-state']) },
  });
  const call = async (path, body) => {
    const r = await proxy.env.BACKUP.fetch('https://operator.internal' + path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('Private backup operation failed: ' + path);
    return (await r.json()).data;
  };
  let id = v.id;
  if (v.action === 'start') {
    id ??= crypto.randomUUID();
    console.log(JSON.stringify(await call('/start', { id })));
    if (v.pin) await call('/pin', { id, pinned: true });
  } else if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Explicit backup UUID required');
  if (v.action === 'resume') await call('/resume', { id });
  if (v.action === 'pin') console.log(JSON.stringify(await call('/pin', { id, pinned: v.pin })));
  if (v.action === 'restore') {
    const hash = v['expected-sha256'];
    if (!/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error('Expected root SHA-256 required');
    const object = await proxy.env.BACKUPS.get(`backups/${id}/manifest.json`);
    if (!object || object.size > 8 * 1024 * 1024) throw new Error('Backup manifest missing');
    const body = await object.text();
    if (createHash('sha256').update(body).digest('hex') !== hash)
      throw new Error('Root manifest differs');
    const manifest = JSON.parse(body),
      started = Date.now();
    await call('/restore/begin', { id, sha256: hash });
    while (!(await call('/restore/auth', { id, sha256: hash })).complete) {}
    for (const h of manifest.households) {
      while (
        !(await call('/restore/household', { id, sha256: hash, household_id: h.id })).complete
      ) {}
      console.log(JSON.stringify({ restored_household: h.id }));
    }
    console.log(
      JSON.stringify({
        ...(await call('/restore/finish', { id, sha256: hash })),
        restore_seconds: (Date.now() - started) / 1000,
      }),
    );
  } else if (v.action === 'status' || v.wait) {
    const started = Date.now();
    do {
      const status = await call('/status', { id });
      console.log(JSON.stringify(status));
      if (!v.wait || status?.status === 'COMPLETE') break;
      if (Date.now() - started > 15 * 60 * 1000)
        throw new Error('Backup still pending; resume using its recorded UUID');
      await new Promise((r) => setTimeout(r, 5000));
    } while (true);
  }
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
