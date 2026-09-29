import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { initialize } from '../apps/server/src/initialize.js';
import { manageOwner } from '../apps/server/src/owner.js';
import { pool, query } from '../apps/server/src/db.js';
import { buildApp } from '../apps/server/src/app.js';
if (!process.env.DATABASE_URL?.match(/\/acornary_e2e_\d+$/))
  throw new Error('Isolated E2E database required.');
const ctx = { ...(await initialize()), source: 'E2E' };
await manageOwner('create', 'browser@example.test', 'Browser-test-password-123!');
// Pre-registered public fixture client in the isolated database only. The server
// and browser exercise the real provider; CIMD transport is covered in cloud-auth.
await query(
  pool,
  `INSERT INTO "oauthClient"
  (id,"clientId",name,"redirectUris","tokenEndpointAuthMethod","grantTypes","responseTypes",scopes,"requirePKCE")
  VALUES ('browser-client','browser-client','Browser acceptance client',$1,'none',$2,$3,$4,true)
  ON CONFLICT (id) DO NOTHING`,
  [
    JSON.stringify(['http://127.0.0.1:45219/callback']),
    JSON.stringify(['authorization_code', 'refresh_token']),
    JSON.stringify(['code']),
    JSON.stringify(['openid', 'offline_access', 'inventory:read', 'inventory:write']),
  ],
);
await query(
  pool,
  `INSERT INTO "oauthResource" (id,identifier,name,"allowedScopes")
  VALUES ('browser-resource','https://127.0.0.1:3210/mcp','Browser fixture','["openid","offline_access","inventory:read","inventory:write"]')
  ON CONFLICT (identifier) DO NOTHING`,
);
await query(
  pool,
  `INSERT INTO "oauthClientResource" (id,"clientId","resourceId")
  VALUES ('browser-link','browser-client','https://127.0.0.1:3210/mcp') ON CONFLICT (id) DO NOTHING`,
);
const app = await buildApp(ctx, '', true, {
  mode: 'cloud',
  origin: 'https://127.0.0.1:3210',
  resource: 'https://127.0.0.1:3210/mcp',
  trustedProxy: '127.0.0.1',
  secret: 'isolated-browser-only-secret-at-least-32-characters',
});
await app.listen({ host: '127.0.0.1', port: 3211 });
createServer(
  {
    key: readFileSync(`${process.env.ACORNARY_TEST_TLS_DIR ?? '/tls'}/key.pem`),
    cert: readFileSync(`${process.env.ACORNARY_TEST_TLS_DIR ?? '/tls'}/cert.pem`),
  },
  (req, res) => {
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: 3211,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: '127.0.0.1:3210',
          'x-forwarded-proto': 'https',
          'x-real-ip': '127.0.0.1',
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 500, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(upstream);
  },
).listen(3210, '0.0.0.0');
