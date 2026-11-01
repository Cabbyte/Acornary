import type { ApiError } from '../../lib/api.js';

export type RecoveryAction =
  | 'RETRY_SAME_REQUEST'
  | 'REREAD_AND_REVIEW'
  | 'REAUTHORIZE'
  | 'FIX_REQUEST'
  | 'RECOVER_ORIGINAL_REQUEST'
  | 'UPGRADE_CLIENT'
  | 'RESET_CACHE';

const byCode: Record<string, RecoveryAction> = {
  PROTOCOL_VERSION_UNSUPPORTED: 'UPGRADE_CLIENT',
  INVALID_CURSOR: 'REREAD_AND_REVIEW',
  CURSOR_STALE: 'RECOVER_ORIGINAL_REQUEST',
  REVISION_CONFLICT: 'REREAD_AND_REVIEW',
  STATE_CONFLICT: 'REREAD_AND_REVIEW',
  SYNC_RESET_REQUIRED: 'RESET_CACHE',
  IDEMPOTENCY_CONFLICT: 'RECOVER_ORIGINAL_REQUEST',
  UNAUTHORIZED: 'REAUTHORIZE',
  FORBIDDEN: 'REAUTHORIZE',
  SESSION_CHANGED: 'REAUTHORIZE',
  NETWORK: 'RETRY_SAME_REQUEST',
};

export const recoveryLabels: Record<RecoveryAction, string> = {
  RETRY_SAME_REQUEST: '重试同一次操作',
  REREAD_AND_REVIEW: '重新读取并核对',
  REAUTHORIZE: '重新登录',
  FIX_REQUEST: '修改后重试',
  RECOVER_ORIGINAL_REQUEST: '恢复原请求',
  UPGRADE_CLIENT: '刷新或升级客户端',
  RESET_CACHE: '重新同步',
};

export function recoveryFor(error: Pick<ApiError, 'code' | 'recovery'>): RecoveryAction {
  const explicit = error.recovery as RecoveryAction | undefined;
  if (explicit && explicit in recoveryLabels) return explicit;
  return byCode[error.code] ?? 'FIX_REQUEST';
}
