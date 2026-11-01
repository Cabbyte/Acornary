// Disposable mock host only. This is never compiled into or mounted by the product server.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { initialize, createHousehold } from '../apps/server/src/initialize.js';
import { transaction } from '../apps/server/src/db.js';
import { buildApp } from '../apps/server/src/app.js';
if (!process.env.DATABASE_URL?.match(/\/acornary_e2e_\d+$/))
  throw new Error('Disposable E2E database required');
const first = await initialize();
const second = await transaction((c) => createHousehold(c, '隔离的第二家庭'));
const clients: Client[] = [];
for (const installation of [first, second]) {
  const token = randomBytes(32).toString('hex');
  const server = await buildApp({ ...installation, source: 'PLUGIN_E2E' }, token, false, {
    mode: 'local',
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  const client = new Client({ name: 'isolated-mock-host', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  clients.push(client);
}
createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/rpc') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const { method, params, family = 0 } = JSON.parse(Buffer.concat(chunks).toString());
      const client = clients[family === 1 ? 1 : 0];
      const result =
        method === 'tools/call'
          ? await client.callTool(params)
          : method === 'resources/read'
            ? await client.readResource(params)
            : await client.listTools();
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }
    const file = req.url === '/host.js' ? 'plugin-host.js' : 'plugin-host.html';
    res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(await readFile(`tests/fixtures/${file}`, 'utf8'));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  }
}).listen(3212, '127.0.0.1');
