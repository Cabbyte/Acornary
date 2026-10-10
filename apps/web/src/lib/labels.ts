import { entityId } from '../../../../packages/contracts/src/ids.js';
import { attr, type ItemRecord } from '../../../../packages/contracts/src/web.js';

// Reversible representation of the existing UUID, not an access token or a new identity.
export function compactItemId(id: string): string {
  const uuid = entityId('item').parse(id).slice(5).replaceAll('-', '');
  return btoa(String.fromCharCode(...uuid.match(/../g)!.map((v) => parseInt(v, 16))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export function expandItemId(value: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return;
  try {
    const bytes = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==');
    const h = Array.from(bytes, (v) => v.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    const id = `item_${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    if (entityId('item').safeParse(id).success && compactItemId(id) === value) return id;
  } catch {
    /* Malformed links never select an item. */
  }
}
export function itemLabelURL(id: string, origin: string): string {
  return `${new URL(origin).origin}/i/${compactItemId(id)}`;
}
export function itemDate(item: ItemRecord) {
  const expiry = attr(item, 'lifecycle')?.expiry;
  const title =
    expiry?.date_kind === 'ESTIMATED'
      ? '计划吃完'
      : expiry?.date_kind === 'USE_BY'
        ? '保质期'
        : expiry?.date_kind === 'BEST_BEFORE'
          ? '最佳食用期'
          : '到期日期';
  return { title, date: expiry?.date, text: expiry?.date ?? '日期未记录' };
}
export function canPrintLabels(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'bluetooth' in navigator &&
    !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export type LabelStatus = 'pending' | 'printing' | 'done' | 'uncertain';
export interface LabelPage<T> {
  id: string;
  image: T;
}
export interface LabelPrinter<T> {
  print(image: T): Promise<void>;
}
// No retries: after a transport error the current sheet may already have printed.
export async function printLabelBatch<T>(
  pages: LabelPage<T>[],
  printer: LabelPrinter<T>,
  signal: AbortSignal,
  update: (id: string, status: LabelStatus) => void,
) {
  for (const page of pages) {
    if (signal.aborted) return;
    update(page.id, 'printing');
    try {
      await printer.print(page.image);
      update(page.id, 'done');
    } catch (error) {
      update(page.id, 'uncertain');
      throw error;
    }
  }
}
