import { describe, expect, it, vi } from 'vitest';
import {
  createManagementExportSession,
  runManagementExportStep,
  recoverManagementExportStep,
  type ManagementExportPort,
  type ManagementExportRecord,
} from '../../apps/web/src/app-vnext/management-export';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope';
import type { OperationStorage } from '../../apps/web/src/app-vnext/platform';
import type { ExportMetadata } from '../../packages/contracts/src/export';
const scope: ApplicationScope = {
  environment: 'test',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web',
  datasetId: 'd',
  generation: 1,
};
const selection = {
  kind: 'ITEM' as const,
  query: { include_void: true },
  include_sensitive: false,
};
const metadata: ExportMetadata = {
  export_id: 'export_00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  query_hash: 'a'.repeat(64),
  disclosure_mode: 'REDACTED',
  matching_count: 3,
  as_of_change_id: '42',
  summary: {},
  expires_at: '2026-11-12T00:00:00Z',
};
function setup(storageOverride?: OperationStorage) {
  let saved: unknown;
  const storage = storageOverride || {
    load: () => saved,
    save: (_s: ApplicationScope, _k: string, value: unknown) => {
      saved = structuredClone(value);
    },
  };
  const create = () =>
    createManagementExportSession(
      scope,
      'export-task',
      selection,
      'frozen selection',
      storage,
      () => scope,
    );
  const port: ManagementExportPort = {
    begin: vi.fn(async () => structuredClone(metadata)),
    read: vi.fn(async (_scope, input) => ({
      ...metadata,
      data: input.cursor ? [{ id: '3' }] : [{ id: '1' }, { id: '2' }],
      next_cursor: input.cursor ? null : 'opaque-signed-server-cursor',
    })),
    cancel: vi.fn(async (_scope, input) => ({ export_id: input.export_id, cancelled: true })),
  };
  return { create, session: create(), port, saved: () => saved as ManagementExportRecord };
}
describe('root frozen export protocol', () => {
  it.each([
    'state',
    'scope',
    'attempt',
    'attemptStatus',
    'rows',
    'cursor',
    'complete',
    'cancelled',
  ])('preserves malformed saved %s without sending a fresh begin', async (field) => {
    const { session, port, saved } = setup();
    await runManagementExportStep(session, 'begin', port);
    const record = structuredClone(saved());
    if (field === 'state') (record as unknown as { state: string }).state = 'unrecognized';
    if (field === 'scope') (record.scope as unknown as { accountId: null }).accountId = null;
    if (field === 'attempt') record.attempt = null;
    if (field === 'attemptStatus')
      (record as unknown as { attemptStatus: string }).attemptStatus = 'lost';
    if (field === 'rows') (record.result as unknown as { rows: string }).rows = 'not an array';
    if (field === 'cursor') (record.result as unknown as { nextCursor: number }).nextCursor = 42;
    if (field === 'complete') (record.result as unknown as { complete: string }).complete = 'yes';
    if (field === 'cancelled')
      (record.result as unknown as { cancelled: string }).cancelled = 'yes';
    const save = vi.fn();
    const restored = createManagementExportSession(
      scope,
      'export-task',
      selection,
      'frozen selection',
      { load: () => record, save },
      () => scope,
    );
    const begin = vi.fn(async () => structuredClone(metadata));
    const guarded = { ...port, begin };
    await runManagementExportStep(restored, 'begin', guarded);
    expect(restored.getSnapshot().state).toBe('validationError');
    expect(begin).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it.each(['summary', 'null-row', 'string-row', 'oversized-cursor'])(
    'rejects invalid live %s before exposing a download',
    async (kind) => {
      const { session, port } = setup();
      await runManagementExportStep(session, 'begin', port);
      port.read = vi.fn(async () => ({
        ...metadata,
        ...(kind === 'summary' ? { summary: [] as unknown as Record<string, unknown> } : {}),
        data:
          kind === 'null-row'
            ? ([null, {}, {}] as unknown as Record<string, unknown>[])
            : kind === 'string-row'
              ? (['row', {}, {}] as unknown as Record<string, unknown>[])
              : [{}, {}, {}],
        next_cursor: kind === 'oversized-cursor' ? 'x'.repeat(2049) : null,
      }));
      await runManagementExportStep(session, 'read', port);
      expect(session.getSnapshot().state).toBe('networkUnknown');
      expect(session.getSnapshot().result).toBeNull();
    },
  );
  it('does not report a released export when cancellation is not confirmed', async () => {
    const { session, port } = setup();
    await runManagementExportStep(session, 'begin', port);
    port.cancel = vi.fn(async (_scope, input) => ({
      export_id: input.export_id,
      cancelled: false,
    }));
    await runManagementExportStep(session, 'cancel', port);
    expect(session.getSnapshot().state).toBe('networkUnknown');
    expect(session.getSnapshot().draft.previous?.cancelled).toBe(false);
    expect(session.getSnapshot().result).toBeNull();
  });
  it('repeats the exact original scope and metadata across signed pages and reloads', async () => {
    const { session, port, create } = setup();
    await runManagementExportStep(session, 'begin', port);
    await runManagementExportStep(session, 'read', port);
    expect(session.getSnapshot().result?.complete).toBe(false);
    const restored = create();
    await runManagementExportStep(restored, 'read', port);
    expect(port.read).toHaveBeenLastCalledWith(scope, {
      ...selection,
      export_id: metadata.export_id,
      generation: metadata.generation,
      query_hash: metadata.query_hash,
      limit: 100,
      cursor: 'opaque-signed-server-cursor',
    });
    expect(restored.getSnapshot().result).toMatchObject({
      complete: true,
      rows: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    await runManagementExportStep(restored, 'cancel', port);
    expect(port.cancel).toHaveBeenCalledWith(scope, { export_id: metadata.export_id });
    expect(restored.getSnapshot().result?.cancelled).toBe(true);
  });
  it('keeps an uncertain page request and replays its original cursor without duplicating rows', async () => {
    const { session, port, create } = setup();
    await runManagementExportStep(session, 'begin', port);
    await runManagementExportStep(session, 'read', port);
    const actualRead = port.read;
    port.read = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(Error('lost'), { code: 'NETWORK' }))
      .mockImplementation(actualRead);
    await runManagementExportStep(session, 'read', port);
    expect(session.getSnapshot().state).toBe('networkUnknown');
    const restored = create();
    await recoverManagementExportStep(restored, port);
    expect(restored.getSnapshot().result?.rows.map((row) => row.id)).toEqual(['1', '2', '3']);
    expect(port.read).toHaveBeenCalledTimes(2);
  });
  it('does not claim recovery capability for an unknown begin response', async () => {
    const { session, port } = setup();
    port.begin = vi.fn(async () => {
      throw Object.assign(Error('lost handle'), { code: 'NETWORK' });
    });
    await runManagementExportStep(session, 'begin', port);
    await recoverManagementExportStep(session, port);
    expect(port.begin).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().state).toBe('networkUnknown');
    expect(session.getSnapshot().error).toContain('协议没有原请求查询入口');
  });
  it('sends no begin/read request if durable task storage fails', async () => {
    const { session, port } = setup({
      load: () => null,
      save: () => {
        throw Error('quota');
      },
    });
    await runManagementExportStep(session, 'begin', port);
    expect(port.begin).not.toHaveBeenCalled();
    expect(port.read).not.toHaveBeenCalled();
  });
  it.each(['generation', 'query_hash', 'disclosure_mode', 'matching_count'])(
    'rejects changed page %s without presenting a complete export',
    async (field) => {
      const { session, port } = setup();
      await runManagementExportStep(session, 'begin', port);
      port.read = vi.fn(async () => ({
        ...metadata,
        [field]:
          field === 'matching_count'
            ? 1
            : field === 'disclosure_mode'
              ? 'SENSITIVE'
              : 'b'.repeat(64),
        data: [{ id: 'wrong scope' }],
        next_cursor: null,
      }));
      await runManagementExportStep(session, 'read', port);
      expect(session.getSnapshot().state).toBe('networkUnknown');
      expect(session.getSnapshot().result).toBeNull();
      expect(session.getSnapshot().draft.previous?.rows).toEqual([]);
    },
  );
  it('rejects truncated terminal pages even if their freeze metadata matches', async () => {
    const { session, port } = setup();
    await runManagementExportStep(session, 'begin', port);
    port.read = vi.fn(async () => ({ ...metadata, data: [{ id: '1' }], next_cursor: null }));
    await runManagementExportStep(session, 'read', port);
    expect(session.getSnapshot().state).toBe('networkUnknown');
    expect(session.getSnapshot().error).toContain('总数不一致');
  });
});
