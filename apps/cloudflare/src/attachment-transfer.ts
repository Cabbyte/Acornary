import type { HouseholdStore, HouseholdIdentity } from './household-store.js';
import { MAX_FILE_SIZE, SafeMediaProcessor, sniffMime } from './inventory/attachments.js';
import { DomainError, requireFact } from '../../../packages/domain/src/index.js';
const objectKey = (key: string) => {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid private blob key');
  return `blobs/${key}.blob`;
};
const hash = async (bytes: Uint8Array) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
async function readBody(
  body: ReadableStream<Uint8Array> | null,
  capacity: number,
): Promise<Buffer> {
  requireFact(body, 'ATTRIBUTE_VALIDATION_FAILED', 'An attachment body is required.');
  requireFact(
    capacity > 0 && capacity <= MAX_FILE_SIZE,
    'ATTACHMENT_TOO_LARGE',
    'Invalid reservation size.',
  );
  const reader = body.getReader(),
    buffer = Buffer.allocUnsafe(capacity);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > capacity)
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
type UploadStore = {
  [K in 'uploadSize' | 'beginUpload' | 'confirmUpload']: (
    ...args: Parameters<HouseholdStore[K]>
  ) => Promise<ReturnType<HouseholdStore[K]>>;
};
export async function transferAttachment(
  store: UploadStore,
  identity: HouseholdIdentity,
  id: string,
  ticket: string,
  body: ReadableStream<Uint8Array> | null,
  bucket: R2Bucket,
) {
  const size = await store.uploadSize(identity, id, ticket);
  const bytes = await readBody(body, size),
    sourceDigest = await hash(bytes);
  const lease = await store.beginUpload(identity, id, ticket, bytes.length, sourceDigest);
  if (lease.uploaded) return { uploaded: true };
  const mime = sniffMime(bytes),
    media = new SafeMediaProcessor().process(bytes, mime);
  requireFact(
    media.bytes.length > 0 && media.bytes.length <= bytes.length && sniffMime(media.bytes) === mime,
    'ATTACHMENT_TOO_LARGE',
    'Processed media exceeds reservation or changes type.',
  );
  // PDFs and unmodified images retain the original buffer; do not hash identical bytes twice.
  const digest = media.bytes === bytes ? sourceDigest : await hash(media.bytes),
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
  if (persisted.size !== media.bytes.length) {
    await persisted.body.cancel();
    throw new Error('Unexpected upload object length');
  }
  // Native streaming hashing preserves actual-byte read-back verification without a
  // JavaScript chunk loop or a second whole-file buffer.
  const verification = new crypto.DigestStream('SHA-256');
  await persisted.body.pipeTo(verification);
  if (
    Number(verification.bytesWritten) !== media.bytes.length ||
    Buffer.from(await verification.digest).toString('hex') !== digest
  )
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
