import { z } from 'zod';
import type { NoteTarget } from '../../../../packages/contracts/src/notes';
import type { DateFactPresentation } from '../ui/patterns/types';
import {
  OperationSession,
  validateCommandAttempt,
  type OperationRecord,
} from './operation-session';
import type { CommandAttempt, OperationStorage } from './platform';
import type { ApplicationScope } from './scope';

/** Protocol inputs, independent of a page, fixture world, HTTP, or device transport. */
export type DailyCommandInput =
  | {
      kind: 'opening';
      itemId: string;
      openedAt: string | null;
      correction: boolean;
      reason?: string;
      templateVersion: number;
    }
  | {
      kind: 'dates';
      itemId: string;
      fact: DateFactPresentation;
      originalBasis: string | null;
      templateVersion: number;
      entryId?: string;
      creating: boolean;
      completedOn?: string;
      recurrenceDays?: number | null;
    }
  | {
      kind: 'notes';
      target: NoteTarget;
      noteId?: string;
      title: string | null;
      body?: string;
      redacted?: boolean;
    };

/** Missing identities/fields are capability gaps, never inferred from an array position. */
export function dailyCommand(
  input: DailyCommandInput,
  revisions: Record<string, number>,
  key: string,
): CommandAttempt {
  const targetId = input.kind === 'notes' ? input.target.id : input.itemId;
  if (!Number.isInteger(revisions[targetId]) || revisions[targetId] <= 0)
    throw Error('缺少作用对象的当前版本，请重新读取后核对。');
  const base = { idempotency_key: key, expected_revisions: { [targetId]: revisions[targetId] } };
  if (input.kind === 'notes') {
    if (input.redacted || input.body === undefined) throw Error('正文已隐藏，不能覆盖笔记。');
    if (!input.body.trim()) throw Error('请填写笔记正文；标题可以留空。');
    return validateCommandAttempt({
      operation: input.noteId ? 'update_note' : 'add_note',
      payload: {
        ...base,
        target: input.target,
        ...(input.noteId ? { note_id: input.noteId } : {}),
        title: input.title,
        body: input.body,
      },
    });
  }
  if (input.kind === 'opening') {
    if (
      input.openedAt !== null &&
      !z.iso.datetime({ offset: true }).safeParse(input.openedAt).success
    )
      throw Error('开封时间必须是带时区的有效时间。');
    if (!input.correction && input.openedAt)
      return validateCommandAttempt({
        operation: 'open_item',
        payload: { ...base, item_id: input.itemId, opened_at: input.openedAt },
      });
    if (!input.reason?.trim()) throw Error('修正或明确记录未知开封时间时，请提供原因。');
    return validateCommandAttempt({
      operation: 'correct_item',
      payload: {
        ...base,
        item_id: input.itemId,
        reason: input.reason,
        attributes: [
          {
            template_id: 'lifecycle',
            template_version: input.templateVersion,
            set: {
              'opening.state': 'OPENED',
              ...(input.openedAt ? { 'opening.opened_at': input.openedAt } : {}),
            },
            unset: input.openedAt ? [] : ['opening.opened_at'],
          },
        ],
      },
    });
  }
  if (input.fact.dueOn !== null && !z.iso.date().safeParse(input.fact.dueOn).success)
    throw Error('请填写有效日期。');
  if (input.fact.kind === 'EXPIRY') {
    if (input.fact.source !== 'LIFECYCLE' || input.completedOn)
      throw Error('包装日期不能作为独立期限完成。');
    if (input.fact.basis !== input.originalBasis)
      throw Error('当前生命周期契约不支持修改日期依据；输入已保留，可另记笔记。');
    return validateCommandAttempt({
      operation: 'update_attributes',
      payload: {
        ...base,
        target: { kind: 'ITEM', id: input.itemId },
        template_id: 'lifecycle',
        template_version: input.templateVersion,
        set: {
          ...(input.fact.dueOn ? { 'expiry.date': input.fact.dueOn } : {}),
          ...(input.fact.dateKind ? { 'expiry.date_kind': input.fact.dateKind } : {}),
        },
        unset: [
          ...(input.fact.dueOn ? [] : ['expiry.date']),
          ...(input.fact.dateKind ? [] : ['expiry.date_kind']),
        ],
      },
    });
  }
  if (input.fact.source !== 'DEADLINE') throw Error('日期来源未确认，未生成写入请求。');
  if (!input.creating && !input.entryId)
    throw Error('缺少期限稳定条目 ID，无法安全修改或完成；输入已保留。');
  if (input.completedOn) {
    if (input.creating || !input.entryId) throw Error('尚未保存的期限不能完成。');
    return validateCommandAttempt({
      operation: 'complete_deadline',
      payload: {
        ...base,
        item_id: input.itemId,
        entry_id: input.entryId,
        completed_on: input.completedOn,
      },
    });
  }
  const entry = {
    kind: input.fact.kind,
    due_on: input.fact.dueOn,
    ...(input.fact.basis === null ? {} : { basis: input.fact.basis }),
    ...(input.recurrenceDays === undefined ? {} : { recurrence_days: input.recurrenceDays }),
  };
  return validateCommandAttempt(
    input.creating
      ? { operation: 'add_deadline', payload: { ...base, item_id: input.itemId, entry } }
      : {
          operation: 'update_deadline',
          payload: { ...base, item_id: input.itemId, entry_id: input.entryId, patch: entry },
        },
  );
}

export interface DailyTaskPorts<Draft, Attempt, Result> {
  storage: OperationStorage;
  currentScope(): ApplicationScope;
  validateSaved(value: unknown): value is OperationRecord<Draft, Attempt, Result>;
  freeze(record: OperationRecord<Draft, Attempt, Result>): Attempt;
  execute(scope: ApplicationScope, attempt: Attempt): Promise<Result>;
  recover(scope: ApplicationScope, attempt: Attempt): Promise<Result>;
}

/** Root-owned task; the transport may outlive any route or mode outlet. */
export class DailyTaskController<Draft, Attempt, Result> extends OperationSession<
  Draft,
  Attempt,
  Result
> {
  constructor(
    initial: OperationRecord<Draft, Attempt, Result>,
    private ports: DailyTaskPorts<Draft, Attempt, Result>,
  ) {
    super(initial, ports.storage, ports.currentScope, ports.validateSaved);
  }
  async updateInput(draft: Draft) {
    if (
      ['submitting', 'success', 'networkUnknown', 'revisionConflict', 'sessionChanged'].includes(
        this.getSnapshot().state,
      )
    )
      return false;
    return this.update({ draft, state: 'draft', error: '' });
  }
  async submitDraft() {
    const record = this.getSnapshot();
    if (
      ['submitting', 'success', 'networkUnknown', 'sessionChanged', 'revisionConflict'].includes(
        record.state,
      )
    )
      return;
    let attempt: Attempt;
    try {
      attempt = record.attempt ?? this.ports.freeze(record);
    } catch (error) {
      await this.update({ state: 'validationError', error: String(error) });
      return;
    }
    await this.submit(attempt, (frozen) => this.ports.execute(record.scope, frozen));
  }
  async recoverOriginal() {
    const { scope, attempt } = this.getSnapshot();
    if (!attempt) return;
    await this.recover((frozen) => this.ports.recover(scope, frozen));
  }
}
