import type {
  ItemDetailV2,
  ItemRecordV2,
  SnapshotV2,
} from '../../../../../../packages/contracts/src/read-v2.js';

export function isSnapshotV2(value: unknown): value is SnapshotV2 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.protocol === 2 && Array.isArray(snapshot.items);
}

export function isItemDetailV2(value: unknown): value is ItemDetailV2 {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Record<string, unknown>;
  return !!detail.item && Array.isArray(detail.dates);
}

export function isItemRecordV2(value: unknown): value is ItemRecordV2 {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.note_count === 'number' && Array.isArray(item.attributes);
}
