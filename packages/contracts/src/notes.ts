import { z } from 'zod';
import { entityId, uuidPattern } from './ids.js';
export const sensitivity = z.enum(['NORMAL', 'SENSITIVE', 'SECRET']);
export type Sensitivity = z.infer<typeof sensitivity>;
export const noteTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ITEM'), id: entityId('item') }),
  z.strictObject({ kind: z.literal('CATALOG_NODE'), id: entityId('catalog_node') }),
]);
export const attachmentTarget = z.union([
  noteTarget,
  z.strictObject({ kind: z.literal('NOTE'), id: entityId('note') }),
]);
export type NoteTarget = z.infer<typeof noteTarget>;
export type AttachmentTarget = z.infer<typeof attachmentTarget>;
const fileId = (kind: string) => z.string().regex(new RegExp(`^${kind}_${uuidPattern}$`));
const write = {
  idempotency_key: z.string().min(1).max(200),
  expected_revisions: z.record(
    z.union([entityId('item'), entityId('catalog_node')]),
    z.int().positive(),
  ),
  occurred_at: z.iso.datetime({ offset: true }).optional(),
};
const page = {
  cursor: z.string().max(4096).optional(),
  limit: z.int().min(1).max(200).default(100),
};
const content = {
  title: z.string().max(500).nullable().optional(),
  body: z.string().max(100000),
  sensitivity: sensitivity.optional(),
};
export const fileSchemas = {
  add_note: z
    .strictObject({
      ...write,
      ...content,
      target: noteTarget.optional(),
      item_id: entityId('item').optional(),
    })
    .refine((v) => !!v.target !== !!v.item_id),
  update_note: z.strictObject({
    ...write,
    ...content,
    note_id: entityId('note'),
    target: noteTarget.optional(),
    item_id: entityId('item').optional(),
  }),
  archive_note: z.strictObject({
    ...write,
    note_id: entityId('note'),
    target: noteTarget.optional(),
    archived: z.boolean(),
  }),
  list_notes: z.strictObject({
    ...page,
    target: noteTarget.optional(),
    include_archived: z.boolean().default(false),
  }),
  get_note: z.strictObject({
    note_id: entityId('note'),
    reveal_sensitive: z.boolean().default(false),
  }),
  create_attachment_upload: z.strictObject({
    idempotency_key: write.idempotency_key,
    target: attachmentTarget,
    filename: z.string().min(1).max(500),
    mime_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    file_size: z.int().positive(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  complete_attachment_upload: z.strictObject({
    ...write,
    upload_id: fileId('upload'),
    target: attachmentTarget,
    caption: z.string().max(500).optional(),
    sort_order: z.int().default(0),
    sensitivity: sensitivity.default('NORMAL'),
  }),
  detach_attachment: z.strictObject({ ...write, attachment_id: fileId('attachment') }),
  list_attachments: z.strictObject({ ...page, target: attachmentTarget }),
};
export const fileReads = new Set(['list_notes', 'get_note', 'list_attachments']);
export const fileOperations = new Set(Object.keys(fileSchemas));

// Sensitive fields are absent after redaction; clients must use redacted_paths.
export type NoteSummary = {
  id: string;
  target: NoteTarget;
  title?: string | null;
  excerpt?: string;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  archived: boolean;
  sensitivity: Sensitivity;
  redacted_paths: string[];
};
export type Note = NoteSummary & { body?: string; body_format: 'Markdown' };
export type AttachmentSummary = {
  id: string;
  target: AttachmentTarget;
  mime_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  file_size: number;
  width: number | null;
  height: number | null;
  caption?: string | null;
  sort_order: number;
  sensitivity: Sensitivity;
  created_at: string;
  thumbnail_url?: string | null;
  redacted_paths: string[];
};
