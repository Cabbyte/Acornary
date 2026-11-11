import { describe, expect, it } from 'vitest';
import {
  SettingsTaskController,
  settingsAttempt,
  validSettingsTask,
  type SettingsCommand,
  type SettingsTaskRecord,
} from '../../apps/web/src/app-vnext/settings-task.js';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope.js';
const scope: ApplicationScope = {
  environment: 'test',
  accountId: 'a',
  householdId: 'h',
  clientId: 'web',
  datasetId: 'd',
  generation: 1,
};
const rename: SettingsCommand = {
  kind: 'rename-passkey',
  passkeyId: 'credential-id',
  name: '我的设备',
};
function setup(
  options: { diskFailure?: boolean; loseResponse?: boolean; observation?: boolean } = {},
) {
  let current = scope;
  let saved: unknown;
  const events: string[] = [];
  const task = new SettingsTaskController(scope, 'settings', {
    currentScope: () => current,
    storage: {
      load: () => null,
      save: (_scope, _id, record) => {
        if (options.diskFailure) throw Error('disk');
        saved = structuredClone(record);
        events.push((record as SettingsTaskRecord).state);
      },
    },
    execute: async (_scope, attempt) => {
      expect(attempt.request.body).not.toHaveProperty('idempotency_key');
      events.push('POST');
      if (options.loseResponse) throw Object.assign(Error('lost'), { code: 'NETWORK' });
      return { evidence: 'response', description: 'saved' };
    },
    observe: async () => {
      events.push('GET');
      return options.observation
        ? {
            evidence: 'current-read',
            description: 'current facts match; original response unknown',
          }
        : null;
    },
  });
  return {
    task,
    events,
    saved: () => saved,
    switchScope: () => {
      current = { ...scope, generation: 2 };
    },
  };
}
describe('settings account protocol', () => {
  it('maps stable credential ID, permits duplicate labels, and sends no invented inventory fields', () => {
    expect(settingsAttempt(rename, 'local-journal-id')).toEqual({
      localId: 'local-journal-id',
      command: rename,
      request: { path: 'account/passkey/update', body: { id: 'credential-id', name: '我的设备' } },
    });
    expect(settingsAttempt({ kind: 'remove-password' }, 'local').request).toEqual({
      path: 'account/password',
      body: { password: null },
    });
    expect(
      settingsAttempt({ kind: 'revoke-invitation', householdId: 'h', invitationId: 'i' }, 'local')
        .request.body,
    ).toEqual({ action: 'revoke', household_id: 'h', invitation_id: 'i' });
  });
  it('rejects password/token input and unknown role mutations before persistence', async () => {
    const { task, events } = setup();
    for (const invalid of [
      { kind: 'remove-password', password: 'secret' },
      { kind: 'rename-household', householdId: 'h', name: '家', token: 'secret' },
      { kind: 'set-role', role: 'admin' },
    ]) {
      expect(() => settingsAttempt(invalid as SettingsCommand, 'local')).toThrow();
      await task.submitCommand(invalid as SettingsCommand);
    }
    expect(events).not.toContain('POST');
    expect(JSON.stringify(task.getSnapshot())).not.toContain('secret');
  });
  it('saves original safe request before POST and never sends when durable storage fails', async () => {
    const good = setup();
    await good.task.submitCommand(rename);
    expect(good.events).toEqual(['draft', 'submitting', 'POST', 'success']);
    const bad = setup({ diskFailure: true });
    await bad.task.submitCommand(rename);
    expect(bad.events).not.toContain('POST');
    expect(bad.task.getSnapshot().draft).toEqual(rename);
  });
  it('uses read-only observation for uncertain POST without replacing or resending it', async () => {
    const { task, events } = setup({ loseResponse: true, observation: true });
    await task.submitCommand(rename);
    const original = task.getSnapshot().attempt;
    await task.submitCommand({ kind: 'remove-password' });
    await task.checkCurrentState();
    expect(events.filter((event) => event === 'POST')).toHaveLength(1);
    expect(events.filter((event) => event === 'GET')).toHaveLength(1);
    expect(task.getSnapshot().attempt).toEqual(original);
    expect(task.getSnapshot().result?.evidence).toBe('current-read');
  });
  it('keeps unresolved readback unknown and refuses cross-household commands', async () => {
    const { task, events } = setup({ loseResponse: true });
    await task.submitCommand(rename);
    await task.checkCurrentState();
    expect(task.getSnapshot().state).toBe('networkUnknown');
    expect(events.filter((event) => event === 'POST')).toHaveLength(1);
    const other = setup();
    await other.task.submitCommand({
      kind: 'rename-household',
      householdId: 'other',
      name: 'wrong',
    });
    expect(other.events).not.toContain('POST');
  });
  it('rejects stale generations and malformed saved attempts including secret result fields', async () => {
    const { task, switchScope, events } = setup();
    switchScope();
    await task.submitCommand(rename);
    expect(events).not.toContain('POST');
    const good = setup();
    await good.task.submitCommand(rename);
    const record = good.saved() as SettingsTaskRecord;
    expect(validSettingsTask(record, record)).toBe(true);
    expect(
      validSettingsTask(
        {
          ...record,
          attempt: {
            ...record.attempt,
            request: { path: 'account/password', body: { password: 'secret' } },
          },
        },
        record,
      ),
    ).toBe(false);
    expect(
      validSettingsTask(
        { ...record, result: { ...record.result, access_token: 'secret' } },
        record,
      ),
    ).toBe(false);
  });
});

describe('settings safe draft retention', () => {
  it('persists incomplete non-secret input and requires explicit discard before another task', async () => {
    const { task, events, saved } = setup();
    await task.stageCommand({ ...rename, name: '' });
    expect(task.getSnapshot().draft).toEqual({ ...rename, name: '' });
    expect(validSettingsTask(saved(), saved() as SettingsTaskRecord)).toBe(true);
    expect(events).not.toContain('POST');
    expect(await task.stageCommand({ kind: 'remove-password' })).toBe(false);
    expect(task.getSnapshot().draft?.kind).toBe('rename-passkey');
    expect(await task.discardUnsentDraft()).toBe(true);
    expect(await task.stageCommand({ kind: 'remove-password' })).toBe(true);
  });
  it('retains a first edit after success when restarting storage fails without rejecting the UI promise', async () => {
    const options = { diskFailure: false };
    const { task, events } = setup(options);
    await task.submitCommand(rename);
    options.diskFailure = true;
    expect(await task.stageCommand({ ...rename, name: '未保存的新名称' })).toBe(false);
    expect(task.stagedCommand()).toEqual({ ...rename, name: '未保存的新名称' });
    expect(task.hasUnpersisted()).toBe(true);
    expect(await task.retain()).toBe(false);
    expect(await task.stageCommand({ kind: 'remove-password' })).toBe(false);
    expect(task.stagedCommand()).toEqual({ ...rename, name: '未保存的新名称' });
    options.diskFailure = false;
    await task.submitCommand({ kind: 'remove-password' });
    expect(task.stagedCommand()).toEqual({ ...rename, name: '未保存的新名称' });
    expect(task.getSnapshot().state).toBe('success');
    expect(task.hasUnpersisted()).toBe(true);
    expect(events.filter((event) => event === 'POST')).toHaveLength(1);
    expect(await task.retain()).toBe(true);
    expect(task.getSnapshot().draft).toEqual({ ...rename, name: '未保存的新名称' });
    expect(task.hasUnpersisted()).toBe(false);
    expect(events.filter((event) => event === 'POST')).toHaveLength(1);
  });
});
