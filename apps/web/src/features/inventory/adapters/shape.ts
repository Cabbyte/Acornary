import type {
  ItemDetailV2,
  ItemRecordV2,
} from '../../../../../../packages/contracts/src/read-v2.js';

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
