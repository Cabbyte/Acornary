import { z } from 'zod';
import { OperationSession, type OperationRecord } from './operation-session';
import type { OperationStorage } from './platform';
import { sameScope, type ApplicationScope } from './scope';

/** Account endpoints are not inventory commands and accept no client idempotency key. */
const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(80);
const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rename-household'), householdId: id, name }),
  z.strictObject({ kind: z.literal('revoke-invitation'), householdId: id, invitationId: id }),
  z.strictObject({ kind: z.literal('rename-passkey'), passkeyId: id, name }),
  z.strictObject({ kind: z.literal('remove-passkey'), passkeyId: id }),
  z.strictObject({ kind: z.literal('remove-password') }),
]);
const draftSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('rename-household'),
    householdId: id,
    name: z.string().max(80),
  }),
  z.strictObject({ kind: z.literal('revoke-invitation'), householdId: id, invitationId: id }),
  z.strictObject({ kind: z.literal('rename-passkey'), passkeyId: id, name: z.string().max(80) }),
  z.strictObject({ kind: z.literal('remove-passkey'), passkeyId: id }),
  z.strictObject({ kind: z.literal('remove-password') }),
]);
export type SettingsCommand = z.infer<typeof commandSchema>;
export interface SettingsAttempt {
  /** Local journal reference only. Never sent as a pretend server idempotency key. */
  localId: string;
  command: SettingsCommand;
  request: {
    path: 'account/household' | 'account/passkey/update' | 'account/password';
    body: Record<string, string | null>;
  };
}
export interface SettingsReceipt {
  evidence: 'response' | 'current-read';
  description: string;
}
export type SettingsTaskRecord = OperationRecord<
  SettingsCommand | null,
  SettingsAttempt,
  SettingsReceipt
>;
export interface SettingsTaskPorts {
  storage: OperationStorage;
  currentScope(): ApplicationScope;
  execute(scope: ApplicationScope, attempt: SettingsAttempt): Promise<SettingsReceipt>;
  /** Read-only postcondition check. Must never reissue the original POST. */
  observe(scope: ApplicationScope, attempt: SettingsAttempt): Promise<SettingsReceipt | null>;
}
export function settingsAttempt(command: SettingsCommand, localId: string): SettingsAttempt {
  const parsed = commandSchema.parse(command);
  id.parse(localId);
  const request: SettingsAttempt['request'] =
    parsed.kind === 'rename-household'
      ? {
          path: 'account/household',
          body: { action: 'rename', household_id: parsed.householdId, name: parsed.name },
        }
      : parsed.kind === 'revoke-invitation'
        ? {
            path: 'account/household',
            body: {
              action: 'revoke',
              household_id: parsed.householdId,
              invitation_id: parsed.invitationId,
            },
          }
        : parsed.kind === 'remove-password'
          ? { path: 'account/password', body: { password: null } }
          : {
              path: 'account/passkey/update',
              body: {
                id: parsed.passkeyId,
                name: parsed.kind === 'rename-passkey' ? parsed.name : null,
              },
            };
  return { localId, command: parsed, request };
}
export function validSettingsTask(
  value: unknown,
  initial: SettingsTaskRecord,
): value is SettingsTaskRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as SettingsTaskRecord;
  const keys = [
    'version',
    'scope',
    'taskId',
    'targetIds',
    'original',
    'draft',
    'revisions',
    'attempt',
    'attemptStatus',
    'result',
    'state',
    'reviewing',
    'approval',
    'error',
  ];
  if (Object.keys(record).some((key) => !keys.includes(key))) return false;
  if (
    !z
      .strictObject({
        environment: id,
        accountId: id,
        householdId: id,
        clientId: id,
        datasetId: id,
        generation: z.number().int().nonnegative(),
      })
      .safeParse(record.scope).success ||
    !record.revisions ||
    Object.keys(record.revisions).length !== 0 ||
    typeof record.reviewing !== 'boolean' ||
    record.approval !== null ||
    typeof record.error !== 'string'
  )
    return false;
  if (
    record.version !== 1 ||
    record.taskId !== initial.taskId ||
    !record.scope ||
    !sameScope(record.scope, initial.scope) ||
    JSON.stringify(record.targetIds) !== JSON.stringify(initial.targetIds) ||
    ![
      'draft',
      'validationError',
      'submitting',
      'success',
      'networkUnknown',
      'forbidden',
      'sessionChanged',
    ].includes(record.state) ||
    (record.draft !== null && !draftSchema.safeParse(record.draft).success) ||
    (record.original !== null && !draftSchema.safeParse(record.original).success)
  )
    return false;
  if (['submitting', 'networkUnknown', 'success'].includes(record.state) && !record.attempt)
    return false;
  if (
    record.attemptStatus !== undefined &&
    !['unsent', 'uncertain', 'rejected', 'committed'].includes(record.attemptStatus)
  )
    return false;
  if (record.attempt && record.attemptStatus === undefined) return false;
  if (
    ['submitting', 'networkUnknown'].includes(record.state) &&
    record.attemptStatus !== 'uncertain'
  )
    return false;
  if (record.state === 'success' && (!record.result || record.attemptStatus !== 'committed'))
    return false;
  if (record.attempt) {
    try {
      if (
        !record.attempt.localId ||
        JSON.stringify(settingsAttempt(record.attempt.command, record.attempt.localId)) !==
          JSON.stringify(record.attempt) ||
        ('householdId' in record.attempt.command &&
          record.attempt.command.householdId !== initial.scope.householdId)
      )
        return false;
    } catch {
      return false;
    }
  }
  return (
    record.result === null ||
    z
      .strictObject({ evidence: z.enum(['response', 'current-read']), description: z.string() })
      .safeParse(record.result).success
  );
}
const commandIdentity = (command: SettingsCommand) =>
  `${command.kind}:${'householdId' in command ? command.householdId : ''}:${'passkeyId' in command ? command.passkeyId : ''}:${'invitationId' in command ? command.invitationId : ''}`;
