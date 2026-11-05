const maxBlobBytes = 25 * 1024 * 1024;
export function blobObjectKey(storageKey: string) {
  if (!/^[a-f0-9]{64}$/.test(storageKey)) throw new Error('Invalid attachment storage key');
  return `blobs/${storageKey}.blob`;
}
export async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
type BlobDescriptor = { bytes: number; sha256: string };
function descriptor(value: BlobDescriptor) {
  if (
    !Number.isInteger(value.bytes) ||
    value.bytes <= 0 ||
    value.bytes > maxBlobBytes ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  )
    throw new Error('Invalid attachment descriptor');
}

/** Offline migration only. Bounded one-file buffers; runtime downloads will stream through authorization. */
export class BlobSnapshotImporter {
  constructor(private readonly bucket: R2Bucket) {}

  async verify(storageKey: string, expected: BlobDescriptor) {
    descriptor(expected);
    const object = await this.bucket.get(blobObjectKey(storageKey));
    if (!object) throw new Error('Missing R2 attachment');
    if (object.size !== expected.bytes) {
      await object.body.cancel();
      throw new Error('R2 attachment size mismatch');
    }
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength !== expected.bytes || (await sha256(bytes)) !== expected.sha256)
      throw new Error('R2 attachment checksum mismatch');
  }

  async put(storageKey: string, bytes: ArrayBuffer, expected: BlobDescriptor) {
    descriptor(expected);
    const key = blobObjectKey(storageKey);
    if (bytes.byteLength !== expected.bytes || (await sha256(bytes)) !== expected.sha256)
      throw new Error('Source attachment checksum mismatch');
    if (await this.bucket.head(key)) {
      await this.verify(storageKey, expected);
      return { replayed: true };
    }
    // The conditional write prevents a race from overwriting a pre-existing different object.
    const result = await this.bucket.put(key, bytes, {
      sha256: expected.sha256,
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
    });
    // Always read and hash actual stored bytes, including after an ambiguous/duplicate write.
    await this.verify(storageKey, expected);
    return { replayed: result === null };
  }
}
