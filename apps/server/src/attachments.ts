import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, rm, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { query, transaction, type Client } from './db.js';
import type { Context } from './service.js';
import { DomainError, requireFact, changes } from '../../../packages/domain/src/index.js';
import { authorizeFiles, ownerTarget, checkTargetRevision, fileEvent, filePage } from './notes.js';
import { auditReveal, redactFor } from './redaction.js';
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const HOUSEHOLD_QUOTA = 5 * 1024 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
type Mime = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export function sniffMime(bytes: Buffer): Mime {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (bytes.length >= 8 && /^%PDF-1\.[0-7]|^%PDF-2\.0/.test(bytes.toString('ascii', 0, 8)))
    return 'application/pdf';
  throw new DomainError(
    'ATTACHMENT_TYPE_UNSUPPORTED',
    'Only JPEG, PNG, WebP and PDF are supported.',
  );
}
export interface MediaProcessor {
  process(
    bytes: Buffer,
    mime: Mime,
  ): Promise<{
    bytes: Buffer;
    width: number | null;
    height: number | null;
    exifStripped: boolean;
    thumbnail?: Buffer;
  }>;
}
// No decoder dependency: do not claim orientation, pixel validation or EXIF stripping.
export class PassthroughMediaProcessor implements MediaProcessor {
  async process(bytes: Buffer) {
    return { bytes, width: null, height: null, exifStripped: false };
  }
}
export interface BlobStore {
  stage(key: string, bytes: Buffer): Promise<void>;
  inspect(key: string): Promise<Buffer>;
  finalize(key: string): Promise<void>;
  open(key: string): Promise<Buffer>;
  deleteUnreferenced(key: string): Promise<void>;
}
export class LocalBlobStore implements BlobStore {
  constructor(
    readonly root = resolve(process.env.ACORNARY_ATTACHMENT_ROOT ?? '.local/attachments'),
  ) {}
  private path(key: string, staged = false) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid internal storage key.');
    return join(this.root, key + (staged ? '.stage' : '.blob'));
  }
  async stage(key: string, bytes: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await writeFile(this.path(key, true), bytes, { mode: 0o600 });
  }
  inspect(key: string) {
    return readFile(this.path(key, true));
  }
  async finalize(key: string) {
    await rename(this.path(key, true), this.path(key));
  }
  open(key: string) {
    return readFile(this.path(key));
  }
  async deleteUnreferenced(key: string) {
    await rm(this.path(key, true), { force: true });
    await rm(this.path(key), { force: true });
  }
}
const key = () => randomBytes(32).toString('hex');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const store = () => new LocalBlobStore();
export function attachmentSummary(row: any) {
  return redactFor(
    'summary',
    {
      id: row.id,
      target: { kind: row.target_kind, id: row.target_id },
      mime_type: row.mime_type,
      file_size: Number(row.file_size),
      width: row.width,
      height: row.height,
      caption: row.caption,
      sort_order: row.sort_order,
      sensitivity: row.sensitivity,
      created_at: row.created_at,
      thumbnail_url: row.thumbnail_key ? `/api/attachments/${row.id}?variant=thumb` : null,
    },
    { caption: row.sensitivity, thumbnail_url: row.sensitivity },
  );
}
const attachmentSelect =
  'SELECT a.*,b.mime_type,b.file_size,b.width,b.height,b.thumbnail_key,b.storage_key FROM attachments a JOIN attachment_blobs b ON b.household_id=a.household_id AND b.id=a.blob_id';
