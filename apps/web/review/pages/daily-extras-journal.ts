import { dailyCommand } from '../../src/app-vnext/daily-tasks';
import { validateCommandAttempt } from '../../src/app-vnext/operation-session';
import { isPlainDate } from '../../src/ui/components/ui/calendar';
import type { OpeningDraft } from '../../src/features/daily/pages/daily-extras';
import type {
  EditSurface,
  RequestSnapshot,
  ReviewState,
  DailyFixtureRecord,
} from './daily-extras-fixture';
function failure(message: string, code: string) {
  return Object.assign(Error(message), { code });
}

const kinds = ['opening', 'dates', 'notes'] as const;
const states = [
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
];
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
/** Read-only precedence, never a migration: a durable matching successor owns that task's status.
 * Invalid/mismatched successor records leave the original pending state visible. */
export function dailyJournalProjection(
  key: string,
  value: unknown,
  read: (key: string) => string | null,
  scope: { accountId: string; householdId: string },
): unknown {
  if (
    !/^acornary-review-daily-extras-v1:item_[0-9a-f-]{36}:[^:]+$/i.test(key) ||
    !object(value) ||
    !object(value.mutations)
  )
    return value;
  const target = key.split(':')[1];
  const mutations = { ...value.mutations };
  for (const kind of kinds) {
    try {
      const taskId = `${key}:task:${kind}`;
      const raw = read(taskId);
      if (!raw) continue;
      const record = JSON.parse(raw);
      const mutation = mutations[kind];
      if (
        !validDailyFixtureRecord(record, taskId, target) ||
        !object(mutation) ||
        record.scope.environment !== 'isolated-trial' ||
        record.scope.datasetId !== 'trial-rc1-v1' ||
        record.scope.clientId !== 'web-review' ||
        record.scope.accountId !== scope.accountId ||
        record.scope.householdId !== scope.householdId ||
        !record.predecessor ||
        record.predecessor.key !== key ||
        record.predecessor.kind !== kind ||
        JSON.stringify(record.predecessor.request) !== JSON.stringify(mutation.request)
      )
        continue;
      // The successor is scanned independently, so don't duplicate its predecessor's old state.
      delete mutations[kind];
    } catch {
      /* malformed successor cannot erase evidence of an outstanding task */
    }
  }
  return { ...value, mutations };
}

export function requestTarget(kind: EditSurface, target: string, request: RequestSnapshot) {
  if (request.target) {
    const expectedKind = kind === 'notes' && request.scope === 'product' ? 'CATALOG_NODE' : 'ITEM';
    if (
      request.target.kind !== expectedKind ||
      (expectedKind === 'ITEM' && request.target.id !== target)
    )
      throw failure('原请求对象与任务入口不一致。', 'IDEMPOTENCY_CONFLICT');
    return request.target.id;
  }
  if (kind === 'notes' && request.scope === 'product')
    throw failure(
      '旧商品笔记未保存原商品 ID；无法重建原请求，记录已保留。',
      'IDEMPOTENCY_CONFLICT',
    );
  return target;
}

function openedInstant(opening: OpeningDraft, now: string) {
  if (opening.intent === 'unknown') return null;
  if (opening.intent === 'now') return now;
  if (!opening.localTime) {
    if (opening.intent === 'backdate') throw Error('请填写实际开封日期与时间。');
    return null;
  }
  const offsets: Record<string, string> = {
    UTC: '+00:00',
    'Asia/Tokyo': '+09:00',
    'Asia/Shanghai': '+08:00',
  };
  const offset = offsets[opening.timezone];
  if (
    !offset ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(opening.localTime) ||
    !isPlainDate(opening.localTime.slice(0, 10))
  )
    throw Error('请明确有效的开封日期、时间和时区。');
  const instant = `${opening.localTime}:00${offset}`;
  if (!Number.isFinite(Date.parse(instant)) || Date.parse(instant) > Date.parse(now))
    throw Error('开封时间不能晚于当前时间。');
  return instant;
}
export function commandFor(
  kind: EditSurface,
  target: string,
  request: RequestSnapshot,
  draft: ReviewState,
  instant: string,
) {
  const revisions = { [requestTarget(kind, target, request)]: request.targetRevision };
  if (kind === 'opening')
    return dailyCommand(
      {
        kind,
        itemId: target,
        openedAt: openedInstant(request.opening!, instant),
        correction: request.opening!.intent === 'correct' || request.opening!.intent === 'unknown',
        reason:
          request.opening!.intent === 'unknown'
            ? '用户明确记录已开封，时间未知'
            : '用户修正开封记录',
        templateVersion: 2,
      },
      revisions,
      request.key,
    );
  if (kind === 'dates')
    return dailyCommand(
      {
        kind,
        itemId: target,
        fact: request.date!,
        originalBasis: draft.facts[request.dateIndex!]?.basis ?? null,
        templateVersion: 2,
        creating: request.dateIndex === -1,
        // The presentation has no stable deadline identity; never use its array index as one.
        completedOn: request.completing ? request.completedOn : undefined,
      },
      revisions,
      request.key,
    );
  const selected = draft.notes.find((note) => note.id === request.noteId);
  return dailyCommand(
    {
      kind,
      target: {
        kind: request.scope === 'product' ? 'CATALOG_NODE' : 'ITEM',
        id: requestTarget(kind, target, request),
      },
      ...(request.noteId?.startsWith('new-') ? {} : { noteId: request.noteId }),
      title: request.note!.title,
      body: request.note!.body,
      redacted: selected?.redacted,
    },
    revisions,
    request.key,
  );
}

export function validState(value: unknown): value is ReviewState {
  if (!value || typeof value !== 'object') return false;
  const state = value as ReviewState;
  return (
    !!state.opening &&
    typeof state.opening.localTime === 'string' &&
    Array.isArray(state.facts) &&
    !!state.dateDraft &&
    Number.isInteger(state.dateIndex) &&
    Array.isArray(state.notes) &&
    !!state.noteDrafts &&
    !!state.selectedNotes &&
    ['item', 'product'].includes(state.scope) &&
    !!state.mutations
  );
}

export function validDailyFixtureRecord(
  value: unknown,
  taskId: string,
  target: string,
): value is DailyFixtureRecord {
  const kind = taskId.split(':').at(-1) as EditSurface;
  if (!kinds.includes(kind)) return false;
  if (!value || typeof value !== 'object') return false;
  const record = value as DailyFixtureRecord;
  if (
    record.version !== 1 ||
    record.taskId !== taskId ||
    !record.scope ||
    record.targetIds?.length !== 1 ||
    record.targetIds[0] !== target ||
    !validState(record.draft) ||
    !validState(record.original) ||
    !record.revisions ||
    !states.includes(record.state)
  )
    return false;
  if (['submitting', 'networkUnknown', 'success'].includes(record.state) && !record.attempt)
    return false;
  if (record.result && !validState(record.result)) return false;
  const attempt = record.attempt;
  if (!attempt) return true;
  if (
    !attempt.request ||
    typeof attempt.request.key !== 'string' ||
    !attempt.request.key ||
    !Number.isInteger(attempt.request.targetRevision) ||
    !validState(attempt.snapshot)
  )
    return false;
  if (attempt.command) {
    try {
      validateCommandAttempt(attempt.command);
      if (
        attempt.command.payload.idempotency_key !== attempt.request.key ||
        !attempt.instant ||
        JSON.stringify(
          commandFor(kind, target, attempt.request, attempt.snapshot, attempt.instant),
        ) !== JSON.stringify(attempt.command)
      )
        return false;
    } catch {
      return false;
    }
  }
  return true;
}
