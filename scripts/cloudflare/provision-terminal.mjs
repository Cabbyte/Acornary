import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPlatformProxy } from 'wrangler';
const { values: v } = parseArgs({
  options: {
    config: { type: 'string' },
    remote: { type: 'boolean', default: false },
    'local-state': { type: 'string' },
  },
});
if (!v.config || v.remote === Boolean(v['local-state']))
  throw new Error('Explicit config and exactly one of --remote or --local-state required');
const c = JSON.parse(await readFile(resolve(v.config), 'utf8')),
  origin = c.vars?.ORIGIN,
  id = c.vars?.TERMINAL_CLIENT_ID;
if (
  c.name !== 'acornary-cf-preview' ||
  origin !== 'https://cf.acornary.protium.top' ||
  id !== 'acornary-cf-preview-android-v1'
)
  throw new Error('This command provisions the isolated preview Android client only');
const temp = await mkdtemp(join(tmpdir(), 'acornary-terminal-'));
let proxy;
try {
  const path = join(temp, 'wrangler.json');
  await writeFile(
    path,
    JSON.stringify({
      name: 'acornary-terminal-operator',
      account_id: c.account_id,
      compatibility_date: c.compatibility_date,
      d1_databases: c.d1_databases.map((d) => ({ ...d, remote: v.remote })),
    }),
  );
  proxy = await getPlatformProxy({
    configPath: path,
    envFiles: [],
    remoteBindings: v.remote,
    persist: v.remote ? false : { path: resolve(v['local-state']) },
  });
  const db = proxy.env.AUTH_DB,
    now = new Date().toISOString(),
    scopes = JSON.stringify(['openid', 'offline_access', 'inventory:read', 'inventory:write']),
    resource = origin + '/api/terminal/v1',
    redirect = origin + '/android/oauth/callback';
  const old = await db
    .prepare(
      'SELECT redirectUris,tokenEndpointAuthMethod,requirePKCE FROM oauthClient WHERE clientId=?',
    )
    .bind(id)
    .first();
  if (
    old &&
    (old.redirectUris !== JSON.stringify([redirect]) ||
      old.tokenEndpointAuthMethod !== 'none' ||
      old.requirePKCE !== 1)
  )
    throw new Error('Existing terminal client differs; refusing to overwrite');
  await db.batch([
    db
      .prepare(
        "INSERT INTO oauthClient(id,clientId,disabled,skipConsent,scopes,createdAt,updatedAt,name,redirectUris,tokenEndpointAuthMethod,applicationType,grantTypes,responseTypes,requirePKCE) VALUES(?1,?1,0,0,?2,?3,?3,'Acornary CF Preview Android',?4,'none','native',?5,?6,1) ON CONFLICT(clientId) DO NOTHING",
      )
      .bind(
        id,
        scopes,
        now,
        JSON.stringify([redirect]),
        JSON.stringify(['authorization_code', 'refresh_token']),
        JSON.stringify(['code']),
      ),
    db
      .prepare(
        "INSERT INTO oauthResource(id,identifier,name,accessTokenTtl,refreshTokenTtl,allowedScopes,disabled,createdAt,updatedAt,policyVersion) VALUES(?1,?2,'Acornary CF Preview Android',300,2592000,?3,0,?4,?4,1) ON CONFLICT(identifier) DO NOTHING",
      )
      .bind(crypto.randomUUID(), resource, scopes, now),
    db
      .prepare(
        'INSERT INTO oauthClientResource(id,clientId,resourceId,createdAt) VALUES(?,?,?,?) ON CONFLICT(clientId,resourceId) DO NOTHING',
      )
      .bind(crypto.randomUUID(), id, resource, now),
  ]);
  console.log(JSON.stringify({ client_id: id, resource, redirect_uri: redirect, pkce: 'S256' }));
} finally {
  await proxy?.dispose();
  await rm(temp, { recursive: true, force: true });
}
