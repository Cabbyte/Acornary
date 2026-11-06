import { randomUUID, createHash } from 'node:crypto';
import { query, transaction, type Client, requireTransaction } from './db.js';
import type { Context } from './service.js';
import {
  fileSchemas,
  fileReads,
  type NoteTarget,
  type AttachmentTarget,
} from '../../../../packages/contracts/src/notes.js';
import {
  canonical,
  changes,
  DomainError,
  requireFact,
} from '../../../../packages/domain/src/index.js';
import { currentChangeId } from './change-watermark.js';
import { recordSyncChange } from './sync.js';
import { auditReveal, redactFor } from './redaction.js';
import { attachmentRead, attachmentWrite, redactAttachmentReceipt } from './attachments.js';

export function authorizeFiles(c: Client, ctx: Context, write = false) {
  requireFact(
    query(c, 'SELECT 1 FROM actors WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      ctx.actor_id,
    ]).rows.length,
    'FORBIDDEN',
    'Invalid household context.',
  );
  if (write) requireTransaction(c);
}
export function noteRow(c: Client, ctx: Context, id: string) {
  const row = query(c, 'SELECT * FROM notes WHERE household_id=?1 AND id=?2', [
    ctx.household_id,
    id,
  ]).rows[0];
  requireFact(row, 'NOT_FOUND', 'Note not found.');
  return row;
}
export function ownerTarget(c: Client, ctx: Context, target: AttachmentTarget): NoteTarget {
  if (target.kind === 'NOTE') {
    const row = noteRow(c, ctx, target.id);
    return { kind: row.target_kind, id: row.target_id };
  }
  const table = target.kind === 'ITEM' ? 'items' : 'catalog_nodes';
  requireFact(
    query(c, `SELECT 1 FROM ${table} WHERE household_id=?1 AND id=?2`, [
      ctx.household_id,
      target.id,
    ]).rows.length,
    'NOT_FOUND',
    'Target not found.',
  );
  return target;
}
export function checkTargetRevision(c: Client, ctx: Context, target: NoteTarget, input: any) {
  const expected = input.expected_revisions?.[target.id];
  requireFact(expected !== undefined, 'MISSING_EXPECTED_REVISION', 'Supply the target revision.');
  const row = query(
    c,
    `SELECT revision FROM ${target.kind === 'ITEM' ? 'items' : 'catalog_nodes'} WHERE household_id=?1 AND id=?2`,
    [ctx.household_id, target.id],
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Target not found.');
  requireFact(row.revision === expected, 'REVISION_CONFLICT', 'Re-read the target revision.');
  return row.revision as number;
}
export function fileEvent(
  c: Client,
  ctx: Context,
  target: NoteTarget,
  input: any,
  operation_id: string,
  event_type: string,
  delta: any[],
) {
  const result: any = {
    operation_id,
    changed: false,
    affected_objects: [],
    event_ids: [],
    summary: 'No changes.',
  };
  const revision = checkTargetRevision(c, ctx, target, input);
  if (!delta.length) return result;
  query(
    c,
    `UPDATE ${target.kind === 'ITEM' ? 'items' : 'catalog_nodes'} SET revision=revision+1,updated_at=(SELECT now FROM cf_clock) WHERE household_id=?1 AND id=?2`,
    [ctx.household_id, target.id],
  );
  const event_id = 'event_' + randomUUID();
  query(
    c,
    'INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,before_revision,after_revision,changes,actor_id,source,occurred_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)',
    [
      event_id,
      ctx.household_id,
      target.kind,
      target.id,
      operation_id,
      event_type,
      revision,
      revision + 1,
      JSON.stringify(delta),
      ctx.actor_id,
      ctx.source,
      input.occurred_at ?? new Date().toISOString(),
    ],
  );
  recordSyncChange(c, ctx.household_id, target.kind, target.id, revision + 1, operation_id);
  return {
    ...result,
    changed: true,
    affected_objects: [{ ...target, before_revision: revision, after_revision: revision + 1 }],
    event_ids: [event_id],
    summary: '1 object changed.',
  };
}
export function noteSummary(row: any) {
  return redactFor(
    'summary',
    {
      id: row.id,
      target: { kind: row.target_kind, id: row.target_id },
      title: row.title,
      excerpt: Array.from(row.body as string)
        .slice(0, 160)
        .join(''),
      created_by: row.created_by,
      created_at: row.created_at,
      updated_by: row.updated_by,
      updated_at: row.updated_at,
      archived: !!row.archived_at,
      sensitivity: row.sensitivity,
    },
    { title: row.sensitivity, excerpt: row.sensitivity },
  );
}
// Shared by standalone commands and the atomic edit_item path. Never touches target attributes.
export function mutateNote(
  c: Client,
  ctx: Context,
  target: NoteTarget,
  input: any,
  archive = false,
) {
  const prior = input.note_id ? noteRow(c, ctx, input.note_id) : undefined;
  if (prior)
    requireFact(
      prior.target_kind === target.kind && prior.target_id === target.id,
      'NOT_FOUND',
      'Note not found on target.',
    );
  const id = prior?.id ?? 'note_' + randomUUID();
  const next = {
    title: input.title === undefined ? (prior?.title ?? null) : input.title,
    body: archive ? prior.body : input.body,
    sensitivity: input.sensitivity ?? prior?.sensitivity ?? 'NORMAL',
    archived: archive ? input.archived : !!prior?.archived_at,
  };
  const fields = (v: any) =>
    Object.fromEntries(Object.entries(v).map(([k, value]) => [`notes.${id}.${k}`, value]));
  const left = prior
    ? fields({
        title: prior.title,
        body: prior.body,
        sensitivity: prior.sensitivity,
        archived: !!prior.archived_at,
      })
    : {};
  const right = fields(next);
  if (changes(left, right).length) {
    if (prior)
      query(
        c,
        'UPDATE notes SET title=?1,body=?2,sensitivity=?3,archived_at=CASE WHEN ?4 THEN COALESCE(archived_at,(SELECT now FROM cf_clock)) ELSE NULL END,updated_by=?5,updated_at=(SELECT now FROM cf_clock) WHERE household_id=?6 AND id=?7',
        [
          next.title,
          next.body,
          next.sensitivity,
          next.archived,
          ctx.actor_id,
          ctx.household_id,
          id,
        ],
      );
    else
      query(
        c,
        'INSERT INTO notes(id,household_id,target_kind,target_id,title,body,created_by,updated_by,sensitivity) VALUES(?1,?2,?3,?4,?5,?6,?7,?7,?8)',
        [
          id,
          ctx.household_id,
          target.kind,
          target.id,
          next.title,
          next.body,
          ctx.actor_id,
          next.sensitivity,
        ],
      );
  }
  return { left, right, row: noteRow(c, ctx, id) };
}
// New list cursors are query-bound; existing query cursor code is untouched.
export function filePage(input: any, household: string, kind: string) {
  const binding = createHash('sha256')
    .update(
      canonical({
        household,
        kind,
        target: input.target,
        archived: input.include_archived,
        limit: input.limit,
      }),
    )
    .digest('hex');
  let last = '',
    watermark: string | undefined;
  if (input.cursor) {
    try {
      const v = JSON.parse(Buffer.from(input.cursor, 'base64url').toString());
      if (
        v.binding !== binding ||
        typeof v.last !== 'string' ||
        !/^(note|attachment)_[0-9a-f-]{36}$/.test(v.last) ||
        !/^\d+$/.test(v.watermark)
      )
        throw Error();
      last = v.last;
      watermark = v.watermark;
    } catch {
      throw new DomainError('INVALID_CURSOR', 'Invalid file cursor.');
    }
  }
  return {
    last,
    watermark,
    next: (last: string, watermark: string) =>
      Buffer.from(JSON.stringify({ binding, last, watermark })).toString('base64url'),
  };
}
export function listNotes(c: Client, ctx: Context, input: any) {
  const page = filePage(input, ctx.household_id, 'notes');
  const watermark = String(currentChangeId(c, ctx.household_id));
  const rows = query(
    c,
    `SELECT * FROM notes WHERE household_id=?1 AND (?2 IS NULL OR (target_kind=?2 AND target_id=?3)) AND (?4 OR archived_at IS NULL) AND id>?5 ORDER BY id LIMIT ?6`,
    [
      ctx.household_id,
      input.target?.kind ?? null,
      input.target?.id ?? null,
      input.include_archived ?? false,
      page.last,
      (input.limit ?? 100) + 1,
    ],
  ).rows;
  const data = rows.slice(0, input.limit ?? 100).map(noteSummary);
  return {
    data,
    next_cursor:
      rows.length > (input.limit ?? 100)
        ? page.next(data.at(-1)!.id, page.watermark ?? watermark)
        : null,
    as_of_change_id: watermark,
    stale: !!page.watermark && page.watermark !== watermark,
  };
}
export function executeFiles(ctx: Context, name: keyof typeof fileSchemas, raw: unknown) {
  if (
    !fileReads.has(name) &&
    name !== 'create_attachment_upload' &&
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    !Object.hasOwn(raw, 'expected_revisions')
  )
    throw new DomainError('MISSING_EXPECTED_REVISION', 'Supply the target revision.');
  const parsed = fileSchemas[name].safeParse(raw);
  if (!parsed.success)
    throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Invalid note or attachment request.');
  const input: any = parsed.data;
  if (name === 'create_attachment_upload')
    requireFact(
      ctx.source !== 'MCP',
      'FORBIDDEN',
      'Upload tickets require the private attachment transport.',
    );
  return transaction(ctx.db, (c) => {
    const reading = fileReads.has(name);
    authorizeFiles(c, ctx, !reading);
    if (name === 'list_notes') return listNotes(c, ctx, input);
    if (name === 'get_note') {
      const row = noteRow(c, ctx, input.note_id);
      const value = {
        ...noteSummary(row),
        title: row.title,
        excerpt: Array.from(row.body as string)
          .slice(0, 160)
          .join(''),
        body: row.body,
        body_format: row.body_format,
        redacted_paths: [],
      };
      return redactFor(
        input.reveal_sensitive ? auditReveal(c, ctx, 'NOTE', row.id) : 'detail',
        value,
        { title: row.sensitivity, excerpt: row.sensitivity, body: row.sensitivity },
      );
    }
    if (name === 'list_attachments') return attachmentRead(c, ctx, input);
    const fingerprint = createHash('sha256').update(canonical({ name, input })).digest('hex');
    const old = query(
      c,
      'SELECT fingerprint,result,result_payload FROM operations WHERE household_id=?1 AND actor_id=?2 AND idempotency_key=?3',
      [ctx.household_id, ctx.actor_id, input.idempotency_key],
    ).rows[0];
    if (old) {
      requireFact(
        old.fingerprint === fingerprint,
        'IDEMPOTENCY_CONFLICT',
        'Key was used with different parameters.',
      );
      const replay = structuredClone(old.result);
      // Reapply current classification; a later sensitivity change must not expose an old receipt.
      if (replay.note_id) replay.note = noteSummary(noteRow(c, ctx, replay.note_id));
      if (replay.attachment)
        replay.attachment = redactAttachmentReceipt(c, ctx, replay.attachment.id);
      return replay;
    }
    const operation = 'operation_' + randomUUID();
    let result: any;
    if (name === 'add_note' || name === 'update_note' || name === 'archive_note') {
      const prior = input.note_id ? noteRow(c, ctx, input.note_id) : undefined;
      const target = prior ? { kind: prior.target_kind, id: prior.target_id } : input.target;
      if (input.target)
        requireFact(
          canonical(input.target) === canonical(target),
          'NOT_FOUND',
          'Note not found on target.',
        );
      requireFact(target, 'NOT_FOUND', 'A note target is required.');
      checkTargetRevision(c, ctx, target, input);
      const note = mutateNote(c, ctx, target, input, name === 'archive_note');
      result = {
        ...fileEvent(
          c,
          ctx,
          target,
          input,
          operation,
          { add_note: 'NOTE_CREATE', update_note: 'NOTE_UPDATE', archive_note: 'NOTE_ARCHIVE' }[
            name
          ],
          changes(note.left, note.right),
        ),
        note_id: note.row.id,
        note: noteSummary(note.row),
      };
    } else result = attachmentWrite(c, ctx, name, input, operation);
    c.saveOperation(ctx.household_id, ctx.actor_id, input.idempotency_key, fingerprint, result);
    return result;
  });
}
