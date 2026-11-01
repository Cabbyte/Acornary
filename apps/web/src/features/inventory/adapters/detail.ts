import type {
  AttachmentSummaryV2,
  ItemDetailV2,
  NoteSummaryV2,
  NoteV2,
  SplitInfoV2,
} from '../../../../../../packages/contracts/src/read-v2.js';
import type {
  Attribute,
  ItemRecord,
  NoteRecord,
} from '../../../../../../packages/contracts/src/web.js';
import type {
  AttachmentView,
  DateFactView,
  ItemDetailView,
  InventoryView,
} from '../model/types.js';
import { nextDateFact, reminderToFacts } from './dates.js';
import { toNoteView } from './notes.js';
import { adaptItem } from './record.js';
import { isItemDetailV2 } from './shape.js';

type NoteSource = NoteRecord | NoteSummaryV2 | NoteV2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isNoteSource = (value: unknown): value is NoteSource =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  (typeof value.item_id === 'string' ||
    (isRecord(value.target) && typeof value.target.id === 'string'));

const noteList = (value: unknown): NoteSource[] =>
  Array.isArray(value) ? value.filter(isNoteSource) : [];

const pathIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const reminderOf = (value: unknown): { date?: string; basis: string[] } | null => {
  if (!isRecord(value)) return null;
  const date = textValue(value.date);
  const basis = Array.isArray(value.basis)
    ? value.basis.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { ...(date ? { date } : {}), basis };
};

const splitOf = (value: unknown): SplitInfoV2 | null => {
  if (!isRecord(value)) return null;
  const { split_id, source_item_id, count, created_at } = value;
  if (
    typeof split_id !== 'string' ||
    typeof source_item_id !== 'string' ||
    typeof count !== 'number' ||
    typeof created_at !== 'string' ||
    !Array.isArray(value.child_item_ids)
  )
    return null;
  return {
    split_id,
    source_item_id,
    child_item_ids: value.child_item_ids.filter((id): id is string => typeof id === 'string'),
    count,
    created_at,
  };
};

export function adaptAttachment(raw: AttachmentSummaryV2): AttachmentView {
  return {
    id: raw.id,
    targetKind: raw.target.kind,
    mimeType: raw.mime_type,
    fileSize: raw.file_size,
    width: raw.width ?? null,
    height: raw.height ?? null,
    caption: raw.caption ?? null,
    sortOrder: raw.sort_order,
    sensitivity: raw.sensitivity,
    thumbnailUrl: raw.thumbnail_url ?? null,
  };
}

const itemContext = (
  snapshot: InventoryView,
  itemId: string,
  catalogNodeId: string,
  catalogName?: string,
) => {
  const catalogNode = snapshot.catalog.find((record) => record.id === catalogNodeId);
  const existing = snapshot.items.find((item) => item.id === itemId);
  return {
    catalogName: catalogName ?? catalogNode?.name,
    profile: catalogNode?.profile ?? existing?.profile ?? null,
    ...(existing
      ? {
          location: {
            id: existing.location.id,
            path: [...existing.location.path],
            label: existing.location.label,
          },
        }
      : {}),
  };
};

export function adaptItemDetail(
  raw: unknown,
  snapshot: InventoryView,
  now: Date = new Date(),
): ItemDetailView {
  if (isItemDetailV2(raw)) {
    const notes = Array.isArray(raw.notes) ? raw.notes.map(toNoteView) : [];
    const item = adaptItem(
      raw.item,
      notes,
      itemContext(snapshot, raw.item.id, raw.item.catalog_node_id),
    );
    const dates = (Array.isArray(raw.dates) ? raw.dates.map(nextDateFact) : []).filter(
      (fact): fact is DateFactView => fact !== null,
    );
    return {
      item,
      pathIds: pathIds(raw.path_ids),
      dates,
      notes,
      attachments: Array.isArray(raw.attachments) ? raw.attachments.map(adaptAttachment) : [],
      split: splitOf(raw.split),
    };
  }
  const detail: Record<string, unknown> = isRecord(raw) ? raw : {};
  const id = textValue(detail.id) ?? '';
  const catalogNodeId = textValue(detail.catalog_node_id) ?? '';
  // Retired template IDs sit outside the legacy TemplateId union; keep them verbatim.
  const record = {
    id,
    parent_id: textValue(detail.parent_id) ?? null,
    catalog_node_id: catalogNodeId,
    display_name: textValue(detail.display_name) ?? null,
    revision: typeof detail.revision === 'number' ? detail.revision : 0,
    attributes: (Array.isArray(detail.attributes) ? detail.attributes : []) as Attribute[],
    created_at: textValue(detail.created_at) ?? '',
    updated_at: textValue(detail.updated_at),
  } as ItemRecord;
  const detailNotes = Array.isArray(detail.notes) ? noteList(detail.notes) : null;
  const notes = detailNotes ? detailNotes.map(toNoteView) : (snapshot.notesByItem[id] ?? []);
  const item = adaptItem(
    record,
    notes,
    itemContext(snapshot, id, catalogNodeId, textValue(detail.catalog_name)),
  );
  return {
    item,
    pathIds: pathIds(detail.path_ids),
    dates: reminderToFacts(reminderOf(detail.reminder), snapshot.household.timezone, now),
    notes,
    attachments: [],
    split: null,
  };
}
