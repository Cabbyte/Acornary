import { describe, expect, it } from 'vitest';
import { pluginEnvelopeSchema } from '../packages/contracts/src/plugin.js';

const envelope = (snapshot: Record<string, unknown>) => ({
  version: 1,
  session: {
    mode: 'local',
    authenticated: true,
    cache_key: 'local:test',
    household_id: 'household_11111111-1111-4111-8111-111111111111',
    can_write: true,
    host: 'mcp',
  },
  snapshot,
});

describe('plugin envelope v2 compatibility', () => {
  it('accepts a v2-shaped snapshot without notes/container and keeps server groups', () => {
    const parsed = pluginEnvelopeSchema.safeParse(
      envelope({
        protocol: 2,
        household: {
          id: 'household_11111111-1111-4111-8111-111111111111',
          name: '家',
          timezone: 'Asia/Shanghai',
        },
        as_of_change_id: '1',
        server_time: '2026-10-31T12:00:00Z',
        catalog: [],
        items: [],
        groups: [],
        cached_at: '2026-10-31T12:00:00Z',
      }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.snapshot.notes).toEqual([]);
    expect(parsed.data.snapshot.container_catalog_id).toBe('');
    expect(parsed.data.snapshot.groups).toEqual([]);
  });

  it('preserves unknown template ids instead of rejecting the envelope', () => {
    const parsed = pluginEnvelopeSchema.safeParse(
      envelope({
        household: {
          id: 'household_11111111-1111-4111-8111-111111111111',
          name: '家',
          timezone: 'Asia/Shanghai',
        },
        container_catalog_id: 'catalog_node_11111111-1111-4111-8111-111111111111',
        catalog: [],
        items: [],
        notes: [],
        cached_at: '2026-10-31T12:00:00Z',
      }),
    );
    expect(parsed.success).toBe(true);
  });
});
