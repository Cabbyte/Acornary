import { createHash } from 'node:crypto';
import type { HouseholdStore, HouseholdIdentity } from './household-store.js';
import { MAX_FILE_SIZE, SafeMediaProcessor, sniffMime } from './inventory/attachments.js';
import { DomainError, requireFact } from '../../../packages/domain/src/index.js';
const objectKey = (key: string) => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid private blob key');
  return `blobs/${key}.blob`;
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function readBody(body: ReadableStream<Uint8Array> | null): Promise<Buffer> {
  requireFact(body, 'ATTRIBUTE_VALIDATION_FAILED', 'An attachment body is required.');
  const reader = body.getReader(),
    buffer = Buffer.allocUnsafe(MAX_FILE_SIZE);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > MAX_FILE_SIZE)
        throw new DomainError('ATTACHMENT_TOO_LARGE', 'Files are limited to 25 MiB.');
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  requireFact(size > 0, 'ATTRIBUTE_VALIDATION_FAILED', 'An attachment body is required.');
  return buffer.subarray(0, size);
}
export async function transferAttachment(
  store: DurableObjectStub<HouseholdStore>,
  identity: HouseholdIdentity,
  id: string,
  ticket: string,
  body: ReadableStream<Uint8Array> | null,
  bucket: R2Bucket,
) {
  const bytes = await readBody(body),
    sourceDigest = hash(bytes);
  const lease = await store.beginUpload(identity, id, ticket, bytes.length, sourceDigest);
  if (lease.uploaded) return { uploaded: true };
  const mime = sniffMime(bytes),
    media = new SafeMediaProcessor().process(bytes, mime);
  requireFact(
    media.bytes.length > 0 && media.bytes.length <= bytes.length && sniffMime(media.bytes) === mime,
    'ATTACHMENT_TOO_LARGE',
    'Processed media exceeds reservation or changes type.',
  );
  const digest = hash(media.bytes),
    key = objectKey(lease.storage_key);
  const object = await bucket.put(key, media.bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    sha256: digest,
    httpMetadata: { contentType: mime },
    customMetadata: { upload: id, lease: lease.lease_id, sha256: digest },
  });
  requireFact(object, 'STATE_CONFLICT', 'Upload object already exists.');
  const persisted = await bucket.get(key);
  if (!persisted) throw new Error('Uploaded object was not readable');
  const verification = createHash('sha256'),
    reader = persisted.body.getReader();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_FILE_SIZE) throw new Error('Unexpected upload object length');
      verification.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length !== media.bytes.length || verification.digest('hex') !== digest)
    throw new Error('Uploaded object checksum verification failed');
  return store.confirmUpload(identity, id, lease.lease_id, {
    mime_type: mime,
    file_size: media.bytes.length,
    sha256: digest,
    width: media.width,
    height: media.height,
    exif_stripped: media.exifStripped,
  });
}
export async function downloadAttachment(
  store: DurableObjectStub<HouseholdStore>,
  identity: HouseholdIdentity,
  id: string,
  variant: string | undefined,
  reveal: boolean,
  bucket: R2Bucket,
) {
  const meta = await store.downloadMetadata(identity, id, variant, reveal),
    object = await bucket.get(objectKey(meta.storage_key));
  requireFact(object, 'NOT_FOUND', 'Attachment bytes are unavailable.');
  if (!variant && object.size !== Number(meta.file_size))
    throw new Error('Attachment length mismatch');
  let mime = meta.mime_type;
  if (variant === 'thumb') {
    const prefix = await bucket.get(objectKey(meta.storage_key), {
      range: { offset: 0, length: 12 },
    });
    requireFact(prefix, 'NOT_FOUND', 'Thumbnail bytes are unavailable.');
    mime = sniffMime(Buffer.from(await prefix.arrayBuffer()));
    requireFact(mime.startsWith('image/'), 'ATTACHMENT_TYPE_UNSUPPORTED', 'Invalid thumbnail.');
  }
  return new Response(object.body, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(object.size),
      'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
