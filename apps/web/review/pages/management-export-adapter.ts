// Local frozen snapshots exercise the typed export port. Fixture cursors are explicitly
// local tokens, not server signatures or evidence of production export capability.
import {
  exportSchemas,
  type BeginExport,
  type ReadExport,
  type ExportMetadata,
} from '../../../../packages/contracts/src/export';
import {
  createManagementExportSession,
  type ManagementExportPort,
  type ManagementExportRecord,
} from '../../src/app-vnext/management-export';
import { sameGeneration, scopeKey, type ApplicationScope } from '../../src/app-vnext/scope';
import type {
  ManagedCatalog,
  ManagedLocation,
  ManagementModel,
} from '../../src/features/management/pages/models';
import { getFixtureScope } from '../trial/application';
import { reviewStorage, flushReviewStorage } from '../trial/storage';
import { getReviewWorld } from './inventory-session';
import { readManagementState } from './management-storage';
interface FrozenFixture {
  scope: string;
  selection: BeginExport;
  metadata: ExportMetadata;
  rows: Record<string, unknown>[];
}
function active(scope: ApplicationScope) {
  if (!sameGeneration(scope, getFixtureScope()))
    throw Object.assign(Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' });
}
function load(scope: ApplicationScope, id: string): FrozenFixture {
  active(scope);
  const raw = reviewStorage.getItem(`management-export-snapshot:${id}`);
  const frozen = raw ? (JSON.parse(raw) as FrozenFixture) : null;
  if (
    !frozen ||
    frozen.scope !== scopeKey(scope) ||
    Date.parse(frozen.metadata.expires_at) <= Date.now()
  )
    throw Object.assign(Error('隔离冻结结果不存在或已到期，原任务保留。'), {
      code: 'CURSOR_STALE',
    });
  return frozen;
}
export const managementFixtureExportPort: ManagementExportPort = {
  async begin(scope, raw) {
    active(scope);
    const selection = exportSchemas.begin_export.parse(raw);
    if (selection.kind !== 'ITEM' || selection.include_sensitive)
      throw Error('隔离导出只提供当前物品样例的脱敏字段，不模拟未读取的目录或敏感原文。');
    const query = selection.query;
    const state = readManagementState<{
      catalogs: ManagedCatalog[];
      locations: ManagedLocation[];
    }>();
    const within = (id: string | null, root: string) => {
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        if (id === root) return true;
        seen.add(id);
        id = state?.locations.find((row) => row.id === id)?.parentId || null;
      }
      return false;
    };
    const skuWithin = (id: string, root: string) => {
      const seen = new Set<string>();
      let current: string | null = id;
      while (current && !seen.has(current)) {
        if (current === root) return true;
        seen.add(current);
        current = state?.catalogs.find((row) => row.id === current)?.parentId || null;
      }
      return false;
    };
    const rows = getReviewWorld()
      .items.filter(
        ({ item }) =>
          (query.include_void || item.recordState === 'VALID') &&
          (!query.search ||
            `${item.name} ${item.subtitle || ''} ${item.id}`.includes(String(query.search))) &&
          (!query.within_item_id || within(item.location.id, String(query.within_item_id))) &&
          (!query.catalog_subtree_id || skuWithin(item.skuId, String(query.catalog_subtree_id))) &&
          (!Array.isArray(query.catalog_node_ids) || query.catalog_node_ids.includes(item.skuId)),
      )
      .map((row) => structuredClone(row) as unknown as Record<string, unknown>);
    const direction =
      (query.sort as { direction?: string } | undefined)?.direction === 'desc' ? -1 : 1;
    rows.sort(
      (a, b) =>
        String((a.item as { name: string }).name).localeCompare(
          String((b.item as { name: string }).name),
          'zh-CN',
        ) * direction,
    );
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(selection)),
    );
    active(scope);
    const metadata: ExportMetadata = {
      export_id: `export_${crypto.randomUUID()}`,
      generation: crypto.randomUUID(),
      query_hash: Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join(''),
      disclosure_mode: 'REDACTED',
      as_of_change_id: `fixture:${Date.now()}`,
      matching_count: rows.length,
      summary: { fixture_only: true, matching_count: rows.length },
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    };
    reviewStorage.setItem(
      `management-export-snapshot:${metadata.export_id}`,
      JSON.stringify({
        scope: scopeKey(scope),
        selection,
        metadata,
        rows,
      } satisfies FrozenFixture),
    );
    await flushReviewStorage();
    active(scope);
    return metadata;
  },
  read: readManagementFixturePage,
  async cancel(scope, input) {
    active(scope);
    exportSchemas.cancel_export.parse(input);
    const key = `management-export-snapshot:${input.export_id}`;
    const raw = reviewStorage.getItem(key);
    if (raw && (JSON.parse(raw) as FrozenFixture).scope !== scopeKey(scope))
      throw Error('导出作用域不匹配。');
    if (raw) reviewStorage.removeItem(key);
    await flushReviewStorage();
    active(scope);
    return { export_id: input.export_id, cancelled: !!raw };
  },
};
async function readManagementFixturePage(scope: ApplicationScope, raw: ReadExport) {
  const input = exportSchemas.read_export.parse(raw);
  const frozen = load(scope, input.export_id);
  const selected = exportSchemas.begin_export.parse({
    kind: input.kind,
    query: input.query,
    include_sensitive: input.include_sensitive,
  });
  if (
    JSON.stringify(selected) !== JSON.stringify(frozen.selection) ||
    input.generation !== frozen.metadata.generation ||
    input.query_hash !== frozen.metadata.query_hash
  )
    throw Object.assign(Error('隔离导出范围或代次不匹配。'), { code: 'CURSOR_STALE' });
  const prefix = `fixture:${input.export_id}:`;
  if (
    input.cursor &&
    (!input.cursor.startsWith(prefix) || !/^\d+$/.test(input.cursor.slice(prefix.length)))
  )
    throw Object.assign(Error('隔离游标无效。'), { code: 'CURSOR_STALE' });
  const offset = input.cursor ? Number(input.cursor.slice(prefix.length)) : 0;
  if (!Number.isSafeInteger(offset) || offset > frozen.rows.length)
    throw Error('隔离游标超出范围。');
  const data = frozen.rows.slice(offset, offset + input.limit);
  return {
    ...frozen.metadata,
    data,
    next_cursor:
      offset + data.length < frozen.rows.length ? `${prefix}${offset + data.length}` : null,
  };
}
export function createManagementExportFixtureSession(
  taskId: string,
  selection: BeginExport,
  label: string,
) {
  return createManagementExportSession(
    getFixtureScope(),
    taskId,
    selection,
    label,
    {
      load(scope, key) {
        active(scope);
        const raw = reviewStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      },
      async save(scope, key, value) {
        active(scope);
        reviewStorage.setItem(key, JSON.stringify(value));
        await flushReviewStorage();
        active(scope);
      },
    },
    getFixtureScope,
  );
}
export function managementExportFixtureView(
  record: ManagementExportRecord | null,
): ManagementModel['export'] {
  if (!record) return null;
  const result = record.result || record.draft.previous;
  if (!result || result.cancelled) return null;
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    '隔离冻结样例，非正式家庭导出',
    '完整原始行 JSON',
    ...result.rows.map((row) => cell(JSON.stringify(row))),
  ].join('\r\n');
  return {
    scope: record.draft.label,
    generatedAt: `冻结到期 ${result.metadata.expires_at}`,
    total: result.metadata.matching_count,
    loaded: result.rows.length,
    complete: result.complete,
    href: result.complete
      ? `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + csv)}`
      : undefined,
  };
}
