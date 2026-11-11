// Isolated settings state. No account transport, device ceremony, password, or invitation token.
import { getTrialScope, isTrial } from '../trial/session';
import { reviewStorage, flushReviewStorage } from '../trial/storage';
import { getFixtureScope } from '../trial/application';
import { sameGeneration, type ApplicationScope } from '../../src/app-vnext/scope';
import { SettingsTaskController, type SettingsCommand } from '../../src/app-vnext/settings-task';
import type {
  AuthStatus,
  CacheSnapshot,
  PrinterPreferences,
  PrinterState,
  SettingsHousehold,
  SettingsIdentity,
  SettingsInvitation,
  SettingsMember,
  SettingsReadState,
  SettingsTask,
  TestPrintState,
} from '../../src/features/settings/pages/settings-pages';
import {
  cacheFor,
  initialAuthStatus,
  invitationsFor,
  membersFor,
  printerDefaults,
  settingsHouseholds,
  settingsIdentity,
  settingsReadState,
  tasksFor,
} from './settings-fixtures';
export interface PreviewSettingsState {
  householdId: string;
  households: SettingsHousehold[];
  identity: SettingsIdentity;
  members: Record<string, SettingsMember[]>;
  invitations: Record<string, SettingsInvitation[]>;
  tasks: SettingsTask[];
  caches: Record<string, CacheSnapshot>;
  scopes: string[];
  requestedWrite: boolean;
  readState: SettingsReadState;
  authStatus: AuthStatus;
  printer: PrinterState;
  printerDraft: PrinterPreferences;
  printerSaved: PrinterPreferences;
  printState: TestPrintState;
}
export function createState(scenario: string): PreviewSettingsState {
  const signedIn = !['login', 'signed-out', 'passkey-cancelled', 'password-error'].includes(
    scenario,
  );
  const households = settingsHouseholds.map((home) => ({ ...home }));
  const members = Object.fromEntries(households.map((home) => [home.id, membersFor(home.id)]));
  return {
    householdId: households[0].id,
    households,
    members,
    identity: {
      ...settingsIdentity,
      passkeys: [...settingsIdentity.passkeys],
      signedIn,
      fresh: scenario !== 'reauth-required',
    },
    invitations: Object.fromEntries(households.map((home) => [home.id, invitationsFor()])),
    tasks: isTrial() ? [] : tasksFor(scenario),
    caches: Object.fromEntries(
      households.map((home) => [
        home.id,
        ['empty', 'offline-empty'].includes(scenario)
          ? { ...cacheFor(home.id), state: 'empty' }
          : cacheFor(home.id),
      ]),
    ),
    scopes: ['inventory:read'],
    requestedWrite: false,
    readState: signedIn ? settingsReadState(scenario) : 'forbidden',
    authStatus: initialAuthStatus(scenario),
    printer: ['device-unavailable', 'unsupported-host', 'host', 'mcp'].includes(scenario)
      ? 'unavailable'
      : 'disconnected',
    printerDraft: { ...printerDefaults },
    printerSaved: { ...printerDefaults },
    printState: 'idle',
  };
}
// The workbench remains an in-memory fixture. Trial settings use the shared
// account-global durable adapter and are never imported from review snapshots.
const previewSessions = new Map<string, PreviewSettingsState>();
export interface SettingsSnapshot {
  contextKey: string;
  state: PreviewSettingsState;
  raw: string | null | undefined;
  error?: string;
  incompatible?: boolean;
}
export function settingsContext(scenario: string): string {
  if (!isTrial()) return `review:${scenario}:${previewGenerations.get(scenario) || 0}`;
  const scope = getTrialScope();
  return JSON.stringify([
    scope.accountId,
    scope.householdId,
    scope.signedIn,
    scope.generation,
    scenario,
  ]);
}
function validState(value: unknown): value is PreviewSettingsState {
  if (!value || typeof value !== 'object') return false;
  const state = value as PreviewSettingsState;
  const ids = settingsHouseholds.map((home) => home.id);
  const preferences = (entry: PrinterPreferences) =>
    entry &&
    ['40x30', '50x30'].includes(entry.paper) &&
    ['1', '2', '3'].includes(entry.density) &&
    ['1', '2', '3'].includes(entry.copies);
  return (
    ids.includes(state.householdId) &&
    Array.isArray(state.households) &&
    state.households.length === ids.length &&
    ids.every((id) =>
      state.households.some(
        (home) => home.id === id && typeof home.name === 'string' && !('role' in home),
      ),
    ) &&
    !!state.identity &&
    typeof state.identity.name === 'string' &&
    typeof state.identity.email === 'string' &&
    typeof state.identity.signedIn === 'boolean' &&
    typeof state.identity.passwordConfigured === 'boolean' &&
    Array.isArray(state.identity.passkeys) &&
    state.identity.passkeys.every(
      (key) => typeof key.id === 'string' && typeof key.name === 'string',
    ) &&
    new Set(state.identity.passkeys.map((key) => key.id)).size === state.identity.passkeys.length &&
    typeof state.identity.fresh === 'boolean' &&
    !!state.members &&
    ids.every(
      (id) =>
        Array.isArray(state.members[id]) &&
        state.members[id].every(
          (member) =>
            typeof member.id === 'string' &&
            typeof member.name === 'string' &&
            typeof member.email === 'string' &&
            typeof member.self === 'boolean' &&
            !('role' in member),
        ),
    ) &&
    !!state.invitations &&
    ids.every(
      (id) =>
        Array.isArray(state.invitations[id]) &&
        state.invitations[id].every(
          (invite) =>
            typeof invite.id === 'string' &&
            typeof invite.label === 'string' &&
            !('role' in invite) &&
            ['pending', 'revoked', 'expired', 'used'].includes(invite.state),
        ),
    ) &&
    Array.isArray(state.tasks) &&
    state.tasks.every(
      (task) =>
        typeof task.id === 'string' &&
        typeof task.title === 'string' &&
        ids.includes(task.householdId) &&
        ['draft', 'unknown', 'confirmed'].includes(task.state),
    ) &&
    !!state.caches &&
    ids.every((id) => {
      const entry = state.caches[id];
      return (
        entry &&
        ['available', 'empty'].includes(entry.state) &&
        typeof entry.updatedAt === 'string' &&
        [entry.itemCount, entry.catalogCount, entry.historyCount].every(
          (count) => Number.isFinite(count) && count >= 0,
        )
      );
    }) &&
    Array.isArray(state.scopes) &&
    state.scopes.every((scope) => ['inventory:read', 'inventory:write'].includes(scope)) &&
    typeof state.requestedWrite === 'boolean' &&
    ['ready', 'loading', 'error', 'forbidden'].includes(state.readState) &&
    [
      'idle',
      'passkey-cancelled',
      'password-error',
      'email-waiting',
      'email-failed',
      'recovery-complete',
      'invite-expired',
      'invite-accepted',
      'allowed',
      'denied',
      'reauthorization-required',
    ].includes(state.authStatus) &&
    ['disconnected', 'unavailable', 'connected'].includes(state.printer) &&
    preferences(state.printerDraft) &&
    preferences(state.printerSaved) &&
    ['idle', 'sent', 'confirmed', 'failed'].includes(state.printState)
  );
}
export function loadSettings(scenario: string, contextKey: string): SettingsSnapshot {
  if (!isTrial()) {
    const state = previewSessions.get(scenario) || createState(scenario);
    previewSessions.set(scenario, state);
    return { contextKey, state, raw: null };
  }
  const scope = getTrialScope();
  let state = createState(scenario),
    raw: string | null | undefined;
  let error: string | undefined,
    incompatible = false,
    storedGeneration = scope.generation;
  try {
    raw = reviewStorage.getItem(`settings-state-v2:${scenario}`);
    if (raw === null && reviewStorage.getItem(`settings-state:${scenario}`) !== null) {
      incompatible = true;
      throw Error('旧设置包含未经确认的角色或凭据模型，原记录已保留。');
    }
    if (raw !== null) {
      const stored = JSON.parse(raw);
      if (
        stored.schemaVersion !== 2 ||
        stored.accountId !== scope.accountId ||
        !Number.isInteger(stored.generation) ||
        !validState(stored.state)
      ) {
        incompatible = true;
        throw new Error('incompatible');
      }
      state = stored.state;
      storedGeneration = stored.generation;
    }
  } catch {
    incompatible = incompatible || typeof raw === 'string';
    error = incompatible
      ? '已有试用设置的版本或内容无法读取，原数据已保留。请在试用工具中处理或明确重置后再保存。'
      : '试用设置暂时无法读取；当前只显示初始样例，保存成功前不会提交更改。';
  }
  const scopeChanged =
    state.householdId !== scope.householdId || storedGeneration !== scope.generation;
  state = {
    ...state,
    householdId: scope.householdId,
    identity: { ...state.identity, signedIn: scope.signedIn },
    readState: !scope.signedIn
      ? 'forbidden'
      : !state.identity.signedIn
        ? settingsReadState(scenario)
        : state.readState,
    ...(scopeChanged || !scope.signedIn
      ? {
          scopes: [],
          requestedWrite: false,
          authStatus: 'reauthorization-required' as const,
          caches: {
            ...state.caches,
            [scope.householdId]: { ...state.caches[scope.householdId], state: 'empty' as const },
          },
        }
      : {}),
  };
  return { contextKey, state, raw, error, incompatible };
}
const previewGenerations = new Map<string, number>();
export function settingsScope(scenario: string): ApplicationScope {
  const scope = getFixtureScope();
  if (isTrial()) return scope;
  return {
    ...scope,
    householdId: previewSessions.get(scenario)?.householdId || settingsHouseholds[0].id,
    generation: previewGenerations.get(scenario) || 0,
  };
}
const listeners = new Set<() => void>();
let revision = 0;
export const subscribeSettings = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const settingsRevision = () => revision;
function publish() {
  revision++;
  listeners.forEach((listener) => listener());
}
export function commitSettings(
  scenario: string,
  previous: SettingsSnapshot,
  next: PreviewSettingsState,
): SettingsSnapshot {
  if (settingsContext(scenario) !== previous.contextKey)
    throw Error('家庭或会话已变化，请重新读取。');
  if (previous.incompatible || !validState(next)) throw Error('设置无法安全保存，原记录已保留。');
  let raw: string | null = null;
  if (isTrial()) {
    if (reviewStorage.getItem(`settings-state-v2:${scenario}`) !== (previous.raw ?? null))
      throw Error('另一页面已更新设置，请重新读取后核对。');
    const scope = getTrialScope();
    raw = JSON.stringify({
      schemaVersion: 2,
      accountId: scope.accountId,
      generation: scope.generation,
      state: next,
    });
    reviewStorage.setItem(`settings-state-v2:${scenario}`, raw);
  } else {
    if (
      previous.state.householdId !== next.householdId ||
      previous.state.identity.signedIn !== next.identity.signedIn
    )
      previewGenerations.set(scenario, (previewGenerations.get(scenario) || 0) + 1);
    previewSessions.set(scenario, next);
  }
  const snapshot = { contextKey: previous.contextKey, state: next, raw };
  publish();
  return snapshot;
}
function assertScope(scope: ApplicationScope, scenario: string) {
  if (!sameGeneration(scope, settingsScope(scenario)))
    throw Object.assign(Error('会话已变化。'), { code: 'SESSION_CHANGED' });
}
function readState(scope: ApplicationScope, scenario: string) {
  assertScope(scope, scenario);
  const snapshot = loadSettings(scenario, settingsContext(scenario));
  if (snapshot.incompatible || snapshot.error) throw Error('设置原记录无法安全读取，未执行请求。');
  if (!snapshot.state.identity.signedIn || snapshot.state.readState !== 'ready')
    throw Object.assign(Error('当前会话不能修改设置。'), { code: 'FORBIDDEN' });
  return snapshot;
}
function matches(state: PreviewSettingsState, command: SettingsCommand) {
  if (command.kind === 'rename-household')
    return state.households.find((home) => home.id === command.householdId)?.name === command.name;
  if (command.kind === 'revoke-invitation')
    return state.invitations[command.householdId]?.some(
      (invite) => invite.id === command.invitationId && invite.state === 'revoked',
    );
  if (command.kind === 'remove-password') return !state.identity.passwordConfigured;
  const key = state.identity.passkeys.find((key) => key.id === command.passkeyId);
  return command.kind === 'remove-passkey' ? !key : key?.name === command.name;
}
function apply(state: PreviewSettingsState, command: SettingsCommand): PreviewSettingsState {
  const next = structuredClone(state);
  if ('householdId' in command && command.householdId !== state.householdId)
    throw Object.assign(Error('原家庭已不可用。'), { code: 'FORBIDDEN' });
  if (command.kind === 'rename-household') {
    if (!state.households.some((home) => home.id === command.householdId))
      throw Object.assign(Error('家庭不存在。'), { code: 'NOT_FOUND' });
    next.households = next.households.map((home) =>
      home.id === command.householdId ? { ...home, name: command.name } : home,
    );
  } else if (command.kind === 'revoke-invitation') {
    if (
      !state.invitations[command.householdId]?.some((invite) => invite.id === command.invitationId)
    )
      throw Object.assign(Error('邀请不存在。'), { code: 'NOT_FOUND' });
    next.invitations[command.householdId] = next.invitations[command.householdId].map((invite) =>
      invite.id === command.invitationId ? { ...invite, state: 'revoked' } : invite,
    );
  } else {
    if (!state.identity.fresh)
      throw Object.assign(Error('请先重新验证身份。'), { code: 'FORBIDDEN' });
    if (command.kind === 'remove-password') {
      if (!state.identity.passkeys.length)
        throw Object.assign(Error('不能移除最后一种登录方式。'), { code: 'FORBIDDEN' });
      next.identity.passwordConfigured = false;
    } else {
      const key = state.identity.passkeys.find((key) => key.id === command.passkeyId);
      if (!key) throw Object.assign(Error('未找到这枚通行密钥。'), { code: 'NOT_FOUND' });
      if (command.kind === 'remove-passkey') {
        if (!state.identity.passwordConfigured && state.identity.passkeys.length === 1)
          throw Object.assign(Error('不能移除最后一种登录方式。'), { code: 'FORBIDDEN' });
        next.identity.passkeys = next.identity.passkeys.filter(
          (key) => key.id !== command.passkeyId,
        );
      } else
        next.identity.passkeys = next.identity.passkeys.map((key) =>
          key.id === command.passkeyId ? { ...key, name: command.name } : key,
        );
    }
  }
  return next;
}
export function createSettingsFixtureTask(taskId: string, scenario: string) {
  return new SettingsTaskController(settingsScope(scenario), taskId, {
    currentScope: () => settingsScope(scenario),
    storage: {
      load(scope, key) {
        assertScope(scope, scenario);
        const raw = reviewStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      },
      async save(scope, key, value) {
        assertScope(scope, scenario);
        reviewStorage.setItem(key, JSON.stringify(value));
        await flushReviewStorage();
        assertScope(scope, scenario);
      },
    },
    async execute(scope, attempt) {
      const snapshot = readState(scope, scenario);
      if (
        ['mcp', 'host', 'unsupported-host', 'offline', 'offline-partial', 'offline-empty'].includes(
          scenario,
        )
      )
        throw Object.assign(Error('当前连接不支持账号设置写入。'), { code: 'FORBIDDEN' });
      commitSettings(scenario, snapshot, apply(snapshot.state, attempt.command));
      await flushReviewStorage();
      assertScope(scope, scenario);
      if (scenario === 'unknown' || scenario === 'network-unknown')
        throw Object.assign(Error('设置响应未收到。'), { code: 'NETWORK' });
      return { evidence: 'response', description: '隔离设置已保存；真实账号未改变。' };
    },
    async observe(scope, attempt) {
      const snapshot = readState(scope, scenario);
      return matches(snapshot.state, attempt.command)
        ? {
            evidence: 'current-read',
            description: '重新读取的隔离设置与目标一致；原请求回执仍未知，未重发写入。',
          }
        : null;
    },
  });
}
