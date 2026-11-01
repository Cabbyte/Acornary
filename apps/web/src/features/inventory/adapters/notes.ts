import type { NoteSummaryV2, NoteV2 } from '../../../../../../packages/contracts/src/read-v2.js';
import type { NoteRecord } from '../../../../../../packages/contracts/src/web.js';
import type { NoteView } from '../model/types.js';

const MAX_EXCERPT = 160;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isV2Note = (note: NoteRecord | NoteSummaryV2 | NoteV2): note is NoteSummaryV2 | NoteV2 =>
  'target' in note && isRecord(note.target);

export function toNoteView(note: NoteRecord | NoteSummaryV2 | NoteV2): NoteView {
  if (isV2Note(note)) {
    const body = 'body' in note && typeof note.body === 'string' ? note.body : undefined;
    return {
      id: note.id,
      itemId: note.target.id,
      title: note.title ?? null,
      excerpt: (note.excerpt ?? '').slice(0, MAX_EXCERPT),
      ...(body === undefined ? {} : { body }),
      updatedAt: note.updated_at,
      sensitivity: note.sensitivity ?? 'NORMAL',
    };
  }
  const body = typeof note.body === 'string' ? note.body : '';
  return {
    id: note.id,
    itemId: note.item_id,
    title: note.title ?? null,
    excerpt: body.slice(0, MAX_EXCERPT),
    body,
    updatedAt: note.updated_at,
    sensitivity: 'NORMAL',
  };
}

export function groupNotesByItem(
  notes: readonly (NoteRecord | NoteSummaryV2 | NoteV2)[],
): Record<string, NoteView[]> {
  const grouped: Record<string, NoteView[]> = {};
  for (const note of notes) {
    const view = toNoteView(note);
    (grouped[view.itemId] ??= []).push(view);
  }
  return grouped;
}
