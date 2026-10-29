import { randomUUID } from 'node:crypto';
import { runtimeConfig, type RuntimeConfig } from './config.js';
import { pool, query, transaction } from './db.js';
import { terminalCallback, terminalPrefix } from '../../../packages/contracts/src/terminal.js';

/** Trusted DB provisioning only; the public auth API retains its deny-all admin policy. */
export async function registerTerminalClient(config: RuntimeConfig | { mode: 'cloud'; origin: string } = runtimeConfig(), softwareId = 'top.protium.acornary') {
  if (config.mode !== 'cloud') throw new Error('Cloud configuration required.');
  const origin = new URL(config.origin);
  if (origin.protocol !== 'https:' || origin.origin !== config.origin) throw new Error('Exact HTTPS origin required.');
  return transaction(async (c) => {
    await query(c, "SELECT pg_advisory_xact_lock(hashtextextended('acornary:android-client',0))");
    const redirect = config.origin + terminalCallback, resource = config.origin + terminalPrefix;
    const existing = (await query(c, 'SELECT * FROM "oauthClient" WHERE "softwareId"=$1', [softwareId])).rows;
    if (existing.length > 1) throw new Error('Multiple Android clients: resolve explicitly before registration.');
    const prior = existing[0];
    if (prior && (prior.disabled || prior.clientSecret || prior.tokenEndpointAuthMethod !== 'none' || prior.requirePKCE !== true || prior.skipConsent || prior.applicationType !== 'native' || JSON.stringify(prior.grantTypes) !== JSON.stringify(['authorization_code','refresh_token']) || JSON.stringify(prior.redirectUris) !== JSON.stringify([redirect])))
      throw new Error('Existing Android client configuration does not match.');
    const clientId = prior?.clientId ?? 'acornary_android_' + randomUUID();
    if (!prior) await query(c, `INSERT INTO "oauthClient"
      (id,"clientId",disabled,"skipConsent",scopes,"createdAt","updatedAt",name,"softwareId","redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes","requirePKCE")
      VALUES($1,$2,false,false,$3::jsonb,now(),now(),'松仓 Android 终端',$4,$5::jsonb,'none','native',$6::jsonb,'["code"]'::jsonb,true)`,
      [randomUUID(), clientId, JSON.stringify(['openid','offline_access','inventory:read','inventory:write']), softwareId, JSON.stringify([redirect]), JSON.stringify(['authorization_code','refresh_token'])]);
    await query(c, `INSERT INTO "oauthResource" (id,identifier,name,"accessTokenTtl","refreshTokenTtl","allowedScopes",disabled,"createdAt","updatedAt","policyVersion")
      VALUES($1,$2,'Android terminal',300,2592000,$3::jsonb,false,now(),now(),1) ON CONFLICT(identifier) DO UPDATE SET "allowedScopes"=excluded."allowedScopes","updatedAt"=now()`,
      [randomUUID(), resource, JSON.stringify(['openid','offline_access','inventory:read','inventory:write'])]);
    await query(c, `INSERT INTO "oauthClientResource" (id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT("clientId","resourceId") DO NOTHING`, [randomUUID(), clientId, resource]);
    return clientId;
  });
}
if (process.argv[1]?.endsWith('/register-terminal.js') || process.argv[1]?.endsWith('/register-terminal.ts')) {
  const origin = process.argv.find((v) => v.startsWith('--origin='))?.slice('--origin='.length);
  try { console.log('ACORNARY_TERMINAL_CLIENT_ID=' + await registerTerminalClient(origin ? { mode: 'cloud', origin } : runtimeConfig())); }
  finally { await pool.end(); }
}
