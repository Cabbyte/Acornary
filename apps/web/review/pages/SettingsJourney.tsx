import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  getTrialScope,
  isTrial,
  subscribeTrialScope,
  switchTrialHousehold,
  setTrialSignedIn,
} from '../trial/session';
import { pendingTrialTasks } from '../trial/storage';
import { safePagePath } from './catalog';
import {
  AccountSettingsPage,
  CacheSettingsPage,
  HouseholdSettingsPage,
  MemberSettingsPage,
  PrintingSettingsPage,
  SettingsInspector,
  SettingsOverview,
  type AuthStatus,
  type AuthView,
  type CredentialIntent,
  type MemberIntent,
  type SettingsNotice,
  type SettingsTask,
} from '../../src/features/settings/pages/settings-pages';
import { cacheFor, inspectorRecords } from './settings-fixtures';

import {
  loadSettings,
  settingsContext,
  subscribeSettings,
  settingsRevision,
  settingsScope,
  commitSettings,
  createSettingsFixtureTask,
  type PreviewSettingsState,
} from './settings-state';
import { useOperationSessions } from '../../src/app-vnext/operation-context';
import type { SettingsCommand } from '../../src/app-vnext/settings-task';
function safeReturnPath(raw: string | null): string {
  const safe = safePagePath(raw);
  if (!safe) return '/settings';
  try {
    const parsed = new URL(safe, 'https://preview.invalid');
    return parsed.origin === 'https://preview.invalid'
      ? parsed.pathname + parsed.search
      : '/settings';
  } catch {
    return '/settings';
  }
}
function authViewFor(value: string | null, scenario: string, signedIn: boolean): AuthView {
  if (value && ['account', 'login', 'oauth', 'host', 'recovery', 'invite'].includes(value))
    return value as AuthView;
  if (['oauth', 'host', 'mcp'].includes(scenario))
    return scenario === 'mcp' ? 'host' : (scenario as AuthView);
  if (['invite', 'invite-expired'].includes(scenario)) return 'invite';
  if (['email-waiting', 'email-failed'].includes(scenario)) return 'recovery';
  return signedIn ? 'account' : 'login';
}

