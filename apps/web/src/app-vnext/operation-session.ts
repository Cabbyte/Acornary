import type { OperationState } from '../ui/patterns/types';
import { recoveryFor } from '../features/api/recovery';
import { parseWriteCommand } from '../features/writes/note-command';
import type { CommandAttempt, OperationStorage } from './platform';
import { dispatchPersistedAttempt } from './dispatch';
import { sameGeneration, sameScope, type ApplicationScope } from './scope';

export interface OperationRecord<Draft, Attempt, Result> {
  version: 1;
  scope: ApplicationScope;
  taskId: string;
  targetIds: readonly string[];
  original: Draft;
  draft: Draft;
  revisions: Record<string, number>;
  attempt: Attempt | null;
  attemptStatus?: 'unsent' | 'uncertain' | 'rejected' | 'committed';
  result: Result | null;
  state: OperationState;
  reviewing: boolean;
  approval: { id: string; revision: number } | null;
  error: string;
}
export function validateCommandAttempt(attempt: CommandAttempt): CommandAttempt {
  const parsed = parseWriteCommand(attempt.operation, attempt.payload);
  if (!parsed.success) throw Error('请检查必填项、日期、件数和数量格式。');
  return { operation: attempt.operation, payload: parsed.data as Record<string, unknown> };
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Root-owned record. The view never owns an in-flight promise or original attempt.
 * Uses ActionSheet's persist/dispatch/receipt ordering and shared API recovery policy.
 * Adapter supplies execution; this class neither issues HTTP nor interprets fixtures. */
export class OperationSession<Draft, Attempt, Result> {
  private record: OperationRecord<Draft, Attempt, Result>;
  private listeners = new Set<() => void>();
  private busy = false;
  private writes: Promise<void> = Promise.resolve();
  private durable = true;
  private dirty = false;
  private lastPersisted = '';
  hasUnpersisted = () => this.dirty;
  constructor(
    initial: OperationRecord<Draft, Attempt, Result>,
    private storage: OperationStorage,
    private currentScope: () => ApplicationScope,
    validateSaved: (value: unknown) => value is OperationRecord<Draft, Attempt, Result>,
  ) {
    this.record = structuredClone(initial);
    try {
      const saved = storage.load(initial.scope, initial.taskId);
      if (saved != null) {
        if (
          !validateSaved(saved) ||
          !sameScope(saved.scope, initial.scope) ||
          saved.taskId !== initial.taskId
        )
          throw Error('保存的任务无法安全恢复，原记录已保留。');
        this.record = {
          ...saved,
          scope: initial.scope,
          state:
            saved.state === 'submitting' ||
            (saved.state === 'sessionChanged' &&
              saved.attempt &&
              saved.attemptStatus !== 'rejected')
              ? 'networkUnknown'
              : saved.state,
        };
      }
    } catch (error) {
      this.durable = false;
      this.record = { ...this.record, state: 'validationError', error: String(error) };
    }
    this.record = frozen(this.record);
    this.lastPersisted = JSON.stringify(this.record);
  }
  getSnapshot = () => this.record;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(record: OperationRecord<Draft, Attempt, Result>) {
    this.record = frozen(structuredClone(record));
    this.dirty = JSON.stringify(this.record) !== this.lastPersisted;
    this.listeners.forEach((listener) => listener());
  }
  private save(record: OperationRecord<Draft, Attempt, Result>) {
    const snapshot = structuredClone(record);
    const write = this.writes.then(() => {
      if (!sameGeneration(snapshot.scope, this.currentScope())) throw Error('SESSION_CHANGED');
      return Promise.resolve(this.storage.save(snapshot.scope, snapshot.taskId, snapshot)).then(
        () => {
          this.lastPersisted = JSON.stringify(snapshot);
          this.dirty = this.lastPersisted !== JSON.stringify(this.record);
        },
      );
    });
    this.writes = write.catch(() => {});
    return write;
  }
  async retain() {
    if (this.busy) return false;
    if (!this.dirty) return true;
    if (!this.durable) return false;
    try {
      this.assertScope();
      await this.writes;
      if (this.dirty) await this.save(this.record);
      return !this.dirty;
    } catch (error) {
      this.publish({ ...this.record, error: `无法保留任务，请恢复存储后再离开：${String(error)}` });
      return false;
    }
  }
  private assertScope() {
    if (!sameGeneration(this.record.scope, this.currentScope())) throw Error('SESSION_CHANGED');
  }
  /** Input/review changes only. Uncertain attempts cannot be replaced through editing. */
  async update(
    patch: Partial<
      Pick<
        OperationRecord<Draft, Attempt, Result>,
        'draft' | 'reviewing' | 'approval' | 'state' | 'error'
      >
    >,
  ) {
    if (this.busy || this.record.state === 'networkUnknown') return false;
    if (
      patch.draft &&
      this.record.attempt &&
      !['unsent', 'rejected'].includes(this.record.attemptStatus || '')
    )
      return false;
    try {
      this.assertScope();
      if (!this.durable) throw Error('原任务不可安全读取，未覆盖存储。');
      const next = {
        ...this.record,
        ...patch,
        ...(patch.draft ? { attempt: null, approval: null, reviewing: false } : {}),
      };
      // Publish input immediately; dispatch always awaits its own durable snapshot.
      this.publish(next);
      await this.save(next);
      return true;
    } catch (error) {
      this.publish({ ...this.record, error: String(error) });
      return false;
    }
  }
  async submit(attempt: Attempt, execute: (attempt: Attempt) => Promise<Result>) {
    if (this.record.attempt && ['networkUnknown', 'sessionChanged'].includes(this.record.state))
      return;
    await this.dispatch(attempt, execute);
  }
  private async dispatch(attempt: Attempt, execute: (attempt: Attempt) => Promise<Result>) {
    if (this.busy || this.record.state === 'success' || this.record.state === 'revisionConflict')
      return;
    if (!this.durable) return;
    this.busy = true;
    const original = frozen(structuredClone(this.record.attempt ?? attempt));
    const pending = {
      ...this.record,
      attempt: original,
      attemptStatus: 'uncertain' as const,
      state: 'submitting' as const,
      reviewing: true,
      error: '',
    };
    let sent = false;
    let resultReceived = false;
    try {
      this.assertScope();
      // Lock synchronously, including while the storage acknowledgement is pending.
      this.publish(pending);
      await dispatchPersistedAttempt({
        pending,
        persistPending: (value) => this.save(value),
        execute: () => {
          this.assertScope();
          sent = true;
          return execute(original);
        },
        persistResult: async (result) => {
          resultReceived = true;
          this.assertScope();
          const committed = {
            ...pending,
            result,
            attemptStatus: 'committed' as const,
            state: 'success' as const,
          };
          await this.save(committed);
          this.publish(committed);
          this.dirty = false;
        },
      });
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : '';
      const status =
        typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
      const explicit =
        typeof error === 'object' && error && 'recovery' in error
          ? String(error.recovery)
          : undefined;
      const recovery = recoveryFor({ code, recovery: explicit });
      const changed = !sameGeneration(pending.scope, this.currentScope());
      const definitive =
        ![408, 429].includes(status) &&
        (status === 0 || (status >= 400 && status < 500)) &&
        [
          'REVISION_CONFLICT',
          'POLICY_CONFLICT',
          'FORBIDDEN',
          'APPROVAL_REQUIRED',
          'APPROVAL_EXPIRED',
          'ATTRIBUTE_VALIDATION_FAILED',
          'MISSING_EXPECTED_REVISION',
          'INVALID_PARENT',
          'CYCLE_DETECTED',
          'MISSING_FACTS',
          'INSUFFICIENT_CONTENT',
          'UNIT_MISMATCH',
          'INVALID_TRANSITION',
          'STATE_CONFLICT',
          'NOT_FOUND',
          'CLASSIFICATION_CONFLICT',
          'AMBIGUOUS_PRODUCT',
          'BARCODE_CONFLICT',
        ].includes(code);
      const uncertain =
        resultReceived ||
        (sent && !definitive) ||
        ['NETWORK', 'IDEMPOTENCY_CONFLICT', 'CURSOR_STALE'].includes(code) ||
        recovery === 'RECOVER_ORIGINAL_REQUEST' ||
        status >= 500 ||
        (!code && sent);
      // Status alone (including proxy 4xx, timeout and rate limit) is not proof
      // that a command was rejected before commit. Unknown codes retain the key.
      const state: OperationState =
        changed || ['SESSION_CHANGED', 'UNAUTHORIZED'].includes(code)
          ? 'sessionChanged'
          : uncertain
            ? 'networkUnknown'
            : code === 'FORBIDDEN'
              ? 'forbidden'
              : ['APPROVAL_REQUIRED', 'APPROVAL_EXPIRED'].includes(code)
                ? 'approvalRequired'
                : recovery === 'REREAD_AND_REVIEW' || code === 'POLICY_CONFLICT'
                  ? 'revisionConflict'
                  : 'validationError';
      const failed = {
        ...pending,
        state,
        attemptStatus: (!sent
          ? 'unsent'
          : uncertain || changed || state === 'sessionChanged'
            ? 'uncertain'
            : 'rejected') as 'unsent' | 'uncertain' | 'rejected',
        error: sent ? String(error) : `无法保存或发送原请求，未发送：${String(error)}`,
      };
      // Never write an old response into a newly selected account/family namespace.
      if (sameGeneration(pending.scope, this.currentScope())) {
        try {
          await this.save(failed);
        } catch {
          /* exact pending record remains */
        }
      }
      this.publish(failed);
    } finally {
      this.busy = false;
    }
  }
  async recover(execute: (attempt: Attempt) => Promise<Result>) {
    if (!this.record.attempt) return;
    await this.dispatch(this.record.attempt, execute);
  }
  /** Called only after authoritative re-read and explicit user reconciliation. */
  async reconcile(draft: Draft, revisions: Record<string, number>, currentOriginal: Draft) {
    if (this.busy || this.record.state !== 'revisionConflict') return;
    this.assertScope();
    const next = {
      ...this.record,
      original: structuredClone(currentOriginal),
      draft,
      revisions,
      attempt: null,
      approval: null,
      reviewing: false,
      state: 'draft' as const,
      error: '',
    };
    await this.save(next);
    this.publish(next);
    this.dirty = false;
  }
  async restart(draft: Draft, revisions: Record<string, number>) {
    if (this.busy || this.record.state !== 'success') return;
    this.assertScope();
    const next = {
      ...this.record,
      original: structuredClone(draft),
      draft,
      revisions,
      attempt: null,
      result: null,
      approval: null,
      reviewing: false,
      state: 'draft' as const,
      error: '',
    };
    await this.save(next);
    this.publish(next);
    this.dirty = false;
  }
}
