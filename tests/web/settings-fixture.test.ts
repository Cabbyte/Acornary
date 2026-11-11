import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationScope } from '../../apps/web/src/app-vnext/scope.js';
const fake = vi.hoisted(() => ({
  values: new Map<string, string>(),
  scope: {
    environment: 'isolated-trial',
    accountId: 'a',
    householdId: 'preview-home-wutong',
    clientId: 'web-review',
    datasetId: 'trial-rc1-v1',
    generation: 1,
  } as ApplicationScope,
  fail: false,
  writes: [] as string[],
}));
vi.mock('../../apps/web/review/trial/session', () => ({
  getTrialScope: () => ({ ...fake.scope, signedIn: true, role: 'viewer' }),
  isTrial: () => true,
}));
vi.mock('../../apps/web/review/trial/application', () => ({ getFixtureScope: () => fake.scope }));
vi.mock('../../apps/web/review/trial/storage', () => ({
  reviewStorage: {
    getItem: (key: string) => fake.values.get(`${fake.scope.accountId}:${key}`) ?? null,
    setItem: (key: string, value: string) => {
      if (fake.fail) throw Error('storage full');
      fake.writes.push(key);
      fake.values.set(`${fake.scope.accountId}:${key}`, value);
    },
  },
  flushReviewStorage: async () => {},
}));
import {
  createSettingsFixtureTask,
  createState,
  loadSettings,
  settingsContext,
  commitSettings,
} from '../../apps/web/review/pages/settings-state.js';
import { settingsHouseholds, membersFor } from '../../apps/web/review/pages/settings-fixtures.js';
const id = 'acornary-review-settings-task-v1:preview-home-wutong:default';
beforeEach(() => {
  fake.values.clear();
  fake.writes = [];
  fake.fail = false;
  fake.scope = {
    ...fake.scope,
    accountId: 'a',
    householdId: 'preview-home-wutong',
    generation: fake.scope.generation + 1,
  };
});
const read = (scenario = 'default') => loadSettings(scenario, settingsContext(scenario));

describe('settings fixture identity and persistence boundary', () => {
  it('has equal membership and no invented role or role assignment model', () => {
    expect(settingsHouseholds.every((home) => !('role' in home))).toBe(true);
    expect(membersFor('preview-home-wutong').every((member) => !('role' in member))).toBe(true);
    const task = createSettingsFixtureTask(id, 'default');
    // A read-only inventory connection is not a different household membership role.
    return task
      .submitCommand({
        kind: 'rename-household',
        householdId: fake.scope.householdId,
        name: '共同的家',
      })
      .then(() => {
        expect(task.getSnapshot().state).toBe('success');
        expect(read().state.households[0].name).toBe('共同的家');
      });
  });
  it('uses a stable passkey ID and permits duplicate human-readable names', async () => {
    const snapshot = read();
    commitSettings('default', snapshot, {
      ...snapshot.state,
      identity: {
        ...snapshot.state.identity,
        passkeys: [
          { id: 'first-id', name: '设备' },
          { id: 'second-id', name: '设备' },
        ],
      },
    });
    const task = createSettingsFixtureTask(id, 'default');
    await task.submitCommand({ kind: 'rename-passkey', passkeyId: 'second-id', name: '新名称' });
    expect(read().state.identity.passkeys).toEqual([
      { id: 'first-id', name: '设备' },
      { id: 'second-id', name: '新名称' },
    ]);
  });
  it('cannot remove the last login method or edit without fresh authentication', async () => {
    const snapshot = read();
    commitSettings('default', snapshot, {
      ...snapshot.state,
      identity: { ...snapshot.state.identity, passwordConfigured: false },
    });
    const task = createSettingsFixtureTask(id, 'default');
    await task.submitCommand({ kind: 'remove-passkey', passkeyId: 'preview-passkey-device' });
    expect(task.getSnapshot().state).toBe('forbidden');
    expect(read().state.identity.passkeys).toHaveLength(1);
    const stale = createSettingsFixtureTask(`${id}:stale`, 'reauth-required');
    await stale.submitCommand({
      kind: 'rename-passkey',
      passkeyId: 'preview-passkey-device',
      name: 'changed',
    });
    expect(stale.getSnapshot().state).toBe('forbidden');
    expect(read('reauth-required').state.identity.passkeys[0].name).not.toBe('changed');
  });
  it('checks current state after lost response without repeating an account mutation', async () => {
    const task = createSettingsFixtureTask(id, 'unknown');
    await task.submitCommand({
      kind: 'rename-household',
      householdId: fake.scope.householdId,
      name: '已发生的改名',
    });
    expect(task.getSnapshot().state).toBe('networkUnknown');
    const writes = fake.writes.filter((key) => key === 'settings-state-v2:unknown').length;
    const restored = createSettingsFixtureTask(id, 'unknown');
    await restored.checkCurrentState();
    expect(restored.getSnapshot().result?.evidence).toBe('current-read');
    expect(fake.writes.filter((key) => key === 'settings-state-v2:unknown')).toHaveLength(writes);
  });
  it('retains an uncertain request if current facts no longer match its target', async () => {
    const task = createSettingsFixtureTask(id, 'unknown');
    await task.submitCommand({
      kind: 'rename-household',
      householdId: fake.scope.householdId,
      name: '原目标',
    });
    const current = read('unknown');
    commitSettings('unknown', current, {
      ...current.state,
      households: current.state.households.map((home) =>
        home.id === fake.scope.householdId ? { ...home, name: '后来修改' } : home,
      ),
    });
    await task.checkCurrentState();
    expect(task.getSnapshot().state).toBe('networkUnknown');
    expect(read('unknown').state.households[0].name).toBe('后来修改');
  });
  it('preserves legacy role/credential envelopes and malformed new state without reinterpretation', () => {
    const legacy = JSON.stringify({ schemaVersion: 1, state: { households: [{ role: 'owner' }] } });
    fake.values.set('a:settings-state:default', legacy);
    const loaded = read();
    expect(loaded.incompatible).toBe(true);
    expect(() => commitSettings('default', loaded, createState('default'))).toThrow();
    expect(fake.values.get('a:settings-state:default')).toBe(legacy);
    fake.values.set('a:settings-state-v2:default', '{bad');
    expect(read().incompatible).toBe(true);
    expect(fake.values.get('a:settings-state-v2:default')).toBe('{bad');
  });
  it('does not change settings on storage failure or after account generation changes', async () => {
    const task = createSettingsFixtureTask(id, 'default');
    fake.fail = true;
    await task.submitCommand({ kind: 'remove-password' });
    expect(fake.writes).toHaveLength(0);
    fake.fail = false;
    fake.scope = { ...fake.scope, accountId: 'other', generation: fake.scope.generation + 1 };
    await task.submitCommand({ kind: 'remove-password' });
    expect(read().state.identity.passwordConfigured).toBe(true);
    expect(fake.writes).toHaveLength(0);
  });
});
