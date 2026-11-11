export type SettingsReadState = 'ready' | 'loading' | 'error' | 'forbidden';
export type AuthView = 'account' | 'login' | 'oauth' | 'host' | 'recovery' | 'invite';
export interface SettingsHousehold {
  id: string;
  name: string;
  memberCount: number;
}
export interface SettingsMember {
  id: string;
  name: string;
  email: string;
  self: boolean;
}
export interface SettingsInvitation {
  id: string;
  label: string;
  state: 'pending' | 'revoked' | 'expired' | 'used';
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
  passkeys: readonly { id: string; name: string }[];
  fresh: boolean;
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
  task?: {
    state: string;
    message: string;
    checkingAvailable: boolean;
    onCheck: () => void;
    draftLabel?: string;
    onDiscardDraft?: () => void;
  };
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
