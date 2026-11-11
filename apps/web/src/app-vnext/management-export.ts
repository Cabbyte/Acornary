import {
  exportSchemas,
  type BeginExport,
  type ReadExport,
  type CancelExport,
  type ExportMetadata,
  type ExportPage,
} from '../../../../packages/contracts/src/export';
import { OperationSession, type OperationRecord } from './operation-session';
import type { OperationStorage } from './platform';
import type { ApplicationScope } from './scope';

/** These are the frozen-export protocol ports, never inventory command emulation. */
export interface ManagementExportPort {
  begin(scope: ApplicationScope, input: BeginExport): Promise<ExportMetadata>;
  read(scope: ApplicationScope, input: ReadExport): Promise<ExportPage>;
  cancel(
    scope: ApplicationScope,
    input: CancelExport,
  ): Promise<{ export_id: string; cancelled: boolean }>;
}
export interface ManagementExportResult {
  metadata: ExportMetadata;
  rows: Record<string, unknown>[];
  nextCursor: string | null | undefined;
  complete: boolean;
  cancelled: boolean;
}
export interface ManagementExportDraft {
  selection: BeginExport;
  label: string;
  previous: ManagementExportResult | null;
}
export type ManagementExportAttempt =
  | { kind: 'begin'; input: BeginExport }
  | { kind: 'read'; input: ReadExport }
  | { kind: 'cancel'; input: CancelExport };
export type ManagementExportRecord = OperationRecord<
  ManagementExportDraft,
  ManagementExportAttempt,
  ManagementExportResult
>;
export type ManagementExportSession = OperationSession<
  ManagementExportDraft,
  ManagementExportAttempt,
  ManagementExportResult