export class SettingsTaskController extends OperationSession<
  SettingsCommand | null,
  SettingsAttempt,
  SettingsReceipt
> {
  private preparing = false;
  private pendingDraft: SettingsCommand | null = null;
  stagedCommand = () => this.pendingDraft || this.getSnapshot().draft;
  constructor(
    scope: ApplicationScope,
    taskId: string,
    private ports: SettingsTaskPorts,
  ) {
    const initial: SettingsTaskRecord = {
      version: 1,
      scope,
      taskId,
      targetIds: [scope.accountId, scope.householdId],
      original: null,
      draft: null,
      revisions: {},
      attempt: null,
      result: null,
      state: 'draft',
      reviewing: false,
      approval: null,
      error: '',
    };
    super(initial, ports.storage, ports.currentScope, (value): value is SettingsTaskRecord =>
      validSettingsTask(value, initial),
    );
    const hasUnpersisted = this.hasUnpersisted;
    this.hasUnpersisted = () => !!this.pendingDraft || hasUnpersisted();
  }
  async stageCommand(command: SettingsCommand) {
    if (
      this.preparing ||
      ['submitting', 'networkUnknown', 'sessionChanged'].includes(this.getSnapshot().state)
    )
      return false;
    const existing = this.getSnapshot();
    const activeDraft = this.pendingDraft || (existing.state === 'success' ? null : existing.draft);
    if (activeDraft && commandIdentity(activeDraft) !== commandIdentity(command)) {
      await this.update({
        ...(existing.state === 'success' ? {} : { state: 'validationError' as const }),
        error: '已有另一项未完成设置草稿，请先继续或明确放弃该草稿。',
      });
      return false;
    }
    const parsed = draftSchema.safeParse(command);
    if (
      !parsed.success ||
      ('householdId' in parsed.data &&
        parsed.data.householdId !== this.getSnapshot().scope.householdId)
    )
      return false;
    const input = parsed.data;
    this.pendingDraft = input;
    try {
      const saved =
        this.getSnapshot().state === 'success'
          ? (await this.restart(parsed.data, {}), true)
          : await this.update({ draft: parsed.data, state: 'draft', error: '' });
      if (saved && this.pendingDraft === input) this.pendingDraft = null;
      return saved;
    } catch {
      await this.update({ error: '新输入尚未可靠保存，已保留在当前任务中；恢复存储后再继续。' });
      return false;
    }
  }
  async submitCommand(command: SettingsCommand) {
    if (
      this.preparing ||
      ['submitting', 'networkUnknown', 'sessionChanged'].includes(this.getSnapshot().state)
    )
      return;
    this.preparing = true;
    try {
      const parsed = commandSchema.parse(command);
      const existing = this.getSnapshot();
      const activeDraft =
        this.pendingDraft || (existing.state === 'success' ? null : existing.draft);
      if (activeDraft && commandIdentity(activeDraft) !== commandIdentity(parsed)) {
        await this.update({
          ...(existing.state === 'success' ? {} : { state: 'validationError' as const }),
          error: '已有另一项未完成设置草稿，请先继续或明确放弃该草稿。',
        });
        return;
      }
      const scope = this.getSnapshot().scope;
      if ('householdId' in parsed && parsed.householdId !== scope.householdId)
        throw Error('设置目标家庭与当前任务作用域不同。');
      if (this.getSnapshot().state === 'success') await this.restart(parsed, {});
      else if (!(await this.update({ draft: parsed, state: 'draft', error: '' }))) return;
      this.pendingDraft = null;
      await this.submit(settingsAttempt(parsed, crypto.randomUUID()), (attempt) =>
        this.ports.execute(scope, attempt),
      );
    } catch {
      if (['draft', 'validationError'].includes(this.getSnapshot().state))
        await this.update({
          state: 'validationError',
          error: '设置输入无法保存或不符合当前契约，请核对后重试。',
        });
    } finally {
      this.preparing = false;
    }
  }
  async discardUnsentDraft() {
    const record = this.getSnapshot();
    if (this.preparing || record.attempt || !['draft', 'validationError'].includes(record.state))
      return false;
    const saved = await this.update({ draft: null, state: 'draft', error: '' });
    if (saved) this.pendingDraft = null;
    return saved;
  }
  override async retain() {
    if (this.pendingDraft && !(await this.stageCommand(this.pendingDraft))) return false;
    return super.retain();
  }
  async checkCurrentState() {
    const record = this.getSnapshot();
    if (!record.attempt) return;
    await this.recover(async (attempt) => {
      const result = await this.ports.observe(record.scope, attempt);
      if (!result || result.evidence !== 'current-read')
        throw Object.assign(Error('当前读取仍不能确认目标状态；原请求已保留，不会自动重发。'), {
          code: 'NETWORK',
        });
      return result;
    });
  }
}
