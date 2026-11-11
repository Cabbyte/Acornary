import type {
  AuthStatus,
  CacheSnapshot,
  InspectorRecord,
  PrinterPreferences,
  SettingsHousehold,
  SettingsIdentity,
  SettingsInvitation,
  SettingsMember,
  SettingsReadState,
  SettingsTask,
} from '../../src/features/settings/pages/settings-pages';

// Private P08 fixtures. No service client, production identifiers, credentials or persistent stores.
export const settingsHouseholds: readonly SettingsHousehold[] = [
  { id: 'preview-home-wutong', name: '梧桐之家 · 示例', memberCount: 3 },
  { id: 'preview-home-weekend', name: '周末小屋 · 示例', memberCount: 2 },
];
export function membersFor(householdId: string): SettingsMember[] {
  return householdId === 'preview-home-wutong'
    ? [
        {
          id: 'preview-member-self',
          name: '林晓',
          email: 'lin@example.invalid',
          self: true,
        },
        {
          id: 'preview-member-chen',
          name: '陈禾',
          email: 'chen@example.invalid',
          self: false,
        },
        {
          id: 'preview-member-guest',
          name: '访客',
          email: 'guest@example.invalid',
          self: false,
        },
      ]
    : [
        {
          id: 'preview-member-owner',
          name: '小屋主人',
          email: 'owner@example.invalid',
          self: false,
        },
        {
          id: 'preview-member-self',
          name: '林晓',
          email: 'lin@example.invalid',
          self: true,
        },
      ];
}
export const settingsIdentity: SettingsIdentity = {
  name: '林晓 · 示例账号',
  email: 'lin@example.invalid',
  signedIn: true,
  passkeys: [{ id: 'preview-passkey-device', name: '这台设备的通行密钥' }],
  fresh: true,
  passwordConfigured: true,
};
export const printerDefaults: PrinterPreferences = { paper: '40x30', density: '2', copies: '1' };
export function cacheFor(householdId: string): CacheSnapshot {
  return {
    state: 'available',
    updatedAt: '2026-11-09 09:30 · Asia/Shanghai',
    itemCount: householdId === 'preview-home-wutong' ? 6 : 2,
    catalogCount: householdId === 'preview-home-wutong' ? 3 : 1,
    historyCount: 2,
  };
}
export function invitationsFor(): SettingsInvitation[] {
  return [
    {
      id: 'preview-invitation-expired',
      label: '访客邀请 · 示例',
      state: 'expired',
    },
  ];
}
export function tasksFor(scenario: string): SettingsTask[] {
  if (scenario === 'empty') return [];
  return [
    {
      id: 'preview-draft-001',
      householdId: 'preview-home-wutong',
      title: '添加厨房收纳盒',
      state: 'draft',
    },
    {
      id: 'preview-attempt-001',
      householdId: 'preview-home-wutong',
      title: '移动牛奶 · 原请求',
      state: 'unknown',
    },
  ];
}
export function settingsReadState(scenario: string): SettingsReadState {
  return scenario === 'loading'
    ? 'loading'
    : ['error', 'read-error'].includes(scenario)
      ? 'error'
      : scenario === 'forbidden'
        ? 'forbidden'
        : 'ready';
}
export function initialAuthStatus(scenario: string): AuthStatus {
  return [
    'passkey-cancelled',
    'password-error',
    'email-waiting',
    'email-failed',
    'invite-expired',
  ].includes(scenario)
    ? (scenario as AuthStatus)
    : 'idle';
}
export function inspectorRecords(
  household: SettingsHousehold,
  cache: CacheSnapshot,
  scopes: readonly string[],
): InspectorRecord[] {
  const session: InspectorRecord = {
    id: `preview-session-${household.id}`,
    scope: 'session',
    title: '会话与缓存诊断',
    fields: {
      household_id: household.id,
      actor_id: 'preview-member-self',
      email: '[REDACTED]',
      session_token: '[REDACTED]',
      host_state: '[REDACTED]',
      membership: 'active',
      scope: scopes,
      protocol_version: 'read-v2 (preview)',
      cache_scope: {
        items: cache.state === 'available' ? 'opened records only' : 'none',
        full_inventory: false,
        pending_attempts_cleared: false,
      },
    },
  };
  return cache.state === 'empty'
    ? [session]
    : [
        {
          id: `preview-item-${household.id}-001`,
          scope: 'items',
          title: household.id === 'preview-home-wutong' ? '燕麦奶 · 示例记录' : '保温杯 · 示例记录',
          fields: {
            id: `preview-item-${household.id}-001`,
            household_id: household.id,
            catalog_id: `preview-catalog-${household.id}-001`,
            revision: 4,
            record_state: 'VALID',
            custom_name: null,
            source: 'isolated-preview',
          },
        },
        {
          id: `preview-catalog-${household.id}-001`,
          scope: 'catalog',
          title: '商品资料 · 示例记录',
          fields: {
            id: `preview-catalog-${household.id}-001`,
            kind: 'SKU',
            profile: null,
            effective_capabilities: { can_contain: false },
            revision: 2,
            source: 'isolated-preview',
          },
        },
        session,
      ];
}
