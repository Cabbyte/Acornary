// Creates isolated benchmark fixtures only. Refuses a non-test database.
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Client as McpClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { buildApp } from '../apps/server/src/app.js';
import { createHousehold, initialize } from '../apps/server/src/initialize.js';
import { pool, transaction } from '../apps/server/src/db.js';
import { execute } from '../apps/server/src/service.js';
import { summarizeTimings, type TimingSample } from '../packages/contracts/src/timing.js';
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/acornary_test')
)
  throw new Error('Use a disposable acornary_test database.');
process.env.LOG_LEVEL ??= 'error';
const count = Number(process.argv[2] ?? 100);
if (!Number.isInteger(count) || count < 2 || count > 1000)
  throw new Error('Sample count must be 2–1000.');
await initialize();
const ctx = { ...(await transaction((c) => createHousehold(c, '隔离性能验收'))), source: 'TEST' };
const token = randomUUID().replaceAll('-', '').repeat(2);
const app = await buildApp(ctx, token, false);
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const client = new McpClient({ name: 'intake-benchmark', version: '1' });
const samples: TimingSample[] = [];
const intakeRuns: TimingSample[] = [];
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${address}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const sku = await execute(ctx, 'create_catalog_node', {
    kind: 'SKU',
    name: '测量用梅花肉',
    idempotency_key: randomUUID(),
  });
  const catalog_node_id = sku.affected_objects[0].id;
  for (const tool of ['get_connection_context', 'create_items', 'create_items_batch'] as const) {
    // The old path uses four complete requests; the new path uses one batch.
    // Both store exactly the same four package facts.
    for (let i = 0; i < count; i++) {
      const entries = ['425', '495', '245', '520'].map((value, n) => ({
        client_ref: `pack-${n}`,
        catalog_node_id,
        initial_attributes: [
          {
            template_id: 'contents',
            template_version: 1,
            values: { remaining: { value, unit: 'g' } },
          },
          {
            template_id: 'lifecycle',
            template_version: 1,
            values: {
              acquisition: { acquired_on: '2026-10-11' },
              expiry: { date: '2027-10-11', date_kind: 'ESTIMATED' },
            },
          },
        ],
      }));
      const requests =
        tool === 'create_items'
          ? entries.map(({ client_ref: _, ...entry }) => ({
              ...entry,
              count: 1,
              idempotency_key: randomUUID(),
            }))
          : [
              tool === 'create_items_batch'
                ? { items: entries, idempotency_key: randomUUID() }
                : {},
            ];
      const firstSample = samples.length;
      for (const [j, args] of requests.entries()) {
        const started = performance.now();
        try {
          const result = await client.callTool({ name: tool, arguments: args });
          const trace = result._meta?.['acornary/trace'] as
            { request_id?: string; server_duration_ms?: number } | undefined;
          samples.push({
            transport: 'MCP_LOOPBACK',
            tool,
            write: tool !== 'get_connection_context',
            batch_size: tool === 'create_items_batch' ? 4 : 1,
            first_call: i === 0 && j === 0,
            duration_ms: performance.now() - started,
            outcome: result.isError
              ? ((result.structuredContent as any)?.error?.code ?? 'ERROR')
              : 'SUCCESS',
            ...trace,
          });
        } catch {
          samples.push({
            transport: 'MCP_LOOPBACK',
            tool,
            write: tool !== 'get_connection_context',
            batch_size: tool === 'create_items_batch' ? 4 : 1,
            first_call: i === 0 && j === 0,
            duration_ms: performance.now() - started,
            outcome: 'TRANSPORT_ERROR',
          });
        }
      }
      if (tool !== 'get_connection_context') {
        const group = samples.slice(firstSample);
        intakeRuns.push({
          transport: 'MCP_LOOPBACK',
          tool,
          write: true,
          batch_size: 4,
          first_call: i === 0,
          duration_ms: group.reduce((sum, s) => sum + s.duration_ms, 0),
          server_duration_ms: group.every((s) => s.server_duration_ms !== undefined)
            ? group.reduce((sum, s) => sum + s.server_duration_ms!, 0)
            : undefined,
          outcome: group.every((s) => s.outcome === 'SUCCESS') ? 'SUCCESS' : 'ERROR',
        });
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        environment: 'isolated loopback MCP; not hosted connector latency',
        node: process.version,
        generated_at: new Date().toISOString(),
        first_call: 'First call of each tool in this process; not proof of a platform cold start.',
        household_id: ctx.household_id,
        summary: summarizeTimings(samples),
        four_pack_intakes: summarizeTimings(intakeRuns),
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await app.close();
  await pool.end();
}
