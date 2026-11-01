import { z } from 'zod';
import { entityId } from '../../../../../packages/contracts/src/ids.js';
import { schemas, type Operation } from '../../../../../packages/contracts/src/index.js';

const envelope = {
  expected_revisions: z.record(z.string(), z.number().int().positive()),
  idempotency_key: z.string().min(1).max(200),
  title: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(100000),
};
export const addNoteV2 = z.object({
  ...envelope,
  target: z.object({ kind: z.literal('ITEM'), id: entityId('item') }),
});
export const updateNoteV2 = z.object({ ...envelope, note_id: entityId('note') });
const addNoteV1 = z.strictObject({ ...envelope, item_id: entityId('item') });
/** Both generations are valid persisted attempts; dispatch never rewrites a retry. */
export function parseWriteCommand(operation: Operation, payload: unknown, notesV2 = false) {
  if (operation === 'add_note') return (notesV2 ? addNoteV2 : addNoteV1).safeParse(payload);
  if (notesV2 && operation === 'update_note') return updateNoteV2.safeParse(payload);
  return schemas[operation].safeParse(payload);
}
export function validPersistedCommand(operation: Operation, payload: Record<string, unknown>) {
  if (schemas[operation].safeParse(payload).success) return true;
  return (
    (operation === 'add_note' && addNoteV2.safeParse(payload).success) ||
    (operation === 'update_note' && updateNoteV2.safeParse(payload).success)
  );
}
