import { useEffect, useState } from 'react';
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
  type CacheSnapshot,
  type MemberIntent,
  type PrinterPreferences,
  type PrinterState,
  type SettingsHousehold,
  type SettingsIdentity,
  type SettingsInvitation,
  type SettingsMember,
  type SettingsNotice,
  type SettingsReadState,
  type SettingsTask,
  type TestPrintState,
} from '../../src/features/settings/pages/settings-pages';
import {
  cacheFor,
  initialAuthStatus,
  inspectorRecords,
  invitationsFor,
  membersFor,
  printerDefaults,
  settingsHouseholds,
  settingsIdentity,
  settingsReadState,
  tasksFor,
} from './settings-fixtures';

interface PreviewSettingsState {
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
function createState(scenario: string): PreviewSettingsState {
  const readOnly = ['forbidden', 'read-only', 'readonly'].includes(scenario);
  const signedIn = !['login', 'signed-out', 'passkey-cancelled', 'password-error'].includes(
    scenario,
  );
  const households = settingsHouseholds.map((home) => ({
    ...home,
    role: home.id === 'preview-home-wutong' && readOnly ? ('viewer' as const) : home.role,
  }));
  const members = Object.fromEntries(
    households.map((home) => [
      home.id,
      membersFor(home.id).map((member) => (member.self ? { ...member, role: home.role } : member)),
    ]),
  );
  return {
    householdId: households[0].id,
    households,
    members,
    identity: {
      ...settingsIdentity,
      passkeys: [...settingsIdentity.passkeys],
      signedIn,
    },
    invitations: Object.fromEntries(households.map((home) => [home.id, invitationsFor()])),
    tasks: tasksFor(scenario),
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
// Route components may unmount between settings pages. Keep only this review's
// fixture state in memory; a full refresh resets it, and scenarios never share it.
const previewSessions = new Map<string, PreviewSettingsState>();
function previewSession(scenario: string): PreviewSettingsState {
  const existing = previewSessions.get(scenario);
  if (existing) return existing;
  const initial = createState(scenario);
  previewSessions.set(scenario, initial);
  return initial;
}
function safeReturnPath(raw: string | null): string {
  if (
    !raw ||
    raw.length > 1024 ||
    !/^\/(?:settings(?:\/(?:household|members|auth|printing|cache|inspector))?|items|attention|activity)(?:\?|$)/.test(
      raw,
    )
  )
    return '/settings';
  try {
    const parsed = new URL(raw, 'https://preview.invalid');
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

/** P08 adapter: entirely in-memory state. No APIs, auth, storage, Bluetooth or printer calls. */
export function SettingsJourney({
  path,
  scenario,
  navigate,
}: {
  path: string;
  scenario: string;
  navigate: (path: string) => void;
}) {
  const [state, setState] = useState(() => previewSession(scenario));
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const [selectedHousehold, setSelectedHousehold] = useState<string | null>(null);
  const [draftChoice, setDraftChoice] = useState<'keep' | 'discard'>('keep');
  const [memberIntent, setMemberIntent] = useState<MemberIntent>(null);
  const [inviteRole, setInviteRole] = useState<'member' | 'viewer'>('viewer');
  const [credentialIntent, setCredentialIntent] = useState<CredentialIntent>(null);
  const [credentialName, setCredentialName] = useState('');
  const [clearOpen, setClearOpen] = useState(false),
    [logoutOpen, setLogoutOpen] = useState(false);
  const [discardTask, setDiscardTask] = useState<SettingsTask | null>(null);
  const [inspectorScope, setInspectorScope] = useState<'items' | 'catalog' | 'session'>('items');
  const [inspectorQuery, setInspectorQuery] = useState(''),
    [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  useEffect(() => {
    setState(previewSession(scenario));
    setNotice(null);
    setSelectedHousehold(null);
    setMemberIntent(null);
    setCredentialIntent(null);
    setCredentialName('');
    setClearOpen(false);
    setLogoutOpen(false);
    setDiscardTask(null);
    setSelectedRecord(null);
    setInspectorQuery('');
    setInspectorScope('items');
  }, [scenario]);
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
    ['owner', 'admin'].includes(household.role) &&
    state.readState !== 'forbidden';
  const activeTasks = state.tasks.filter(
    (task) => task.householdId === household.id && task.state !== 'confirmed',
  );
  const allPending = state.tasks.filter((task) => task.state !== 'confirmed');
  const show = (message: string, tone: SettingsNotice['tone'] = 'success') =>
    setNotice({ message, tone });
  const go = (next: string) => {
    setNotice(null);
    navigate(next);
  };
  const common = { household: { ...household, memberCount: members.length }, navigate: go, notice };
  const commit = (next: PreviewSettingsState) => {
    previewSessions.set(scenario, next);
    setState(next);
  };
  const update = (patch: Partial<PreviewSettingsState>) => commit({ ...state, ...patch });
  const retry = () => {
    if (state.readState === 'forbidden') return;
    update({ readState: 'ready' });
    show('示例区块已重新读取，原查询和输入保持不变。');
  };
  function reconcile(id: string) {
    if (!online) return;
    const task = state.tasks.find(
      (entry) => entry.id === id && entry.householdId === household.id && entry.state === 'unknown',
    );
    if (!task) return;
    update({
      tasks: state.tasks.map((entry) =>
        entry.id === id ? { ...entry, state: 'confirmed' } : entry,
      ),
    });
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
      activeTasks.some((task) => task.state === 'unknown')
    )
      return;
    commit({
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
    });
    setSelectedHousehold(null);
    setSelectedRecord(null);
    setInspectorQuery('');
    show(
      `设置预览已切换到 ${target.name}；读缓存与连接授权已重置。草稿${draftChoice === 'keep' ? '保留在原家庭' : '已按选择丢弃'}。其他页面仍使用各自隔离样例。`,
    );
  }
  function confirmMemberIntent() {
    if (!memberIntent || !online || !state.identity.signedIn) return;
    const target = members.find((member) => member.id === memberIntent.memberId);
    if (!target || target.role === 'owner') return;
    if (memberIntent.kind === 'leave') {
      if (!target.self || activeTasks.length > 0) return;
      const nextHome = state.households.find((home) => home.id !== household.id);
      if (!nextHome) {
        show('当前没有其他可访问的家庭；本预览保留当前身份，未离开。', 'warning');
        return;
      }
      update({
        households: state.households.filter((home) => home.id !== household.id),
        householdId: nextHome.id,
        scopes: [],
        caches: {
          ...state.caches,
          [nextHome.id]: { ...state.caches[nextHome.id], state: 'empty' },
        },
      });
      show('已离开当前示例家庭，清除原连接授权；真实成员关系没有改变。');
    } else {
      if (!canManage || target.self) return;
      const nextMembers =
        memberIntent.kind === 'remove'
          ? members.filter((member) => member.id !== target.id)
          : members.map((member) =>
              member.id === target.id ? { ...member, role: memberIntent.role } : member,
            );
      update({ members: { ...state.members, [household.id]: nextMembers } });
      show(
        memberIntent.kind === 'remove'
          ? `已从此预览家庭移除 ${target.name}，物品与历史保持不变。`
          : `已更新 ${target.name} 的示例角色。`,
      );
    }
    setMemberIntent(null);
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
      update({
        identity: { ...state.identity, signedIn: true },
        authStatus: 'idle',
        readState: 'ready',
      });
      show('示例身份验证完成，已返回允许的原页面；没有调用真实凭据。');
      navigate(returnPath);
      return;
    }
    if (action === 'add-passkey') {
      if (!state.identity.signedIn) return;
      const suffix = Array.from(
        { length: state.identity.passkeys.length + 1 },
        (_, i) => i + 1,
      ).find((i) => !state.identity.passkeys.includes(`通行密钥样例 ${i}`));
      const label = `通行密钥样例 ${suffix}`;
      update({ identity: { ...state.identity, passkeys: [...state.identity.passkeys, label] } });
      show(`已加入 ${label}；未登记真实设备凭据。`);
      return;
    }
    if (action === 'recovery-email' || action === 'recovery-retry') {
      update({
        authStatus:
          scenario === 'email-failed' && state.authStatus !== 'email-failed'
            ? 'email-failed'
            : 'email-waiting',
      });
      setNotice(null);
      return;
    }
    if (action === 'recovery-complete') {
      update({ authStatus: 'recovery-complete' });
      return;
    }
    if (action === 'accept-invite') {
      if (state.authStatus === 'invite-expired' || url.searchParams.get('state') === 'expired')
        return;
      update({ authStatus: 'invite-accepted' });
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
      update({ scopes: [], authStatus: 'reauthorization-required' });
      show('旧连接已暂停，需重新选择家庭和权限；未调用宿主授权接口。', 'warning');
      return;
    }
    if (action === 'register') {
      show('当前为示例注册入口；正式注册能力尚未启用。', 'info');
      return;
    }
    if (action === 'logout') {
      if (allPending.length > 0 || !state.identity.signedIn) return;
      update({
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
      });
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
        tasks={state.tasks}
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
        inviteRole={inviteRole}
        intent={memberIntent}
        pendingCount={activeTasks.length}
        onInviteRole={setInviteRole}
        onIntent={setMemberIntent}
        onConfirmIntent={confirmMemberIntent}
        onRetry={retry}
        onInvite={() => {
          if (!canManage || !online) return;
          const existing = state.invitations[household.id] || [];
          const invitation: SettingsInvitation = {
            id: `preview-invitation-${existing.length + 1}`,
            label: `示例邀请 ${existing.length + 1}`,
            role: inviteRole,
            state: 'pending',
          };
          update({
            invitations: { ...state.invitations, [household.id]: [...existing, invitation] },
          });
          show('已生成隔离邀请记录；未发送邮件或消息。');
        }}
        onRevoke={(id) => {
          if (!canManage || !online) return;
          update({
            invitations: {
              ...state.invitations,
              [household.id]: (state.invitations[household.id] || []).map((entry) =>
                entry.id === id ? { ...entry, state: 'revoked' } : entry,
              ),
            },
          });
          show('示例邀请已撤销，不再等待接受。');
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
        logoutOpen={logoutOpen}
        onLogoutOpen={setLogoutOpen}
        hostStorage={
          ['storage-error', 'host-storage-unavailable'].includes(scenario)
            ? 'unavailable'
            : 'available'
        }
        scopes={state.scopes}
        requestedWrite={state.requestedWrite}
        onRequestedWrite={(value) => update({ requestedWrite: value, authStatus: 'idle' })}
        returnPath={returnPath}
        registrationAvailable={false}
        credentialIntent={credentialIntent}
        credentialName={credentialName}
        onCredentialName={setCredentialName}
        onCredentialIntent={(intent) => {
          setCredentialIntent(intent);
          setCredentialName(intent?.kind === 'rename-passkey' ? intent.key : '');
        }}
        onConfirmCredential={() => {
          if (!credentialIntent || !online || !state.identity.signedIn) return;
          const next = { ...state.identity };
          if (credentialIntent.kind === 'rename-passkey') {
            const name = credentialName.trim();
            if (!name || !next.passkeys.includes(credentialIntent.key)) return;
            if (name !== credentialIntent.key && next.passkeys.includes(name)) {
              show('已有同名通行密钥，请使用另一个名称。', 'warning');
              return;
            }
            next.passkeys = next.passkeys.map((key) => (key === credentialIntent.key ? name : key));
          } else if (credentialIntent.kind === 'remove-passkey') {
            if (next.passkeys.length === 1 && !next.passwordConfigured) return;
            next.passkeys = next.passkeys.filter((key) => key !== credentialIntent.key);
          } else if (credentialIntent.kind === 'remove-password') {
            if (!next.passkeys.length) return;
            next.passwordConfigured = false;
          } else next.passwordConfigured = true;
          update({ identity: next });
          setCredentialIntent(null);
          show('示例安全设置已更新；未修改真实凭据。');
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
          if (state.printState !== 'sent') update({ printerDraft: draft, printState: 'idle' });
        }}
        onSave={() => {
          if (state.printState === 'sent') return;
          update({ printerSaved: { ...state.printerDraft }, printState: 'idle' });
          show('标签设置已保存到本次预览，未修改真实打印配置。');
        }}
        onConnect={() => {
          if (state.printer === 'unavailable') return;
          update({ printer: 'connected' });
          show('示例设备已连接；尚未试打。');
        }}
        onDisconnect={() => {
          update({ printer: 'disconnected' });
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
          update({ printState: 'sent' });
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
        tasks={state.tasks}
        readState={state.readState}
        clearOpen={clearOpen}
        discardTask={discardTask}
        onRetry={retry}
        onRefresh={() => {
          if (!online) return;
          update({
            caches: {
              ...state.caches,
              [household.id]: {
                ...cacheFor(household.id),
                updatedAt: `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date())} · 示例刷新`,
              },
            },
          });
          show('示例读缓存已更新；草稿和原请求保持不变。');
        }}
        onClearOpen={setClearOpen}
        onClear={() => {
          update({ caches: { ...state.caches, [household.id]: { ...cache, state: 'empty' } } });
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
          update({ tasks: state.tasks.filter((task) => task.id !== discardTask.id) });
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