/** Review/Trial adapter: no production APIs, credentials, Bluetooth or printer calls. */
export function SettingsJourney({
  path,
  scenario,
  navigate,
}: {
  path: string;
  scenario: string;
  navigate: (path: string) => void;
}) {
  const contextKey = useSyncExternalStore(
    subscribeTrialScope,
    () => settingsContext(scenario),
    () => `review:${scenario}`,
  );
  const settingsVersion = useSyncExternalStore(
    subscribeSettings,
    settingsRevision,
    settingsRevision,
  );
  const loaded = useMemo(
    () => loadSettings(scenario, contextKey),
    [scenario, contextKey, settingsVersion],
  );
  const [saved, setSaved] = useState(loaded);
  const snapshot =
    saved.contextKey === contextKey &&
    saved.raw === loaded.raw &&
    (isTrial() || saved.state === loaded.state)
      ? saved
      : loaded;
  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  const state = snapshot.state;
  const registry = useOperationSessions();
  const scope = settingsScope(scenario);
  const taskId = `acornary-review-settings-task-v1:${scope.householdId}:${scenario}`;
  const task = registry.get(scope, taskId, () => createSettingsFixtureTask(taskId, scenario));
  const taskState = useSyncExternalStore(task.subscribe, task.getSnapshot, task.getSnapshot);
  const taskLocked = ['submitting', 'networkUnknown', 'sessionChanged'].includes(taskState.state);
  const [householdInput, setHouseholdInput] = useState<string | null>(null);
  const staged = task.stagedCommand();
  const householdName = householdInput ?? (staged?.kind === 'rename-household' ? staged.name : '');
  const setHouseholdName = (name: string) => {
    setHouseholdInput(name);
    void task.stageCommand({ kind: 'rename-household', householdId: scope.householdId, name });
  };
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const [selectedHousehold, setSelectedHousehold] = useState<string | null>(null);
  const [draftChoice, setDraftChoice] = useState<'keep' | 'discard'>('keep');
  const [memberIntent, setMemberIntent] = useState<MemberIntent>(null);
  const [credentialIntent, setCredentialIntent] = useState<CredentialIntent>(null);
  const [credentialName, setCredentialName] = useState('');
  const [clearOpen, setClearOpen] = useState(false),
    [logoutOpen, setLogoutOpen] = useState(false);
  const [discardTask, setDiscardTask] = useState<SettingsTask | null>(null);
  const [inspectorScope, setInspectorScope] = useState<'items' | 'catalog' | 'session'>('items');
  const [inspectorQuery, setInspectorQuery] = useState(''),
    [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  useEffect(() => {
    setNotice(null);
    setSelectedHousehold(null);
    setMemberIntent(null);
    setCredentialIntent(null);
    setCredentialName('');
    setHouseholdInput(null);
    setClearOpen(false);
    setLogoutOpen(false);
    setDiscardTask(null);
    setSelectedRecord(null);
    setInspectorQuery('');
    setInspectorScope('items');
  }, [scenario, contextKey]);
  const url = new URL(path, 'https://preview.invalid');
  const route = url.pathname.replace(/\/$/, '') || '/settings';
  const online = !['offline', 'offline-partial', 'offline-empty'].includes(scenario);
  const host = ['mcp', 'host', 'unsupported-host'].includes(scenario);
  const household =
    state.households.find((home) => home.id === state.householdId) || state.households[0];
  const cache = state.caches[household.id];
  const members = state.members[household.id] || [];
  const canManage =
    state.identity.signedIn &&
    !host &&
    online &&
    !taskLocked &&
    !snapshot.incompatible &&
    state.readState === 'ready';
  const recoveryLinks = isTrial() ? pendingTrialTasks() : [];
  const sharedTasks: SettingsTask[] = recoveryLinks.map((task, index) => ({
    id: `shared:${task.key}`,
    householdId: household.id,
    title: `待确认任务 ${index + 1}`,
    state: 'unknown',
  }));
  const visibleTasks = [...state.tasks, ...sharedTasks];
  const activeTasks = visibleTasks.filter(
    (task) => task.householdId === household.id && task.state !== 'confirmed',
  );
  const allPending = visibleTasks.filter((task) => task.state !== 'confirmed');
  const show = (message: string, tone: SettingsNotice['tone'] = 'success') =>
    setNotice({ message, tone });
  const go = (next: string) => {
    setNotice(null);
    navigate(next);
  };
  const common = {
    household: { ...household, memberCount: members.length },
    navigate: go,
    notice: snapshot.error
      ? { tone: 'danger' as const, message: snapshot.error }
      : notice || {
          tone: 'info' as const,
          message: '隔离设置样例：不会修改真实账号、成员关系或设备。',
        },
    task: {
      state: taskState.state,
      message: taskState.error || taskState.result?.description || '',
      checkingAvailable: online && !host && taskState.state === 'networkUnknown',
      onCheck: () => {
        void task.checkCurrentState();
      },
      draftLabel:
        taskState.draft && !taskState.attempt
          ? {
              'rename-household': '家庭名称',
              'revoke-invitation': '撤销邀请',
              'rename-passkey': '通行密钥名称',
              'remove-passkey': '移除通行密钥',
              'remove-password': '移除密码',
            }[taskState.draft.kind]
          : undefined,
      onDiscardDraft:
        taskState.draft && !taskState.attempt
          ? () => {
              void task.discardUnsentDraft();
            }
          : undefined,
    },
  };
  const commit = (next: PreviewSettingsState) => {
    try {
      const fresh = commitSettings(scenario, currentSnapshot.current, next);
      currentSnapshot.current = fresh;
      setSaved(fresh);
      return true;
    } catch (error) {
      const failed = { ...currentSnapshot.current, error: String(error) };
      currentSnapshot.current = failed;
      setSaved(failed);
      return false;
    }
  };
  const submitSettings = (command: SettingsCommand) => {
    if (!online || host || snapshot.incompatible || !state.identity.signedIn) return;
    void task.submitCommand(command);
  };
  const update = (patch: Partial<PreviewSettingsState>) => commit({ ...state, ...patch });
  const edit = (patch: Partial<PreviewSettingsState>) => {
    if (update(patch) || settingsContext(scenario) !== contextKey) return;
    const retained = {
      ...currentSnapshot.current,
      state: { ...currentSnapshot.current.state, ...patch },
    };
    currentSnapshot.current = retained;
    setSaved(retained);
  };
  const retry = () => {
    if (state.readState === 'forbidden') return;
    if (!update({ readState: 'ready' })) return;
    show('示例区块已重新读取，原查询和输入保持不变。');
  };
  function reconcile(id: string) {
    const shared = recoveryLinks.find((task) => `shared:${task.key}` === id);
    if (shared) {
      go(safeReturnPath(shared.route));
      return;
    }
    if (!online) return;
    const task = state.tasks.find(
      (entry) => entry.id === id && entry.householdId === household.id && entry.state === 'unknown',
    );
    if (!task) return;
    if (
      !update({
        tasks: state.tasks.map((entry) =>
          entry.id === id ? { ...entry, state: 'confirmed' } : entry,
        ),
      })
    )
      return;
    show(`已核对原请求 ${id}：示例回执确认完成；没有创建或重复发送新请求。`);
  }
  function switchHousehold() {
    const target = state.households.find((home) => home.id === selectedHousehold);
    if (
      !target ||
      target.id === household.id ||
      !state.identity.signedIn ||
      !online ||
      host ||
      (!isTrial() && activeTasks.some((task) => task.state === 'unknown'))
    )
      return;
    if (
      !commit({
        ...state,
        householdId: target.id,
        tasks:
          draftChoice === 'discard'
            ? state.tasks.filter(
                (task) => !(task.householdId === household.id && task.state === 'draft'),
              )
            : state.tasks,
        caches: {
          ...state.caches,
          [household.id]: { ...state.caches[household.id], state: 'empty' },
          [target.id]: { ...state.caches[target.id], state: 'empty' },
        },
        scopes: [],
        readState: 'ready',
        authStatus: 'reauthorization-required',
      })
    )
      return;
    if (isTrial()) {
      try {
        switchTrialHousehold(target.id);
      } catch (error) {
        commit(state);
        show(
          error instanceof Error ? error.message : '家庭切换未完成，请保留当前任务后重试。',
          'warning',
        );
        return;
      }
    }
    setSelectedHousehold(null);
    setSelectedRecord(null);
    setInspectorQuery('');
    show(
      `已切换到 ${target.name}；${isTrial() ? '导航、物品数据和操作权限已同步更新。' : ''}读缓存与连接授权已重置。草稿${draftChoice === 'keep' ? '保留在原家庭' : '已按选择丢弃'}，待确认请求始终保留在原家庭。`,
    );
  }
  function confirmMemberIntent() {
    show('退出家庭需要成员关系与当前会话的真实同步；当前隔离适配器尚未接通。', 'warning');
  }
  const returnPath = safeReturnPath(url.searchParams.get('returnTo'));
  function authAction(
    action:
      | 'passkey'
      | 'password'
      | 'add-passkey'
      | 'recovery-email'
      | 'recovery-retry'
      | 'recovery-complete'
      | 'accept-invite'
      | 'oauth-allow'
      | 'oauth-deny'
      | 'reauthorize'
      | 'logout'
      | 'register',
  ) {
    if (!online) return;
    if (action === 'passkey' || action === 'password') {
      if (
        !update({
          identity: { ...state.identity, signedIn: true },
          authStatus: 'idle',
          readState: 'ready',
        })
      )
        return;
      if (isTrial()) {
        try {
          setTrialSignedIn(true);
        } catch (error) {
          commit(state);
          show(error instanceof Error ? error.message : '登录状态未能保存，请重试。', 'warning');
          return;
        }
      }
      show('示例身份验证完成，已返回允许的原页面；没有调用真实凭据。');
      navigate(returnPath);
      return;
    }
    if (
      [
        'add-passkey',
        'recovery-email',
        'recovery-retry',
        'recovery-complete',
        'accept-invite',
      ].includes(action)
    ) {
      show('当前适配器未提供这项身份验证流程，账号和凭据没有改变。', 'warning');
      return;
    }
    if (action === 'oauth-allow') {
      if (!state.identity.signedIn) return;
      update({
        scopes: state.requestedWrite ? ['inventory:read', 'inventory:write'] : ['inventory:read'],
        authStatus: 'allowed',
      });
      return;
    }
    if (action === 'oauth-deny') {
      update({ authStatus: 'denied' });
      return;
    }
    if (action === 'reauthorize') {
      if (!update({ scopes: [], authStatus: 'reauthorization-required' })) return;
      show('旧连接已暂停，需重新选择家庭和权限；未调用宿主授权接口。', 'warning');
      return;
    }
    if (action === 'register') {
      show('当前为示例注册入口；正式注册能力尚未启用。', 'info');
      return;
    }
    if (action === 'logout') {
      if ((!isTrial() && allPending.length > 0) || !state.identity.signedIn) return;
      if (
        !update({
          identity: { ...state.identity, signedIn: false },
          scopes: [],
          caches: Object.fromEntries(
            Object.entries(state.caches).map(([id, entry]) => [
              id,
              { ...entry, state: 'empty' as const },
            ]),
          ),
          authStatus: 'idle',
          readState: 'forbidden',
        })
      )
        return;
      if (isTrial()) {
        try {
          setTrialSignedIn(false);
        } catch (error) {
          commit(state);
          show(error instanceof Error ? error.message : '退出状态未能保存，请重试。', 'warning');
          return;
        }
      }
      setLogoutOpen(false);
      show('已退出示例账号并清理预览读缓存；真实账号未受影响。');
      navigate('/settings/auth?view=login');
    }
  }
  if (route === '/settings/household')
    return (
      <HouseholdSettingsPage
        {...common}
        households={state.households.map((home) => ({
          ...home,
          memberCount: state.members[home.id]?.length || home.memberCount,
        }))}
        tasks={visibleTasks}
        readState={state.readState}
        online={online}
        host={host}
        selectedId={selectedHousehold}
        draftChoice={draftChoice}
        onSelect={(id) => {
          setDraftChoice('keep');
          setSelectedHousehold(id);
        }}
        onDraftChoice={setDraftChoice}
        onConfirmSwitch={switchHousehold}
        onReconcile={reconcile}
        onRetry={retry}
        allowPendingSwitch={isTrial()}
        externalDraftsRetained={isTrial()}
        nameDraft={householdName}
        onNameDraft={setHouseholdName}
        renameAvailable={canManage}
        onRename={() => {
          if (canManage)
            submitSettings({
              kind: 'rename-household',
              householdId: household.id,
              name: householdName,
            });
        }}
      />
    );
  if (route === '/settings/members')
    return (
      <MemberSettingsPage
        {...common}
        members={members}
        invitations={state.invitations[household.id] || []}
        readState={state.readState}
        online={online}
        canManage={canManage}
        intent={memberIntent}
        pendingCount={activeTasks.length}
        leaveUnavailableReason={'退出家庭的真实成员关系与会话同步尚未接通；可在家庭列表切换。'}
        onIntent={setMemberIntent}
        onConfirmIntent={confirmMemberIntent}
        onRetry={retry}
        inviteUnavailableReason="邀请链接包含临时凭据；当前适配器尚未提供安全的创建与交接流程。"
        onInvite={() => show('尚未创建邀请链接。', 'warning')}
        onRevoke={(id) => {
          if (canManage)
            submitSettings({
              kind: 'revoke-invitation',
              householdId: household.id,
              invitationId: id,
            });
        }}
      />
    );
  if (route === '/settings/auth') {
    const view = authViewFor(url.searchParams.get('view'), scenario, state.identity.signedIn);
    const statesByView: Record<AuthView, readonly AuthStatus[]> = {
      account: [],
      login: ['passkey-cancelled', 'password-error'],
      recovery: ['email-waiting', 'email-failed', 'recovery-complete'],
      oauth: ['allowed', 'denied'],
      host: ['reauthorization-required'],
      invite: ['invite-expired', 'invite-accepted'],
    };
    return (
      <AccountSettingsPage
        {...common}
        identity={state.identity}
        view={view}
        status={
          view === 'invite' && url.searchParams.get('state') === 'expired'
            ? 'invite-expired'
            : statesByView[view].includes(state.authStatus)
              ? state.authStatus
              : 'idle'
        }
        online={online}
        pendingCount={allPending.length}
        allowPendingLogout={isTrial()}
        logoutOpen={logoutOpen}
        onLogoutOpen={setLogoutOpen}
        hostStorage={
          ['storage-error', 'host-storage-unavailable'].includes(scenario)
            ? 'unavailable'
            : 'available'
        }
        scopes={state.scopes}
        requestedWrite={state.requestedWrite}
        onRequestedWrite={(value) => edit({ requestedWrite: value, authStatus: 'idle' })}
        returnPath={returnPath}
        registrationAvailable={false}
        recoveryAvailable={false}
        credentialsAvailable={canManage && state.identity.fresh}
        secretFlowsAvailable={false}
        connectionLabel="ChatGPT · 隔离样例"
        credentialIntent={credentialIntent}
        credentialName={credentialName}
        onCredentialName={(name) => {
          setCredentialName(name);
          if (credentialIntent?.kind === 'rename-passkey')
            void task.stageCommand({
              kind: 'rename-passkey',
              passkeyId: credentialIntent.key,
              name,
            });
        }}
        onCredentialIntent={(intent) => {
          setCredentialIntent(intent);
          setCredentialName(
            intent?.kind === 'rename-passkey'
              ? staged?.kind === 'rename-passkey' && staged.passkeyId === intent.key
                ? staged.name
                : state.identity.passkeys.find((key) => key.id === intent.key)?.name || ''
              : '',
          );
        }}
        onConfirmCredential={() => {
          if (!credentialIntent || !canManage || !state.identity.fresh) return;
          if (credentialIntent.kind === 'rename-passkey')
            submitSettings({
              kind: 'rename-passkey',
              passkeyId: credentialIntent.key,
              name: credentialName,
            });
          else if (credentialIntent.kind === 'remove-passkey')
            submitSettings({ kind: 'remove-passkey', passkeyId: credentialIntent.key });
          else if (credentialIntent.kind === 'remove-password')
            submitSettings({ kind: 'remove-password' });
          else {
            show('设置密码需要临时凭据输入流程，尚未接通。', 'warning');
            return;
          }
          setCredentialIntent(null);
        }}
        onAction={authAction}
      />
    );
  }
  if (route === '/settings/printing')
    return (
      <PrintingSettingsPage
        {...common}
        device={state.printer}
        draft={state.printerDraft}
        saved={state.printerSaved}
        printState={state.printState}
        onChange={(draft) => {
          if (state.printState !== 'sent') edit({ printerDraft: draft, printState: 'idle' });
        }}
        onSave={() => {
          if (state.printState === 'sent') return;
          if (!update({ printerSaved: { ...state.printerDraft }, printState: 'idle' })) return;
          show('标签设置已保存到本次预览，未修改真实打印配置。');
        }}
        onConnect={() => {
          if (state.printer === 'unavailable') return;
          if (!update({ printer: 'connected' })) return;
          show('示例设备已连接；尚未试打。');
        }}
        onDisconnect={() => {
          if (!update({ printer: 'disconnected' })) return;
          show(
            state.printState === 'sent'
              ? '示例连接已断开；已发送任务仍需核对结果。'
              : '示例设备已断开。',
            'info',
          );
        }}
        onPrint={() => {
          if (
            state.printer !== 'connected' ||
            state.printState === 'sent' ||
            JSON.stringify(state.printerDraft) !== JSON.stringify(state.printerSaved)
          )
            return;
          if (!update({ printState: 'sent' })) return;
          setNotice(null);
        }}
        onPrintResult={(success) => {
          if (state.printState === 'sent') update({ printState: success ? 'confirmed' : 'failed' });
        }}
      />
    );
  if (route === '/settings/cache')
    return (
      <CacheSettingsPage
        {...common}
        online={online}
        cache={cache}
        tasks={visibleTasks}
        externalDraftsRetained={isTrial()}
        readState={state.readState}
        clearOpen={clearOpen}
        discardTask={discardTask}
        onRetry={retry}
        onRefresh={() => {
          if (!online) return;
          if (
            !update({
              caches: {
                ...state.caches,
                [household.id]: {
                  ...cacheFor(household.id),
                  updatedAt: `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())} · 示例刷新`,
                },
              },
            })
          )
            return;
          show('示例读缓存已更新；草稿和原请求保持不变。');
        }}
        onClearOpen={setClearOpen}
        onClear={() => {
          if (
            !update({ caches: { ...state.caches, [household.id]: { ...cache, state: 'empty' } } })
          )
            return;
          setClearOpen(false);
          show('仅清理此家庭的示例读缓存；全部草稿与原请求已保留。');
        }}
        onReconcile={reconcile}
        onDiscardIntent={setDiscardTask}
        onDiscard={() => {
          if (
            !discardTask ||
            discardTask.state !== 'draft' ||
            discardTask.householdId !== household.id
          )
            return;
          if (!update({ tasks: state.tasks.filter((task) => task.id !== discardTask.id) })) return;
          setDiscardTask(null);
          show('已丢弃指定未发送草稿；其他草稿和待确认请求保持不变。');
        }}
      />
    );
  if (route === '/settings/inspector')
    return (
      <SettingsInspector
        {...common}
        records={inspectorRecords(household, cache, state.scopes)}
        scope={inspectorScope}
        query={inspectorQuery}
        readState={state.readState}
        online={online}
        selectedId={selectedRecord}
        onScope={(scope) => {
          setInspectorScope(scope);
          setSelectedRecord(null);
        }}
        onQuery={(query) => {
          setInspectorQuery(query);
          setSelectedRecord(null);
        }}
        onSelect={setSelectedRecord}
        onRetry={retry}
      />
    );
  return (
    <SettingsOverview
      {...common}
      identity={state.identity}
      online={online}
      taskCount={activeTasks.length}
      cacheLabel={cache.state === 'empty' ? '暂无读缓存' : cache.updatedAt}
      host={host}
    />
  );
}
