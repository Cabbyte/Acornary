import { expect, it } from 'vitest';
import { summarizeTimings } from '../packages/contracts/src/timing.js';
import { beginCall, callTimingSamples } from '../apps/web/src/lib/timing.js';
it('groups first calls separately and reports missing server measurements honestly', () => {
  const base = {
    tool: 'create_items_batch',
    write: true,
    batch_size: 4,
    first_call: false,
    outcome: 'SUCCESS',
  };
  const summary = summarizeTimings([
    { ...base, duration_ms: 900, first_call: true },
    ...Array.from({ length: 100 }, (_, i) => ({
      ...base,
      duration_ms: i + 1,
      server_duration_ms: i / 2,
      outcome: i === 99 ? 'NETWORK' : 'SUCCESS',
    })),
  ]);
  expect(summary[0]).toMatchObject({
    samples: 1,
    first_call: true,
    server_ms: { samples: 0, p50: null, p95: null },
  });
  expect(summary[1]).toMatchObject({
    samples: 100,
    errors: 1,
    error_rate: 0.01,
    e2e_ms: { p50: 50, p95: 95 },
  });
});
it('records failed client calls without arguments, identity or credentials', () => {
  const timing = beginCall('MCP_UI', 'apply_inventory_command', {
    operation: 'create_items_batch',
    expected_scope: 'private',
    input: { items: [{ name: 'private' }] },
  });
  timing.finish('NETWORK');
  const sample = callTimingSamples().at(-1)!;
  expect(sample).toMatchObject({
    tool: 'create_items_batch',
    batch_size: 1,
    write: true,
    outcome: 'NETWORK',
  });
  expect(JSON.stringify(sample)).not.toContain('private');
});