>;
function invalid(message: string): never {
  throw Object.assign(Error(message), { code: 'CURSOR_STALE' });
}
function metadataValid(metadata: ExportMetadata): boolean {
  return (
    !!metadata &&
    typeof metadata.export_id === 'string' &&
    typeof metadata.generation === 'string' &&
    typeof metadata.query_hash === 'string' &&
    exportSchemas.read_export.safeParse({
      kind: 'ITEM',
      export_id: metadata.export_id,
      generation: metadata.generation,
      query_hash: metadata.query_hash,
    }).success &&
    ['REDACTED', 'SENSITIVE'].includes(metadata.disclosure_mode) &&
    typeof metadata.as_of_change_id === 'string' &&
    Number.isInteger(metadata.matching_count) &&
    metadata.matching_count >= 0 &&
    typeof metadata.expires_at === 'string' &&
    Number.isFinite(Date.parse(metadata.expires_at)) &&
    object(metadata.summary)
  );
}
export function managementExportAttempt(
  draft: ManagementExportDraft,
  kind: ManagementExportAttempt['kind'],
): ManagementExportAttempt {
  const selection = exportSchemas.begin_export.parse(draft.selection);
  if (kind === 'begin') {
    if (draft.previous) throw Error('已有冻结结果不能被新查询覆盖，请创建独立导出任务。');
    return { kind, input: selection };
  }
  const previous = draft.previous;
  if (!previous || !metadataValid(previous.metadata) || previous.cancelled)
    throw Error('缺少可用的原导出标识。');
  if (kind === 'cancel')
    return {
      kind,
      input: exportSchemas.cancel_export.parse({ export_id: previous.metadata.export_id }),
    };
  if (previous.complete) throw Error('冻结结果已完整读取。');
  return {
    kind,
    input: exportSchemas.read_export.parse({
      ...selection,
      export_id: previous.metadata.export_id,
      generation: previous.metadata.generation,
      query_hash: previous.metadata.query_hash,
      ...(previous.nextCursor ? { cursor: previous.nextCursor } : {}),
      limit: 100,
    }),
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function resultValid(value: unknown, sensitive: boolean): value is ManagementExportResult {
  if (!object(value)) return false;
  const result = value as unknown as ManagementExportResult;
  if (
    !metadataValid(result.metadata) ||
    !object(result.metadata.summary) ||
    result.metadata.disclosure_mode !== (sensitive ? 'SENSITIVE' : 'REDACTED') ||
    !Array.isArray(result.rows) ||
    !result.rows.every(object) ||
    typeof result.complete !== 'boolean' ||
    typeof result.cancelled !== 'boolean' ||
    !(
      result.nextCursor === undefined ||
      result.nextCursor === null ||
      (typeof result.nextCursor === 'string' &&
        result.nextCursor.length > 0 &&
        result.nextCursor.length <= 2048)
    )
  )
    return false;
  if (result.cancelled) return result.rows.length === 0 && !result.complete;
  if (result.rows.length > result.metadata.matching_count) return false;
  return result.complete
    ? result.nextCursor === null && result.rows.length === result.metadata.matching_count
    : result.nextCursor !== null && !(result.rows.length > 0 && result.nextCursor === undefined);
}
function draftValid(value: unknown, selection: BeginExport): value is ManagementExportDraft {
  if (
    !object(value) ||
    typeof value.label !== 'string' ||
    !exportSchemas.begin_export.safeParse(value.selection).success ||
    JSON.stringify(value.selection) !== JSON.stringify(selection)
  )
    return false;
  return value.previous === null || resultValid(value.previous, !!selection.include_sensitive);
}
export function createManagementExportSession(
  scope: ApplicationScope,
  taskId: string,
  selection: BeginExport,
  label: string,
  storage: OperationStorage,
  currentScope: () => ApplicationScope,
): ManagementExportSession {
  const draft: ManagementExportDraft = {
    selection: exportSchemas.begin_export.parse(selection),
    label,
    previous: null,
  };
  return new OperationSession(
    {
      version: 1,
      scope,
      taskId,
      targetIds: [],
      original: draft,
      draft,
      revisions: {},
      attempt: null,
      result: null,
      state: 'draft',
      reviewing: true,
      approval: null,
      error: '',
    },
    storage,
    currentScope,
    (value): value is ManagementExportRecord => {
      if (!object(value)) return false;
      const record = value as unknown as ManagementExportRecord;
      if (
        record.version !== 1 ||
        record.taskId !== taskId ||
        !object(record.scope) ||
        !['environment', 'accountId', 'householdId', 'clientId', 'datasetId'].every(
          (key) =>
            typeof (record.scope as unknown as Record<string, unknown>)[key] === 'string' &&
            !!(record.scope as unknown as Record<string, unknown>)[key],
        ) ||
        !Number.isInteger(record.scope.generation) ||
        record.scope.generation < 0 ||
        !Array.isArray(record.targetIds) ||
        record.targetIds.length !== 0 ||
        !object(record.revisions) ||
        Object.keys(record.revisions).length !== 0 ||
        typeof record.error !== 'string' ||
        typeof record.reviewing !== 'boolean' ||
        record.approval !== null ||
        !draftValid(record.draft, draft.selection) ||
        !draftValid(record.original, draft.selection) ||
        ![
          'draft',
          'validationError',
          'approvalRequired',
          'submitting',
          'success',
          'networkUnknown',
          'revisionConflict',
          'offline',
          'forbidden',
          'sessionChanged',
        ].includes(record.state) ||
        (record.attemptStatus !== undefined &&
          !['unsent', 'uncertain', 'rejected', 'committed'].includes(record.attemptStatus))
      )
        return false;
      if (record.attempt === null) {
        if (
          ['submitting', 'networkUnknown', 'success', 'sessionChanged'].includes(record.state) ||
          record.attemptStatus === 'uncertain'
        )
          return false;
      } else {
        if (
          !object(record.attempt) ||
          !['begin', 'read', 'cancel'].includes(record.attempt.kind) ||
          !record.attemptStatus
        )
          return false;
        if (record.attemptStatus === 'committed' && record.state !== 'success') return false;
      }
      if (record.state === 'success') {
        if (
          !record.attempt ||
          record.attemptStatus !== 'committed' ||
          !resultValid(record.result, !!draft.selection.include_sensitive)
        )
          return false;
      } else if (record.result !== null) return false;
      try {
        if (
          record.attempt &&
          JSON.stringify(record.attempt) !==
            JSON.stringify(managementExportAttempt(record.draft, record.attempt.kind))
        )
          return false;
        if (
          record.result &&
          record.draft.previous &&
          JSON.stringify(record.result.metadata) !== JSON.stringify(record.draft.previous.metadata)
        )
          return false;
        return true;
      } catch {
        return false;
      }
    },
  );
}
async function execute(
  session: ManagementExportSession,
  port: ManagementExportPort,
  attempt: ManagementExportAttempt,
  recovering: boolean,
): Promise<ManagementExportResult> {
  const record = session.getSnapshot();
  const { previous } = record.draft;
  if (attempt.kind === 'begin') {
    // begin_export has no idempotency key or lookup operation. A lost handle cannot
    // safely be advertised as recovery of the original frozen result.
    if (recovering)
      invalid(
        '初次冻结回执未知；协议没有原请求查询入口。原记录保留，请另建导出，旧冻结由服务端到期清理。',
      );
    const metadata = await port.begin(record.scope, attempt.input);
    if (
      !metadataValid(metadata) ||
      metadata.disclosure_mode !== (attempt.input.include_sensitive ? 'SENSITIVE' : 'REDACTED')
    )
      invalid('冻结结果标识或披露范围不匹配。');
    return { metadata, rows: [], nextCursor: undefined, complete: false, cancelled: false };
  }
  if (!previous) invalid('未读取到原冻结结果。');
  if (attempt.kind === 'cancel') {
    const result = await port.cancel(record.scope, attempt.input);
    if (result.export_id !== previous.metadata.export_id || result.cancelled !== true)
      invalid('服务端没有确认释放原导出，原冻结记录仍保留。');
    return { ...previous, rows: [], complete: false, cancelled: true };
  }
  const page = await port.read(record.scope, attempt.input);
  if (!metadataValid(page)) invalid('导出页元信息不完整。');
  for (const field of [
    'export_id',
    'generation',
    'query_hash',
    'disclosure_mode',
    'as_of_change_id',
    'matching_count',
    'expires_at',
  ] as const)
    if (page[field] !== previous.metadata[field]) invalid('导出页不属于原冻结范围，已保留原游标。');
  if (
    !Array.isArray(page.data) ||
    (page.next_cursor !== null &&
      (typeof page.next_cursor !== 'string' ||
        !page.next_cursor ||
        page.next_cursor === attempt.input.cursor))
  )
    invalid('导出页或后续游标无效。');
  const rows = [...previous.rows, ...page.data];
  if (
    rows.length > page.matching_count ||
    (page.next_cursor === null && rows.length !== page.matching_count)
  )
    invalid('导出页数与冻结总数不一致，不能宣称完整导出。');
  const result: ManagementExportResult = {
    metadata: previous.metadata,
    rows,
    nextCursor: page.next_cursor,
    complete: page.next_cursor === null,
    cancelled: false,
  };
  if (!resultValid(result, !!record.draft.selection.include_sensitive))
    invalid('导出行或游标不符合冻结结果契约。');
  return result;
}
export async function runManagementExportStep(
  session: ManagementExportSession,
  kind: ManagementExportAttempt['kind'],
  port: ManagementExportPort,
) {
  let record = session.getSnapshot();
  if (['networkUnknown', 'submitting', 'sessionChanged'].includes(record.state)) return;
  if (record.state === 'success') {
    await session.restart({ ...record.draft, previous: record.result }, {});
    record = session.getSnapshot();
  }
  if (record.attempt && record.attempt.kind !== kind) {
    if (!['unsent', 'rejected'].includes(record.attemptStatus || '')) return;
    await session.update({ draft: { ...record.draft }, state: 'draft', error: '' });
    record = session.getSnapshot();
  }
  const attempt = record.attempt || managementExportAttempt(record.draft, kind);
  await session.submit(attempt, (original) => execute(session, port, original, false));
}
export const recoverManagementExportStep = (
  session: ManagementExportSession,
  port: ManagementExportPort,
) => session.recover((original) => execute(session, port, original, true));