async function attachmentRow(c: Client, ctx: Context, id: string, includeDetached = false) {
  const row = (
    await query(
      c,
      `${attachmentSelect} WHERE a.household_id=$1 AND a.id=$2 ${includeDetached ? '' : 'AND a.detached_at IS NULL'}`,
      [ctx.household_id, id],
    )
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Attachment not found.');
  // A note's classification is a floor for its attachments, including binary downloads.
  if (row.target_kind === 'NOTE') {
    const note = (
      await query(c, 'SELECT sensitivity FROM notes WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        row.target_id,
      ])
    ).rows[0];
    if (
      note?.sensitivity === 'SECRET' ||
      (note?.sensitivity === 'SENSITIVE' && row.sensitivity === 'NORMAL')
    )
      row.sensitivity = note.sensitivity;
  }
  return row;
}
export async function redactAttachmentReceipt(c: Client, ctx: Context, id: string) {
  return attachmentSummary(await attachmentRow(c, ctx, id, true));
}
export async function attachmentRead(c: Client, ctx: Context, input: any) {
  await ownerTarget(c, ctx, input.target);
  const page = filePage(input, ctx.household_id, 'attachments');
  const rows = (
    await query(
      c,
      `${attachmentSelect} WHERE a.household_id=$1 AND a.target_kind=$2 AND a.target_id=$3 AND a.detached_at IS NULL AND a.id>$4 ORDER BY a.id LIMIT $5`,
      [ctx.household_id, input.target.kind, input.target.id, page.last, (input.limit ?? 100) + 1],
    )
  ).rows;
  let inherited = 'NORMAL';
  if (input.target.kind === 'NOTE')
    inherited = (
      await query(c, 'SELECT sensitivity FROM notes WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        input.target.id,
      ])
    ).rows[0].sensitivity;
  const data = rows
    .slice(0, input.limit ?? 100)
    .map((row) =>
      attachmentSummary({
        ...row,
        sensitivity:
          inherited === 'SECRET' || (inherited === 'SENSITIVE' && row.sensitivity === 'NORMAL')
            ? inherited
            : row.sensitivity,
      }),
    );
  return {
    data,
    next_cursor: rows.length > (input.limit ?? 100) ? page.next(data.at(-1)!.id, '0') : null,
  };
}
async function capacity(c: Client, ctx: Context, target: any) {
  const used = (
    await query(
      c,
      `SELECT
    (SELECT COALESCE(sum(GREATEST(b.file_size, COALESCE((SELECT max(s.file_size) FROM upload_sessions s WHERE s.blob_id=b.id), b.file_size))),0) FROM attachment_blobs b WHERE b.household_id=$1) +
    (SELECT COALESCE(sum(file_size),0) FROM upload_sessions WHERE household_id=$1 AND blob_id IS NULL AND expires_at>now()) AS bytes,
    (SELECT count(*) FROM attachments WHERE household_id=$1 AND target_kind=$2 AND target_id=$3 AND detached_at IS NULL) +
    (SELECT count(*) FROM upload_sessions WHERE household_id=$1 AND target_kind=$2 AND target_id=$3 AND completed_attachment_id IS NULL AND expires_at>now()) AS slots`,
      [ctx.household_id, target.kind, target.id],
    )
  ).rows[0];
  return { bytes: Number(used.bytes), slots: Number(used.slots) };
}
export async function attachmentWrite(
  c: Client,
  ctx: Context,
  name: string,
  input: any,
  operation: string,
) {
  if (name === 'create_attachment_upload') {
    // Generic MCP text results cannot carry private app-only tickets. Enable with the plugin lane's private transport.
    requireFact(
      ctx.source !== 'MCP',
      'FORBIDDEN',
      'Upload tickets require the private attachment transport.',
    );
    requireFact(
      input.file_size <= MAX_FILE_SIZE,
      'ATTACHMENT_TOO_LARGE',
      'Files are limited to 25 MiB.',
    );
    await ownerTarget(c, ctx, input.target);
    const used = await capacity(c, ctx, input.target);
    requireFact(
      used.bytes + input.file_size <= HOUSEHOLD_QUOTA,
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Household storage quota exceeded.',
    );
    requireFact(
      used.slots < MAX_ATTACHMENTS,
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Target attachment limit exceeded.',
    );
    const id = 'upload_' + randomUUID(),
      ticket = key(),
      storageKey = key();
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    await query(
      c,
      'INSERT INTO upload_sessions(id,household_id,actor_id,target_kind,target_id,file_size,expected_sha256,ticket_hash,expires_at,storage_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id,
        ctx.household_id,
        ctx.actor_id,
        input.target.kind,
        input.target.id,
        input.file_size,
        input.sha256 ?? null,
        hash(ticket),
        expires,
        storageKey,
      ],
    );
    return {
      operation_id: operation,
      changed: false,
      affected_objects: [],
      event_ids: [],
      summary: 'Upload reserved.',
      upload_id: id,
      upload_url: `/api/attachments/upload/${id}`,
      method: 'PUT',
      headers: {
        'X-Acornary-Upload-Ticket': ticket,
        'Content-Type': 'application/octet-stream',
        'X-Acornary-Request': 'web',
        'X-Acornary-Protocol': '2',
      },
      expires_at: expires,
      max_size: MAX_FILE_SIZE,
      quota_warning: used.bytes + input.file_size >= HOUSEHOLD_QUOTA * 0.8,
    };
  }
  if (name === 'complete_attachment_upload') {
    const session = (
      await query(
        c,
        'SELECT * FROM upload_sessions WHERE household_id=$1 AND actor_id=$2 AND id=$3',
        [ctx.household_id, ctx.actor_id, input.upload_id],
      )
    ).rows[0];
    requireFact(session, 'NOT_FOUND', 'Upload session not found.');
    requireFact(
      session.target_kind === input.target.kind && session.target_id === input.target.id,
      'NOT_FOUND',
      'Upload target does not match.',
    );
    if (session.completed_attachment_id) {
      return {
        operation_id: operation,
        changed: false,
        affected_objects: [],
        event_ids: [],
        summary: 'Upload already completed.',
        attachment: attachmentSummary(
          await attachmentRow(c, ctx, session.completed_attachment_id, true),
        ),
      };
    }
    requireFact(
      new Date(session.expires_at).getTime() > Date.now(),
      'STATE_CONFLICT',
      'Upload ticket expired.',
    );
    requireFact(session.blob_id, 'STATE_CONFLICT', 'Upload binary before completing.');
    const target = await ownerTarget(c, ctx, input.target);
    await checkTargetRevision(c, ctx, target, input);
    const count = (
      await query(
        c,
        'SELECT count(*) FROM attachments WHERE household_id=$1 AND target_kind=$2 AND target_id=$3 AND detached_at IS NULL',
        [ctx.household_id, input.target.kind, input.target.id],
      )
    ).rows[0];
    requireFact(
      Number(count.count) < MAX_ATTACHMENTS,
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Target attachment limit exceeded.',
    );
    const id = 'attachment_' + randomUUID();
    await query(
      c,
      'INSERT INTO attachments(id,household_id,blob_id,target_kind,target_id,caption,sort_order,sensitivity,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        ctx.household_id,
        session.blob_id,
        input.target.kind,
        input.target.id,
        input.caption ?? null,
        input.sort_order,
        input.sensitivity,
        ctx.actor_id,
      ],
    );
    await query(c, 'UPDATE upload_sessions SET completed_attachment_id=$1 WHERE id=$2', [
      id,
      session.id,
    ]);
    return {
      ...(await fileEvent(
        c,
        ctx,
        target,
        input,
        operation,
        'ATTACHMENT_ATTACH',
        changes({}, { [`attachments.${id}`]: true }),
      )),
      attachment: attachmentSummary(await attachmentRow(c, ctx, id)),
    };
  }
  const row = await attachmentRow(c, ctx, input.attachment_id, true);
  const target = await ownerTarget(c, ctx, { kind: row.target_kind, id: row.target_id });
  await checkTargetRevision(c, ctx, target, input);
  if (!row.detached_at) {
    await query(c, 'UPDATE attachments SET detached_at=now() WHERE household_id=$1 AND id=$2', [
      ctx.household_id,
      row.id,
    ]);
    await query(
      c,
      'UPDATE attachment_blobs SET detached_at=now() WHERE household_id=$1 AND id=$2 AND NOT EXISTS(SELECT 1 FROM attachments WHERE blob_id=$2 AND detached_at IS NULL)',
      [ctx.household_id, row.blob_id],
    );
  }
  return fileEvent(
    c,
    ctx,
    target,
    input,
    operation,
    'ATTACHMENT_DETACH',
    row.detached_at ? [] : changes({ [`attachments.${row.id}`]: true }, {}),
  );
}
export async function putAttachment(
  ctx: Context,
  id: string,
  ticket: string,
  bytes: Buffer,
  blobs: BlobStore = store(),
  processor: MediaProcessor = new PassthroughMediaProcessor(),
) {
  requireFact(
    bytes.length <= MAX_FILE_SIZE,
    'ATTACHMENT_TOO_LARGE',
    'Files are limited to 25 MiB.',
  );
  return transaction(async (c) => {
    await authorizeFiles(c, ctx, true);
    const session = (
      await query(
        c,
        'SELECT * FROM upload_sessions WHERE household_id=$1 AND actor_id=$2 AND id=$3',
        [ctx.household_id, ctx.actor_id, id],
      )
    ).rows[0];
    requireFact(
      session && timingSafeEqual(Buffer.from(session.ticket_hash), Buffer.from(hash(ticket))),
      'FORBIDDEN',
      'Invalid upload ticket.',
    );
    requireFact(
      new Date(session.expires_at).getTime() > Date.now() && !session.blob_id,
      'STATE_CONFLICT',
      'Upload ticket expired or already used.',
    );
    requireFact(
      bytes.length === Number(session.file_size),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Upload size does not match reservation.',
    );
    const mime = sniffMime(bytes);
    if (session.expected_sha256)
      requireFact(
        hash(bytes) === session.expected_sha256,
        'ATTRIBUTE_VALIDATION_FAILED',
        'Upload checksum mismatch.',
      );
    const media = await processor.process(bytes, mime);
    requireFact(
      media.bytes.length > 0 &&
        media.bytes.length <= bytes.length &&
        sniffMime(media.bytes) === mime,
      'ATTACHMENT_TOO_LARGE',
      'Processed media exceeds reservation or changes type.',
    );
    const thumb = media.thumbnail;
    // A future processor must include thumbnail bytes in the reservation.
    requireFact(
      !thumb ||
        (media.bytes.length + thumb.length <= bytes.length &&
          sniffMime(thumb) !== 'application/pdf'),
      'ATTACHMENT_TOO_LARGE',
      'Thumbnail exceeds reservation.',
    );
    const thumbKey = thumb ? hash(session.storage_key + ':thumb') : null;
    await blobs.stage(session.storage_key, media.bytes);
    await blobs.inspect(session.storage_key);
    await blobs.finalize(session.storage_key);
    if (thumb && thumbKey) {
      await blobs.stage(thumbKey, thumb);
      await blobs.finalize(thumbKey);
    }
    const blob = 'blob_' + randomUUID();
    try {
      await query(
        c,
        'INSERT INTO attachment_blobs(id,household_id,storage_key,mime_type,file_size,sha256,width,height,thumbnail_key,exif_stripped) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          blob,
          ctx.household_id,
          session.storage_key,
          mime,
          media.bytes.length,
          hash(media.bytes),
          media.width,
          media.height,
          thumbKey,
          media.exifStripped,
        ],
      );
      await query(c, 'UPDATE upload_sessions SET blob_id=$1 WHERE id=$2', [blob, id]);
    } catch (e) {
      if (thumbKey) await blobs.deleteUnreferenced(thumbKey);
      throw e;
    }
    return { uploaded: true };
  });
}
export async function downloadAttachment(
  ctx: Context,
  id: string,
  variant: string | undefined,
  reveal: boolean,
  blobs: BlobStore = store(),
) {
  return transaction(async (c) => {
    await authorizeFiles(c, ctx);
    requireFact(
      variant === undefined || variant === 'thumb',
      'ATTRIBUTE_VALIDATION_FAILED',
      'Unknown attachment variant.',
    );
    const row = await attachmentRow(c, ctx, id);
    if (row.sensitivity !== 'NORMAL') {
      requireFact(reveal, 'REVEAL_AUDIT_REQUIRED', 'Explicit sensitive reveal required.');
      await auditReveal(c, ctx, 'ATTACHMENT', id);
    } else if (reveal) await auditReveal(c, ctx, 'ATTACHMENT', id);
    const storageKey = variant === 'thumb' ? row.thumbnail_key : row.storage_key;
    requireFact(storageKey, 'NOT_FOUND', 'Thumbnail unavailable.');
    const bytes = await blobs.open(storageKey);
    const mime = variant === 'thumb' ? sniffMime(bytes) : row.mime_type;
    return {
      bytes,
      headers: {
        'Content-Type': mime,
        'Content-Disposition': 'attachment',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    };
  });
}
// A backup integration must hold its lease for the entire callback (not merely check once).
export interface BackupLeaseGuard {
  withDeletionLease<T>(
    household: string,
    storageKeys: string[],
    remove: () => Promise<T>,
  ): Promise<T | undefined>;
}
export async function cleanupAttachments(
  ctx: Context,
  blobs: BlobStore = store(),
  leases?: BackupLeaseGuard,
) {
  return transaction(async (c) => {
    await authorizeFiles(c, ctx, true);
    const sessions = (
      await query(
        c,
        "SELECT * FROM upload_sessions WHERE household_id=$1 AND completed_attachment_id IS NULL AND created_at < now()-interval '24 hours'",
        [ctx.household_id],
      )
    ).rows;
    const detached = (
      await query(
        c,
        "SELECT * FROM attachment_blobs b WHERE household_id=$1 AND detached_at < now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM attachments a WHERE a.blob_id=b.id AND a.detached_at IS NULL)",
        [ctx.household_id],
      )
    ).rows;
    let removed = 0;
    for (const entry of [
      ...sessions.map((s) => ({ session: s, blob: null as any })),
      ...detached.map((b) => ({ session: null as any, blob: b })),
    ]) {
      const blob =
        entry.blob ??
        (entry.session.blob_id
          ? (await query(c, 'SELECT * FROM attachment_blobs WHERE id=$1', [entry.session.blob_id]))
              .rows[0]
          : null);
      const storageKey = blob?.storage_key ?? entry.session.storage_key;
      const keys = [storageKey, blob?.thumbnail_key ?? hash(storageKey + ':thumb')];
      const remove = async () => {
        for (const key of keys) await blobs.deleteUnreferenced(key);
        if (entry.session)
          await query(c, 'DELETE FROM upload_sessions WHERE id=$1', [entry.session.id]);
        if (blob) {
          await query(c, 'DELETE FROM upload_sessions WHERE blob_id=$1', [blob.id]);
          await query(c, 'DELETE FROM attachments WHERE blob_id=$1 AND detached_at IS NOT NULL', [
            blob.id,
          ]);
          await query(c, 'DELETE FROM attachment_blobs WHERE id=$1', [blob.id]);
        }
        removed++;
      };
      if (leases) await leases.withDeletionLease(ctx.household_id, keys, remove);
      else await remove();
    }
    return { removed };
  });
}
