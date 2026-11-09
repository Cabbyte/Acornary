export type SettingsReadState = 'ready' | 'loading' | 'error' | 'forbidden';
export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type AuthView = 'account' | 'login' | 'oauth' | 'host' | 'recovery' | 'invite';
export interface SettingsHousehold {
  id: string;
  name: string;
  role: MemberRole;
  memberCount: number;
}
export interface SettingsMember {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  self: boolean;
}
export interface SettingsInvitation {
  id: string;
  label: string;
  role: 'member' | 'viewer';
  state: 'pending' | 'revoked' | 'expired';
}
export interface SettingsTask {
  id: string;
  householdId: string;
  title: string;
  state: 'draft' | 'unknown' | 'confirmed';
}
export interface SettingsIdentity {
  name: string;
  email: string;
  signedIn: boolean;
  passkeys: readonly string[];
  passwordConfigured: boolean;
}
export interface SettingsNotice {
  tone: 'info' | 'success' | 'warning' | 'danger';
  message: string;
}
export interface SettingsPageProps {
  household: SettingsHousehold;
  navigate: (path: string) => void;
  notice?: SettingsNotice | null;
}
export interface PrinterPreferences {
  paper: '40x30' | '50x30';
  density: '1' | '2' | '3';
  copies: '1' | '2' | '3';
}
export type PrinterState = 'disconnected' | 'unavailable' | 'connected';
export type TestPrintState = 'idle' | 'sent' | 'confirmed' | 'failed';
export interface CacheSnapshot {
  state: 'available' | 'empty';
  updatedAt: string;
  itemCount: number;
  catalogCount: number;
  historyCount: number;
}
export interface InspectorRecord {
  id: string;
  scope: 'items' | 'catalog' | 'session';
  title: string;
  fields: Readonly<Record<string, unknown>>;
}
export const roleLabels: Record<MemberRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
  viewer: '只读成员',
};
