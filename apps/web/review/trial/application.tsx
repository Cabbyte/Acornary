import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import {
  OperationSessionProvider,
  useOperationSessions,
} from '../../src/app-vnext/operation-context';
import {
  OperationSession,
  validateCommandAttempt,
  type OperationRecord,
} from '../../src/app-vnext/operation-session';
import type { CommandAttempt } from '../../src/app-vnext/platform';
import type { ApplicationScope } from '../../src/app-vnext/scope';
import { sameGeneration } from '../../src/app-vnext/scope';
import type { DailyTaskDraft, DailyTaskKind } from '../../src/features/daily/pages/daily-task';
import { getTrialScope, isTrial, subscribeTrialScope, setTrialNavigationGuard } from './session';
import { reviewStorage, assertTrialWrite, trialSubmitting } from './storage';
import { applyReviewTask } from '../pages/inventory-session';

export function getFixtureScope(): ApplicationScope {
  const scope = getTrialScope();
  return {
    environment: isTrial() ? 'isolated-trial' : 'isolated-review',
    accountId: scope.accountId,
    householdId: scope.householdId,
    clientId: 'web-review',
    datasetId: 'trial-rc1-v1',
    generation: scope.generation,
  };
}
export function FixtureApplicationProvider({ children }: { children: ReactNode }) {
  // Scope changes update child adapters; the root registry itself survives routes/modes.
  useSyncExternalStore(subscribeTrialScope, getTrialScope);
  return (
    <OperationSessionProvider>
      <FixtureNavigationGuard />
      {children}
    </OperationSessionProvider>
  );
}
function FixtureNavigationGuard() {
  const sessions = useOperationSessions();
  useEffect(() => {
    setTrialNavigationGuard(
      () =>
        sessions.isSubmitting() || sessions.hasUnpersisted(getFixtureScope()) || trialSubmitting(),
    );
    return () => setTrialNavigationGuard(trialSubmitting);
  }, [sessions]);
  return null;
}
export interface FixtureAttempt {
  key: string;
  draft: DailyTaskDraft;
  expectedRevision?: number;
  reviewSummary: string[];
  command: CommandAttempt;
}
export type FixtureRecord = OperationRecord<DailyTaskDraft, FixtureAttempt, string[]>;
export type FixtureSession = OperationSession<DailyTaskDraft, FixtureAttempt, string[]>;
const storage = {
  load(scope: ApplicationScope, key: string) {
    if (!sameGeneration(scope, getFixtureScope())) throw Error('SESSION_CHANGED');
    const raw = reviewStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  },
  save(scope: ApplicationScope, key: string, value: unknown) {
    if (!sameGeneration(scope, getFixtureScope())) throw Error('SESSION_CHANGED');
    reviewStorage.setItem(key, JSON.stringify(value));
  },
};
function validSaved(value: unknown): value is FixtureRecord {
  if (!value || typeof value !== 'object') return false;
  const saved = value as FixtureRecord;
  if (
    saved.version !== 1 ||
    !saved.scope ||
    typeof saved.taskId !== 'string' ||
    !saved.draft ||
    !saved.original ||
    !saved.revisions
  )
    return false;
  const validDraft = (draft: DailyTaskDraft) =>
    typeof draft.name === 'string' &&
    typeof draft.count === 'string' &&
    typeof draft.finish === 'boolean' &&
    Array.isArray(draft.dates) &&
    !!draft.location &&
    !!draft.quantity;
  if (!validDraft(saved.draft) || !validDraft(saved.original)) return false;
  if (['submitting', 'networkUnknown', 'success'].includes(saved.state) && !saved.attempt)
    return false;
  if (saved.attempt) {
    try {
      validateCommandAttempt(saved.attempt.command);
    } catch {
      return false;
    }
    if (
      saved.attempt.key !== saved.attempt.command.payload.idempotency_key ||
      !validDraft(saved.attempt.draft)
    )
      return false;
  }
  return [
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
  ].includes(saved.state);
}
export function createFixtureSession(
  taskId: string,
  draft: DailyTaskDraft,
  target: string | undefined,
  revision: number | undefined,
  scenario: string,
  kind: DailyTaskKind,
): FixtureSession {
  const state = 'draft';
  const initial: FixtureRecord = {
    version: 1,
    scope: getFixtureScope(),
    taskId,
    targetIds: target ? [target] : [],
    original: draft,
    draft,
    revisions: target && revision ? { [target]: revision } : {},
    attempt: null,
    result: null,
    state,
    reviewing: false,
    approval: null,
    error: '',
  };
  return new OperationSession(
    initial,
    {
      ...storage,
      load(scope, key) {
        const saved = storage.load(scope, key);
        if (saved == null || saved.version === 1) return saved;
        // Only the isolated RC1 namespace is read. Preserve the same key, frozen
        // parameters and world receipt; never touch legacy production draft storage.
        if (!saved.draft || !('request' in saved) || !('state' in saved))
          throw Error('旧试用任务结构无法安全恢复，原记录已保留。');
        const original = saved.request;
        if (original && typeof original.key !== 'string')
          throw Error('旧试用任务缺少原请求键，未创建新请求。');
        const attempt = original
          ? freezeFixtureAttempt(
              kind,
              original.draft,
              target,
              original.expectedRevision,
              original.reviewSummary || [],
              original.key,
            )
          : null;
        return {
          ...initial,
          draft: saved.draft,
          attempt,
          revisions:
            target && original?.expectedRevision
              ? { [target]: original.expectedRevision }
              : initial.revisions,
          state: saved.state,
          reviewing: !!saved.reviewing,
          result: saved.state === 'success' ? saved.receipt || [] : null,
          attemptStatus:
            saved.state === 'success' ? 'committed' : attempt ? 'uncertain' : undefined,
        };
      },
    },
    getFixtureScope,
    validSaved,
  );
}
export function freezeFixtureAttempt(
  kind: DailyTaskKind,
  draft: DailyTaskDraft,
  target: string | undefined,
  expectedRevision: number | undefined,
  summary: readonly string[],
  originalKey?: string,
): FixtureAttempt {
  const key = originalKey ?? crypto.randomUUID();
  const base = {
    idempotency_key: key,
    expected_revisions: target && expectedRevision ? { [target]: expectedRevision } : {},
  };
  const command = validateCommandAttempt(
    kind === 'move'
      ? {
          operation: 'move_item',
          payload: {
            ...base,
            item_id: target,
            parent_id: draft.location.kind === 'item' ? draft.location.itemId : null,
          },
        }
      : kind === 'consume'
        ? draft.finish
          ? { operation: 'consume_items', payload: { ...base, item_ids: [target] } }
          : {
              operation: 'consume_item_content',
              payload: {
                ...base,
                item_id: target,
                amount: { value: draft.quantity.value, unit: draft.quantity.unit },
                ...(draft.quantity.accuracy === 'unknown'
                  ? {}
                  : { accuracy: draft.quantity.accuracy.toUpperCase() }),
              },
            }
        : {
            operation: 'commit_intake',
            payload: {
              ...base,
              policy_revision: 1,
              lines: [
                {
                  product:
                    kind === 'intake'
                      ? { catalog_node_id: draft.catalog?.id }
                      : {
                          name: draft.name,
                          parent_id: draft.catalog?.id,
                          classification_reason: '隔离示例：用户核对分类',
                        },
                  instances: Array.from({ length: Number(draft.count) }, (_, index) => ({
                    count: 1,
                    parent_id: draft.location.kind === 'item' ? draft.location.itemId : null,
                    initial_attributes: draft.dates[index]
                      ? [
                          {
                            template_id: 'lifecycle',
                            template_version: 2,
                            values: {
                              expiry: { date: draft.dates[index], date_kind: 'BEST_BEFORE' },
                            },
                          },
                        ]
                      : [],
                  })),
                },
              ],
            },
          },
  );
  return {
    key,
    draft: structuredClone(draft),
    expectedRevision,
    reviewSummary: [...summary],
    command,
  };
}
export async function executeFixtureAttempt(
  scope: ApplicationScope,
  kind: DailyTaskKind,
  target: string | undefined,
  request: FixtureAttempt,
  scenario: string,
  recovering = false,
): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (!sameGeneration(scope, getFixtureScope()))
    throw Object.assign(Error('SESSION_CHANGED'), { code: 'SESSION_CHANGED' });
  assertTrialWrite();
  const frozenTarget =
    typeof request.command.payload.item_id === 'string'
      ? request.command.payload.item_id
      : Array.isArray(request.command.payload.item_ids)
        ? String(request.command.payload.item_ids[0])
        : undefined;
  const frozenKind: DailyTaskKind =
    request.command.operation === 'move_item'
      ? 'move'
      : request.command.operation === 'consume_item_content' ||
          request.command.operation === 'consume_items'
        ? 'consume'
        : 'commit_intake' === request.command.operation
          ? (request.command.payload.lines as { product: { catalog_node_id?: string } }[])[0]
              ?.product.catalog_node_id
            ? 'intake'
            : 'new-product'
          : kind;
  if (frozenKind !== kind || (target && frozenTarget && target !== frozenTarget))
    throw Object.assign(Error('原请求对象或操作与当前入口不同，未执行。'), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
  const projected = freezeFixtureAttempt(
    frozenKind,
    request.draft,
    frozenTarget,
    request.expectedRevision,
    request.reviewSummary,
    request.key,
  );
  if (JSON.stringify(projected.command) !== JSON.stringify(request.command))
    throw Object.assign(Error('原请求参数与保存的命令不一致，未执行。'), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
  try {
    const ids = applyReviewTask(
      request.key,
      frozenKind,
      request.draft,
      frozenTarget,
      request.expectedRevision,
    );
    if (scenario === 'unknown' && !recovering)
      throw Object.assign(Error('示例回执丢失，请核对原请求。'), { code: 'NETWORK' });
    return [
      '预览结果 · 已更新隔离数据，未写入正式库存',
      ...request.reviewSummary,
      ...ids.map((id) => `示例物品：${id}`),
    ];
  } catch (error) {
    if (String(error).includes('版本'))
      throw Object.assign(error instanceof Error ? error : Error(String(error)), {
        code: 'REVISION_CONFLICT',
      });
    throw error;
  }
}
