import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { query, transaction, type Client } from './db.js';
import type { Context } from './service.js';
import { DomainError, requireFact, changes } from '../../../../packages/domain/src/index.js';
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
  ): {
    bytes: Buffer;
    width: number | null;
    height: number | null;
    exifStripped: boolean;
    thumbnail?: Buffer;
  };
}
// No decoder dependency: do not claim orientation, pixel validation or EXIF stripping.
export class PassthroughMediaProcessor implements MediaProcessor {
  process(bytes: Buffer) {
    return { bytes, width: null, height: null, exifStripped: false };
  }
}
// Dependency-free metadata safety for the common image containers. It removes EXIF
// segments/chunks and reads dimensions without re-encoding pixels; thumbnails remain
// an explicit processor responsibility (the reservation currently has no thumb bytes).
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegSafe(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2,
    width: number | null = null,
    height: number | null = null,
    stripped = false;
  const out = [bytes.subarray(0, 2)];
  while (p + 1 < bytes.length) {
    if (bytes[p] !== 0xff) return null;
    const marker = bytes[p + 1];
    if (marker === 0xff) {
      p++;
      continue;
    }
    const q = p + 2;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(bytes.subarray(p, q));
      p = q;
      if (marker === 0xd9) break;
      continue;
    }
    if (q + 2 > bytes.length) return null;
    const len = bytes.readUInt16BE(q);
    const end = q + len;
    if (len < 2 || end > bytes.length) return null;
    const segment = bytes.subarray(p, end);
    if (marker === 0xe1 && segment.length >= 10 && segment.toString('ascii', 4, 10) === 'Exif\0\0')
      stripped = true;
    else {
      if (SOF.has(marker) && segment.length >= 9) {
        height = segment.readUInt16BE(5);
        width = segment.readUInt16BE(7);
      }
      out.push(segment);
    }
    p = end;
    if (marker === 0xda) {
      out.push(bytes.subarray(p));
      break;
    }
  }
  return { bytes: Buffer.concat(out), width, height, exifStripped: stripped };
}
function pngSafe(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) return null;
  let p = 8,
    width: number | null = null,
    height: number | null = null,
    stripped = false;
  const out = [bytes.subarray(0, 8)];
  while (p + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(p);
    const end = p + 12 + len;
    if (end > bytes.length) return null;
    const type = bytes.toString('ascii', p + 4, p + 8);
    if (type === 'eXIf') stripped = true;
    else {
      out.push(bytes.subarray(p, end));
      if (type === 'IHDR' && len >= 8) {
        width = bytes.readUInt32BE(p + 8);
        height = bytes.readUInt32BE(p + 12);
      }
    }
    p = end;
  }
  if (p !== bytes.length || !width || !height) return null;
  return { bytes: Buffer.concat(out), width, height, exifStripped: stripped };
}
function webpSafe(bytes: Buffer) {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  )
    return null;
  let p = 12,
    width: number | null = null,
    height: number | null = null,
    stripped = false;
  const out = [bytes.subarray(0, 12)];
  while (p + 8 <= bytes.length) {
    const len = bytes.readUInt32LE(p + 4);
    const end = p + 8 + len + (len % 2);
    if (end > bytes.length) return null;
    const type = bytes.toString('ascii', p, p + 4);
    if (type === 'EXIF' || type === 'XMP ') stripped = true;
    else {
      out.push(bytes.subarray(p, end));
      const data = bytes.subarray(p + 8, p + 8 + len);
      if (type === 'VP8X' && data.length >= 10) {
        width = 1 + (data[4] | (data[5] << 8) | (data[6] << 16));
        height = 1 + (data[7] | (data[8] << 8) | (data[9] << 16));
      } else if (
        type === 'VP8 ' &&
        data.length >= 10 &&
        data[3] === 0x9d &&
        data[4] === 0x01 &&
        data[5] === 0x2a
      ) {
        width = data.readUInt16LE(6) & 0x3fff;
        height = data.readUInt16LE(8) & 0x3fff;
      } else if (type === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
        const bits = data.readUInt32LE(1);
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
    }
    p = end;
  }
  const joined = Buffer.concat(out);
  if (joined.length >= 8) joined.writeUInt32LE(joined.length - 8, 4);
  return { bytes: joined, width, height, exifStripped: stripped };
}
export class SafeMediaProcessor implements MediaProcessor {
  process(bytes: Buffer, mime: Mime) {
    const parsed =
      mime === 'image/jpeg'
        ? jpegSafe(bytes)
        : mime === 'image/png'
          ? pngSafe(bytes)
          : mime === 'image/webp'
            ? webpSafe(bytes)
            : null;
    if (!parsed) return { bytes, width: null, height: null, exifStripped: false };
    return parsed;
  }
}
const key = () => randomBytes(32).toString('hex');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
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
function attachmentRow(c: Client, ctx: Context, id: string, includeDetached = false) {
  const row = query(
    c,
    `${attachmentSelect} WHERE a.household_id=?1 AND a.id=?2 ${includeDetached ? '' : 'AND a.detached_at IS NULL'}`,
    [ctx.household_id, id],
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Attachment not found.');
  // A note's classification is a floor for its attachments, including binary downloads.
  if (row.target_kind === 'NOTE') {
    const note = query(c, 'SELECT sensitivity FROM notes WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      row.target_id,
    ]).rows[0];
    if (
      note?.sensitivity === 'SECRET' ||
      (note?.sensitivity === 'SENSITIVE' && row.sensitivity === 'NORMAL')
    )
      row.sensitivity = note.sensitivity;
  }
  return row;
}
export function redactAttachmentReceipt(c: Client, ctx: Context, id: string) {
  return attachmentSummary(attachmentRow(c, ctx, id, true));
}
export function attachmentRead(c: Client, ctx: Context, input: any) {
  ownerTarget(c, ctx, input.target);
  const page = filePage(input, ctx.household_id, 'attachments');
  const rows = query(
    c,
    `${attachmentSelect} WHERE a.household_id=?1 AND a.target_kind=?2 AND a.target_id=?3 AND a.detached_at IS NULL AND a.id>?4 ORDER BY a.id LIMIT ?5`,
    [ctx.household_id, input.target.kind, input.target.id, page.last, (input.limit ?? 100) + 1],
  ).rows;
  let inherited = 'NORMAL';
  if (input.target.kind === 'NOTE')
    inherited = query(c, 'SELECT sensitivity FROM notes WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      input.target.id,
    ]).rows[0].sensitivity;
  const data = rows.slice(0, input.limit ?? 100).map((row) =>
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
function capacity(c: Client, ctx: Context, target: any) {
  const used = query(
    c,
    `SELECT
    (SELECT COALESCE(sum(max(b.file_size, COALESCE((SELECT max(s.file_size) FROM upload_sessions s WHERE s.blob_id=b.id), b.file_size))),0) FROM attachment_blobs b WHERE b.household_id=?1) +
    (SELECT COALESCE(sum(file_size),0) FROM upload_sessions WHERE household_id=?1 AND blob_id IS NULL AND expires_at>(SELECT now FROM cf_clock)) AS bytes,
    (SELECT count(*) FROM attachments WHERE household_id=?1 AND target_kind=?2 AND target_id=?3 AND detached_at IS NULL) +
    (SELECT count(*) FROM upload_sessions WHERE household_id=?1 AND target_kind=?2 AND target_id=?3 AND completed_attachment_id IS NULL AND expires_at>(SELECT now FROM cf_clock)) AS slots`,
    [ctx.household_id, target.kind, target.id],
  ).rows[0];
  return { bytes: Number(used.bytes), slots: Number(used.slots) };
}
export function attachmentWrite(
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
    ownerTarget(c, ctx, input.target);
    const used = capacity(c, ctx, input.target);
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
    query(
      c,
      'INSERT INTO upload_sessions(id,household_id,actor_id,target_kind,target_id,file_size,expected_sha256,ticket_hash,expires_at,storage_key) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)',
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
    const session = query(
      c,
      'SELECT * FROM upload_sessions WHERE household_id=?1 AND actor_id=?2 AND id=?3',
      [ctx.household_id, ctx.actor_id, input.upload_id],
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
        attachment: attachmentSummary(attachmentRow(c, ctx, session.completed_attachment_id, true)),
      };
    }
    requireFact(
      new Date(session.expires_at).getTime() > Date.now(),
      'STATE_CONFLICT',
      'Upload ticket expired.',
    );
    requireFact(session.blob_id, 'STATE_CONFLICT', 'Upload binary before completing.');
    const target = ownerTarget(c, ctx, input.target);
    checkTargetRevision(c, ctx, target, input);
    const count = query(
      c,
      'SELECT count(*) AS count FROM attachments WHERE household_id=?1 AND target_kind=?2 AND target_id=?3 AND detached_at IS NULL',
      [ctx.household_id, input.target.kind, input.target.id],
    ).rows[0];
    requireFact(
      Number(count.count) < MAX_ATTACHMENTS,
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Target attachment limit exceeded.',
    );
    const id = 'attachment_' + randomUUID();
    query(
      c,
      'INSERT INTO attachments(id,household_id,blob_id,target_kind,target_id,caption,sort_order,sensitivity,created_by) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',
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
    query(c, 'UPDATE upload_sessions SET completed_attachment_id=?1 WHERE id=?2', [id, session.id]);
    return {
      ...fileEvent(
        c,
        ctx,
        target,
        input,
        operation,
        'ATTACHMENT_ATTACH',
        changes({}, { [`attachments.${id}`]: true }),
      ),
      attachment: attachmentSummary(attachmentRow(c, ctx, id)),
    };
  }
  const row = attachmentRow(c, ctx, input.attachment_id, true);
  const target = ownerTarget(c, ctx, { kind: row.target_kind, id: row.target_id });
  checkTargetRevision(c, ctx, target, input);
  if (!row.detached_at) {
    query(
      c,
      'UPDATE attachments SET detached_at=(SELECT now FROM cf_clock) WHERE household_id=?1 AND id=?2',
      [ctx.household_id, row.id],
    );
    query(
      c,
      'UPDATE attachment_blobs SET detached_at=(SELECT now FROM cf_clock) WHERE household_id=?1 AND id=?2 AND NOT EXISTS(SELECT 1 FROM attachments WHERE blob_id=?2 AND detached_at IS NULL)',
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

/** Claim a bounded upload lease before R2 I/O. An immutable object key belongs to one attempt. */
export function beginUpload(
  ctx: Context,
  id: string,
  ticket: string,
  size: number,
  sourceSha256: string,
) {
  const c = ctx.db;
  authorizeFiles(c, ctx, true);
  const session = query(
    c,
    'SELECT * FROM upload_sessions WHERE household_id=?1 AND actor_id=?2 AND id=?3',
    [ctx.household_id, ctx.actor_id, id],
  ).rows[0];
  requireFact(
    session && timingSafeEqual(Buffer.from(session.ticket_hash), Buffer.from(hash(ticket))),
    'FORBIDDEN',
    'Invalid upload ticket.',
  );
  requireFact(
    size > 0 && size <= MAX_FILE_SIZE && size === Number(session.file_size),
    'ATTACHMENT_TOO_LARGE',
    'Upload size does not match reservation.',
  );
  requireFact(
    /^[a-f0-9]{64}$/.test(sourceSha256) &&
      (!session.expected_sha256 || session.expected_sha256 === sourceSha256),
    'ATTRIBUTE_VALIDATION_FAILED',
    'Upload checksum mismatch.',
  );
  const completed = query(
    c,
    "SELECT * FROM cf_upload_attempts WHERE upload_id=?1 AND state='CONFIRMED'",
    [id],
  ).rows[0];
  if (completed) {
    requireFact(
      completed.source_sha256 === sourceSha256,
      'STATE_CONFLICT',
      'Upload ticket already used for different bytes.',
    );
    return { uploaded: true as const };
  }
  requireFact(
    new Date(session.expires_at).getTime() > Date.now(),
    'STATE_CONFLICT',
    'Upload ticket expired.',
  );
  const active = query(
    c,
    "SELECT 1 FROM cf_upload_attempts WHERE upload_id=?1 AND state='WRITING' AND lease_expires_at>(SELECT now FROM cf_clock)",
    [id],
  ).rows;
  requireFact(
    !active.length,
    'STATE_CONFLICT',
    'Upload is already in progress; retry after its lease expires.',
  );
  const lease = crypto.randomUUID(),
    storageKey = hash(session.storage_key + ':' + lease),
    expires = new Date(Math.min(Date.now() + 120000, Date.parse(session.expires_at))).toISOString();
  query(
    c,
    "INSERT INTO cf_upload_attempts(lease_id,upload_id,source_sha256,storage_key,lease_expires_at,state) VALUES(?1,?2,?3,?4,?5,'WRITING')",
    [lease, id, sourceSha256, storageKey, expires],
  );
  query(c, "INSERT INTO cf_outbox(id,kind,payload) VALUES(?1,'UPLOAD_RECONCILE',?2)", [
    lease,
    JSON.stringify({
      upload_id: id,
      storage_key: storageKey,
      not_before: new Date(Date.now() + 24 * 3600000).toISOString(),
    }),
  ]);
  return {
    uploaded: false as const,
    lease_id: lease,
    storage_key: storageKey,
    expires_at: expires,
  };
}
export type UploadedMetadata = {
  mime_type: Mime;
  file_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  exif_stripped: boolean;
};
/** The Worker calls this only after checking the R2 object size and SHA-256. */
export function confirmUpload(ctx: Context, id: string, lease: string, meta: UploadedMetadata) {
  const c = ctx.db;
  authorizeFiles(c, ctx, true);
  const row = query(
    c,
    'SELECT a.*,s.file_size AS reserved_size,s.actor_id FROM cf_upload_attempts a JOIN upload_sessions s ON s.id=a.upload_id WHERE s.household_id=?1 AND s.id=?2 AND a.lease_id=?3',
    [ctx.household_id, id, lease],
  ).rows[0];
  requireFact(row && row.actor_id === ctx.actor_id, 'FORBIDDEN', 'Invalid upload lease.');
  if (row.state === 'CONFIRMED') return { uploaded: true };
  requireFact(
    row.state === 'WRITING' && Date.parse(row.lease_expires_at) > Date.now(),
    'STATE_CONFLICT',
    'Upload lease expired.',
  );
  requireFact(
    meta.file_size > 0 && meta.file_size <= row.reserved_size && /^[a-f0-9]{64}$/.test(meta.sha256),
    'ATTACHMENT_TOO_LARGE',
    'Processed media exceeds reservation.',
  );
  requireFact(
    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(meta.mime_type),
    'ATTACHMENT_TYPE_UNSUPPORTED',
    'Unsupported attachment type.',
  );
  const blob = 'blob_' + randomUUID();
  query(
    c,
    'INSERT INTO attachment_blobs(id,household_id,storage_key,mime_type,file_size,sha256,width,height,thumbnail_key,exif_stripped) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL,?9)',
    [
      blob,
      ctx.household_id,
      row.storage_key,
      meta.mime_type,
      meta.file_size,
      meta.sha256,
      meta.width,
      meta.height,
      meta.exif_stripped,
    ],
  );
  query(c, 'UPDATE upload_sessions SET blob_id=?1,storage_key=?2 WHERE id=?3', [
    blob,
    row.storage_key,
    id,
  ]);
  query(c, "UPDATE cf_upload_attempts SET state='CONFIRMED' WHERE lease_id=?1", [lease]);
  return { uploaded: true };
}
export function downloadMetadata(
  ctx: Context,
  id: string,
  variant: string | undefined,
  reveal: boolean,
): { storage_key: string; mime_type: string; file_size: number; sha256: string } {
  authorizeFiles(ctx.db, ctx);
  requireFact(
    variant === undefined || variant === 'thumb',
    'ATTRIBUTE_VALIDATION_FAILED',
    'Unknown attachment variant.',
  );
  const row = attachmentRow(ctx.db, ctx, id);
  if (row.sensitivity !== 'NORMAL')
    requireFact(reveal, 'REVEAL_AUDIT_REQUIRED', 'Explicit sensitive reveal required.');
  if (reveal) auditReveal(ctx.db, ctx, 'ATTACHMENT', id);
  const storage_key = variant === 'thumb' ? row.thumbnail_key : row.storage_key;
  requireFact(storage_key, 'NOT_FOUND', 'Thumbnail unavailable.');
  return {
    storage_key,
    mime_type: variant === 'thumb' ? 'image/webp' : row.mime_type,
    file_size: row.file_size,
    sha256: row.sha256,
  };
}
