import { describe, expect, it } from 'vitest';
import { OperationSession, type OperationRecord } from './operation-session';
import type { ApplicationScope } from './scope';
import type { OperationStorage } from './platform';

type Record = OperationRecord<{ amount: string }, { key: string; amount: string }, string>;
const scope: ApplicationScope = {
  environment: 'test',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web',
  datasetId: 'd',
  generation: 0,
};
const initial = (): Record => ({
  version: 1,
  scope,
  taskId: 'consume:1',
  targetIds: ['item:1'],
  original: { amount: '' },
  draft: { amount: '1' },
  revisions: { 'item:1': 1 },
  attempt: null,
  result: null,
  state: 'draft',
  reviewing: true,
  approval: null,
  error: '',
});
const valid = (value: unknown): value is Record => !!value && (value as Record).version === 1;
const attempt = { key: 'same-request', amount: '1' };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('root operation session', () => {
  it('rejects a different task stored under the requested key without overwriting or sending', async () => {
    const saved = { ...initial(), taskId: 'consume:other', targetIds: ['item:other'], attempt };
    let writes = 0;
    let sends = 0;
    const session = new OperationSession(
      initial(),
      {
        load: () => saved,
        save: () => {
          writes++;
        },
      },
      () => scope,
      valid,
    );
    expect(session.getSnapshot().taskId).toBe('consume:1');
    expect(session.getSnapshot().targetIds).toEqual(['item:1']);
    expect(session.getSnapshot().state).toBe('validationError');
    expect(await session.update({ draft: { amount: '2' } })).toBe(false);
    await session.submit(attempt, async () => {
      sends++;
      return 'receipt';
    });
    await session.recover(async () => {
      sends++;
      return 'receipt';
    });
    expect(writes).toBe(0);
    expect(sends).toBe(0);
    expect(saved.taskId).toBe('consume:other');
  });
  it('adopts a reread before a request but never replaces an uncertain attempt', async () => {
    const session = new OperationSession(
      initial(),
      { load: () => null, save: () => {} },
      () => scope,
      valid,
    );
    expect(await session.refreshDraft({ amount: '2' }, { 'item:1': 4 }, { amount: '3' })).toBe(
      true,
    );
    expect(session.getSnapshot().revisions['item:1']).toBe(4);
    expect(session.getSnapshot().draft.amount).toBe('2');
    await session.submit(attempt, async () => {
      throw Error('lost response');
    });
    expect(await session.refreshDraft({ amount: '9' }, { 'item:1': 5 }, { amount: '9' })).toBe(
      false,
    );
    expect(session.getSnapshot().attempt).toEqual(attempt);
    expect(session.getSnapshot().revisions['item:1']).toBe(4);
  });

  it('keeps the original baseline if saving a reread fails', async () => {
    const session = new OperationSession(
      initial(),
      {
        load: () => null,
        save: () => {
          throw Error('disk full');
        },
      },
      () => scope,
      valid,
    );
    expect(await session.refreshDraft({ amount: '2' }, { 'item:1': 4 }, { amount: '3' })).toBe(
      false,
    );
    expect(session.getSnapshot().revisions['item:1']).toBe(1);
    expect(session.getSnapshot().draft.amount).toBe('1');
  });

  it('does not send when durable persistence fails', async () => {
    let sends = 0;
    const session = new OperationSession(
      initial(),
      {
        load: () => null,
        save: () => {
          throw Error('disk full');
        },
      },
      () => scope,
      valid,
    );
    await session.submit(attempt, async () => {
      sends++;
      return 'receipt';
    });
    expect(sends).toBe(0);
    expect(session.getSnapshot().attempt).toEqual(attempt);
    expect(session.getSnapshot().attemptStatus).toBe('unsent');
  });

  it('serializes an outstanding draft save before the frozen dispatch snapshot', async () => {
    const gate = deferred();
    const events: string[] = [];
    let count = 0;
    const storage: OperationStorage = {
      load: () => null,
      save: async (_scope, _key, value) => {
        if (++count === 1) await gate.promise;
        events.push((value as Record).state);
      },
    };
    const session = new OperationSession(initial(), storage, () => scope, valid);
    const update = session.update({ draft: { amount: '2' } });
    const submitted = session.submit({ ...attempt, amount: '2' }, async () => {
      events.push('send');
      return 'receipt';
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    gate.resolve();
    await Promise.all([update, submitted]);
    expect(events).toEqual(['draft', 'submitting', 'send', 'success']);
  });

  it('retains an uncertain attempt and only recovers the immutable original', async () => {
    const session = new OperationSession(
      initial(),
      { load: () => null, save: () => {} },
      () => scope,
      valid,
    );
    const outgoing = { ...attempt };
    await session.submit(outgoing, async () => {
      throw Object.assign(Error('lost'), { code: 'NETWORK' });
    });
    outgoing.amount = '999';
    expect(await session.update({ draft: { amount: '999' } })).toBe(false);
    let sends = 0;
    await session.submit({ key: 'replacement', amount: '999' }, async () => {
      sends++;
      return 'wrong';
    });
    expect(sends).toBe(0);
    await session.recover(async (original) => {
      expect(original).toEqual(attempt);
      expect(Object.isFrozen(original)).toBe(true);
      return 'original receipt';
    });
    expect(session.getSnapshot().result).toBe('original receipt');
  });

  it('isolates old-generation responses and reloads the original pending attempt', async () => {
    let current = scope;
    let saved: unknown = null;
    const storage = {
      load: () => saved,
      save: (_scope: ApplicationScope, _key: string, value: unknown) => {
        saved = structuredClone(value);
      },
    };
    const session = new OperationSession(initial(), storage, () => current, valid);
    await session.submit(attempt, async () => {
      current = { ...scope, householdId: 'other', generation: 1 };
      return 'late receipt';
    });
    expect(session.getSnapshot().state).toBe('sessionChanged');
    expect((saved as Record).state).toBe('submitting');
    current = { ...scope, generation: 2 };
    const recovered = new OperationSession(
      { ...initial(), scope: current },
      storage,
      () => current,
      valid,
    );
    expect(recovered.getSnapshot().state).toBe('networkUnknown');
    expect(recovered.getSnapshot().attempt).toEqual(attempt);
  });

  it('retains conflict input until explicit reconciliation with a new read baseline', async () => {
    const session = new OperationSession(
      initial(),
      { load: () => null, save: () => {} },
      () => scope,
      valid,
    );
    await session.submit(attempt, async () => {
      throw Object.assign(Error('changed'), { code: 'REVISION_CONFLICT', status: 409 });
    });
    expect(session.getSnapshot().draft.amount).toBe('1');
    expect(session.getSnapshot().state).toBe('revisionConflict');
    await session.reconcile({ amount: '1' }, { 'item:1': 2 }, { amount: '0.5' });
    expect(session.getSnapshot().original.amount).toBe('0.5');
    expect(session.getSnapshot().revisions['item:1']).toBe(2);
    expect(session.getSnapshot().attempt).toBeNull();
  });
  it('treats a failed receipt save as uncertain even for a numeric DOMException code', async () => {
    const session = new OperationSession(
      initial(),
      {
        load: () => null,
        save: (_scope, _key, value) => {
          if ((value as Record).state === 'success')
            throw new DOMException('quota', 'QuotaExceededError');
        },
      },
      () => scope,
      valid,
    );
    await session.submit(attempt, async () => 'server committed');
    expect(session.getSnapshot().state).toBe('networkUnknown');
    expect(session.getSnapshot().attemptStatus).toBe('uncertain');
    expect(await session.update({ draft: { amount: '2' } })).toBe(false);
    expect(session.getSnapshot().attempt).toEqual(attempt);
  });

  it('blocks retaining after draft persistence fails and permits it after storage recovers', async () => {
    let available = false;
    const session = new OperationSession(
      initial(),
      {
        load: () => null,
        save: () => {
          if (!available) throw Error('quota');
        },
      },
      () => scope,
      valid,
    );
    await session.update({ draft: { amount: '2' } });
    expect(await session.retain()).toBe(false);
    expect(session.hasUnpersisted()).toBe(true);
    available = true;
    expect(await session.retain()).toBe(true);
  });

  it('starts the next task from the newly read revision after success', async () => {
    const session = new OperationSession(
      initial(),
      { load: () => null, save: () => {} },
      () => scope,
      valid,
    );
    await session.submit(attempt, async () => 'receipt');
    await session.restart({ amount: '' }, { 'item:1': 2 });
    expect(session.getSnapshot().revisions['item:1']).toBe(2);
    expect(session.getSnapshot().attempt).toBeNull();
  });
  it.each([408, 429, 400, 403])(
    'keeps proxy/unknown HTTP %s responses uncertain',
    async (status) => {
      const session = new OperationSession(
        initial(),
        { load: () => null, save: () => {} },
        () => scope,
        valid,
      );
      await session.submit(attempt, async () => {
        throw Object.assign(Error('proxy response'), { status, code: 'UPSTREAM_ERROR' });
      });
      expect(session.getSnapshot().state).toBe('networkUnknown');
      expect(session.getSnapshot().attemptStatus).toBe('uncertain');
    },
  );
});
