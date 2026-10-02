import { SelectionSync } from '../apps/web/src/plugin/selection.js';
import { describe, it, expect, vi } from 'vitest';
import { WidgetStore, type WidgetBridge } from '../apps/web/src/plugin/store.js';
import { pluginEnvelopeSchema } from '../packages/contracts/src/plugin.js';
import { draftSchema } from '../apps/web/src/lib/draft.js';
import { PluginClient } from '../apps/web/src/plugin/client.js';

describe('Plugin recovery boundaries', () => {
  it('requires confirmed host persistence and keeps private state out of model context', async () => {
    let saved: any;
    const bridge: WidgetBridge = {
      get widgetState() {
        return saved;
      },
      setWidgetState: (state) => {
        saved = structuredClone(state);
      },
    };
    const store = new WidgetStore(() => bridge, 'account:family');
    const pending = { attempt: { payload: { idempotency_key: 'original-key' } } };
    await store.set('account:family:draft:edit', pending);
    expect(saved.modelContent).toBeNull();
    expect(
      await new WidgetStore(() => bridge, 'account:family').get('account:family:draft:edit'),
    ).toEqual(pending);
    expect(
      await new WidgetStore(() => bridge, 'different:family').get('different:family:draft:edit'),
    ).toBeUndefined();
    await expect(store.set('other:draft:edit', pending)).rejects.toThrow('账号或家庭');
    await expect(
      new WidgetStore(() => undefined, 'a').set('a:draft:edit', pending),
    ).rejects.toThrow('尚未发送');
    await expect(
      new WidgetStore(() => ({ setWidgetState() {} }), 'a').set('a:draft:edit', pending),
    ).rejects.toThrow('尚未发送');
  });
  it('serializes route/draft writes and preserves the exact pending and committed request', async () => {
    let state: unknown;
    const bridge = {
      get widgetState() {
        return state;
      },
      async setWidgetState(value: unknown) {
        await new Promise((r) => setTimeout(r, 2));
        state = value;
      },
    };
    const store = new WidgetStore(() => bridge, 's');
    await Promise.all([
      store.set('s:draft:edit', { key: 'k' }),
      store.rememberRoute('/items/item-a?dialog=rename'),
      store.set('s:draft:edit', { key: 'k', result: 'done' }),
    ]);
    const restored = new WidgetStore(() => bridge, 's');
    expect(restored.route).toBe('/items/item-a?dialog=rename');
    expect(await restored.get('s:draft:edit')).toEqual({ key: 'k', result: 'done' });
    await restored.set('s:draft:edit', undefined);
    expect(await new WidgetStore(() => bridge, 's').get('s:draft:edit')).toBeUndefined();
  });
  it('rejects malformed private drafts instead of silently minting a fresh retry key', () => {
    expect(
      draftSchema.safeParse({
        values: {},
        original: {},
        revisions: {},
        attempt: { operation: 'query_items', payload: {} },
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        values: {},
        original: {},
        revisions: {},
        attempt: { operation: 'create_items', payload: {} },
      }).success,
    ).toBe(false);
    expect(draftSchema.safeParse({ values: {}, original: {}, revisions: {} }).success).toBe(true);
  });
  it('rejects a host envelope whose selected household disagrees with the snapshot', () => {
    expect(
      pluginEnvelopeSchema.safeParse({
        version: 1,
        session: {
          mode: 'cloud',
          authenticated: true,
          cache_key: 'a',
          household_id: 'a',
          can_write: true,
          host: 'mcp',
        },
        snapshot: {
          household: { id: 'b', name: 'b' },
          container_catalog_id: '',
          catalog: [],
          items: [],
          notes: [],
          cached_at: 'now',
        },
      }).success,
    ).toBe(false);
  });
});

it.each(['success', 'authorization-error'])(
  'ignores a late %s even after the host switches back to the original identity',
  async (outcome) => {
    const envelope = (family: string) => ({
      version: 1,
      session: {
        mode: 'local',
        authenticated: true,
        host: 'mcp',
        household_id: family,
        cache_key: family,
        can_write: true,
      },
      snapshot: {
        household: { id: family, name: family },
        container_catalog_id: '',
        catalog: [],
        items: [],
        notes: [],
        cached_at: '2026-10-01',
      },
    });
    const client = new PluginClient();
    let family = 'A';
    const parse = () => pluginEnvelopeSchema.parse(envelope(family));
    client.envelope = parse();
    let release!: (value: any) => void;
    const pending = new Promise<any>((resolve) => {
      release = resolve;
    });
    vi.spyOn(client.app, 'callServerTool').mockImplementation(async ({ name }) =>
      name === 'get_inventory_view'
        ? { content: [], _meta: { 'acornary/view': envelope(family) } }
        : pending,
    );
    const expired = vi.fn();
    client.onExpired = expired;
    // No cancellation signal: generation isolation must work independently.
    const oldRead = client.read('get_history', {});
    const rejected = expect(oldRead).rejects.toMatchObject({ name: 'AbortError' });
    for (const next of ['B', 'A']) {
      family = next;
      await expect(client.snapshot()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await client.snapshot(); // consume the new instance's initial snapshot
    }
    const select = vi.spyOn(client, 'select');
    release(
      outcome === 'success'
        ? { content: [], structuredContent: { data: ['obsolete-private-history'] } }
        : { content: [], isError: true, structuredContent: { error: { code: 'UNAUTHORIZED' } } },
    );
    await rejected;
    expect(expired).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(client.envelope?.session.household_id).toBe('A');
  },
);

it('retries failed context clears and coalesces queued selections to the latest family', async () => {
  vi.useFakeTimers();
  const selected = { kind: 'ITEM' as const, id: 'old', revision: 1, name: 'old', location: '' };
  const calls: unknown[] = [];
  let failClear = true;
  const sync = new SelectionSync(async (value) => {
    calls.push(value);
    if (value === null && failClear) throw Error('temporary');
  });
  sync.select(selected);
  sync.activate();
  await vi.advanceTimersByTimeAsync(1);
  sync.select({ ...selected, id: 'queued-old-family' });
  sync.select(null);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual([selected, null]);
  failClear = false;
  await vi.advanceTimersByTimeAsync(300);
  expect(calls).toEqual([selected, null, null]);
  sync.select(null);
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toHaveLength(3);
  sync.dispose();
  vi.useRealTimers();
});
