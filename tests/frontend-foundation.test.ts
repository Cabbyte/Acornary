import { describe, expect, it } from 'vitest';
import { resolveFeatures, SAFE_BASELINE } from '../apps/web/src/features/api/features.js';
import {
  isItemDetailV2,
  isItemRecordV2,
  isSnapshotV2,
} from '../apps/web/src/features/inventory/adapters/shape.js';
import { domainErrorStatus, errorRecovery } from '../packages/contracts/src/errors.js';
import type { ConnectionContext } from '../packages/contracts/src/read-v2.js';

const context = (features: ConnectionContext['features']): ConnectionContext => ({
  protocol: { current: 2, min: 2 },
  features,
  household: {
    id: 'household_11111111-1111-4111-8111-111111111111',
    name: '家',
    timezone: 'Asia/Shanghai',
  },
  actor: { id: 'actor_11111111-1111-4111-8111-111111111111', name: '我' },
});

describe('feature registry', () => {
  it('falls back to the safe baseline when context or features are missing', () => {
    expect([...resolveFeatures(undefined)].sort()).toEqual([...SAFE_BASELINE].sort());
    expect([...resolveFeatures({ ...context([]), features: undefined } as any)].sort()).toEqual(
      [...SAFE_BASELINE].sort(),
    );
  });

  it('keeps baseline features and adds only server-advertised features', () => {
    const features = resolveFeatures(context(['query_v2', 'deadline']));
    expect(features.has('query_v2')).toBe(true);
    expect(features.has('deadline')).toBe(true);
    expect(features.has('attachments')).toBe(false);
    expect(features.has('snapshot_v2')).toBe(false);
  });
});

describe('shape guards', () => {
  it('detects snapshot v2 and does not mistake v1 for it', () => {
    expect(isSnapshotV2({ protocol: 2, items: [] })).toBe(true);
    expect(isSnapshotV2({ household: {}, items: [], notes: [], cached_at: '' })).toBe(false);
    expect(isSnapshotV2(null)).toBe(false);
  });

  it('detects item detail v2 and item record v2', () => {
    expect(isItemDetailV2({ item: {}, dates: [] })).toBe(true);
    expect(isItemDetailV2({ id: 'item', attributes: [] })).toBe(false);
    expect(isItemRecordV2({ id: 'item', attributes: [], note_count: 0 })).toBe(true);
    expect(isItemRecordV2({ id: 'item', attributes: [] })).toBe(false);
  });
});

describe('v2 error contract', () => {
  it('maps new error codes to HTTP status', () => {
    expect(domainErrorStatus('INVALID_CURSOR')).toBe(400);
    expect(domainErrorStatus('PROTOCOL_VERSION_UNSUPPORTED')).toBe(409);
    expect(domainErrorStatus('ATTACHMENT_TOO_LARGE')).toBe(413);
    expect(domainErrorStatus('SYNC_RESET_REQUIRED')).toBe(409);
  });

  it('maps recovery actions for cursor and state conflicts', () => {
    expect(errorRecovery('INVALID_CURSOR')).toBe('REREAD_AND_REVIEW');
    expect(errorRecovery('STATE_CONFLICT')).toBe('REREAD_AND_REVIEW');
    expect(errorRecovery('CURSOR_STALE')).toBe('RECOVER_ORIGINAL_REQUEST');
    expect(errorRecovery('PROTOCOL_VERSION_UNSUPPORTED')).toBe('FIX_REQUEST');
  });
});

import {
  withoutUnsupportedCatalogQuery,
  withoutUnsupportedItemQuery,
} from '../apps/web/src/features/api/query-params.js';

describe('query feature stripping', () => {
  it('does not send F-only item parameters on the baseline', () => {
    const next = withoutUnsupportedItemQuery(
      {
        search: '牛奶',
        profile: 'CONSUMABLE',
        capabilities: ['deadline'],
        date_filters: [{ kind: 'EXPIRY' }],
        include_void: true,
        include_terminal: true,
      },
      new Set(['query_v2', 'history_v2']),
    );
    expect(next).toEqual({ search: '牛奶' });
  });

  it('keeps F-only parameters when their features are advertised', () => {
    const next = withoutUnsupportedItemQuery(
      {
        profile: 'CONSUMABLE',
        capabilities: ['deadline'],
        date_filters: [{ kind: 'EXPIRY' }],
        include_void: true,
        include_terminal: true,
      },
      new Set(['query_v2', 'profile_capabilities', 'deadline', 'void', 'split']),
    );
    expect(next.profile).toBe('CONSUMABLE');
    expect(next.date_filters).toHaveLength(1);
    expect(next.include_void).toBe(true);
  });

  it('strips catalog profile filters on the baseline', () => {
    expect(
      withoutUnsupportedCatalogQuery(
        { kind: 'SKU', profile: 'DURABLE', capabilities: ['asset'] },
        new Set(['query_v2']),
      ),
    ).toEqual({ kind: 'SKU' });
  });
});

import { recoveryFor, recoveryLabels } from '../apps/web/src/features/api/recovery.js';

describe('recovery actions', () => {
  it('maps contract errors to a user action', () => {
    expect(recoveryFor({ code: 'INVALID_CURSOR' })).toBe('REREAD_AND_REVIEW');
    expect(recoveryFor({ code: 'PROTOCOL_VERSION_UNSUPPORTED' })).toBe('UPGRADE_CLIENT');
    expect(recoveryFor({ code: 'SYNC_RESET_REQUIRED' })).toBe('RESET_CACHE');
    expect(recoveryFor({ code: 'UNAUTHORIZED' })).toBe('REAUTHORIZE');
    expect(recoveryFor({ code: 'WHATEVER' })).toBe('FIX_REQUEST');
    expect(recoveryLabels.REREAD_AND_REVIEW).toBe('重新读取并核对');
  });

  it('prefers an explicit server recovery value', () => {
    expect(recoveryFor({ code: 'NETWORK', recovery: 'REREAD_AND_REVIEW' })).toBe(
      'REREAD_AND_REVIEW',
    );
  });
});
