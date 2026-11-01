import { useMemo } from 'react';
import { useInventory } from '../../lib/inventory';
import type { InventorySnapshot } from '../../../../../packages/contracts/src/web.js';
import type { SnapshotV2 } from '../../../../../packages/contracts/src/read-v2.js';
import { adaptSnapshot } from './adapters/snapshot.js';
import type { GroupView, InventoryView, ItemView, NoteView } from './model/types.js';

export function useInventoryView(): InventoryView {
  const { data } = useInventory();
  return useMemo(() => adaptSnapshot(data as unknown as InventorySnapshot | SnapshotV2), [data]);
}

export function useItemView(id: string | null | undefined): ItemView | undefined {
  const view = useInventoryView();
  return useMemo(() => (id ? view.items.find((item) => item.id === id) : undefined), [view, id]);
}

export function useGroupView(id: string | null | undefined): GroupView | undefined {
  const view = useInventoryView();
  return useMemo(() => (id ? view.groups.find((group) => group.id === id) : undefined), [view, id]);
}

export function useItemNotes(id: string | null | undefined): NoteView[] {
  const view = useInventoryView();
  return id ? (view.notesByItem[id] ?? []) : [];
}
