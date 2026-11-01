# Batch 7 — dependency-free media safety

Default upload processing now uses `SafeMediaProcessor` instead of the passthrough stub.

## Implemented

- JPEG: removes APP1 `Exif\0\0` segments, reads SOF width/height, preserves scan bytes.
- PNG: removes `eXIf` chunks, reads IHDR width/height, preserves all other chunks.
- WebP: removes `EXIF`/`XMP ` chunks, reads VP8X/VP8/VP8L dimensions, repairs the RIFF size.
- Malformed images are left byte-identical with `width/height = null`; the type never changes.
- No decoder dependency, no re-encode, no upload-size inflation.

`PassthroughMediaProcessor` remains available for explicit injection and the FILE02 compatibility test. Thumbnails are still not generated: the upload reservation does not yet include thumbnail bytes, and there is no image resizer.

## Evidence

- `tests/batch7/media.test.ts`: 3 passed (JPEG EXIF strip + dimensions, PNG eXIf strip + IHDR, malformed passthrough/no thumbnail).
- Existing attachment upload/download/redaction/quota tests: 15 passed, separately.

## Limits

- EXIF orientation is stripped, not applied; pixels are not rotated. A UI needing rotated previews still needs a decoder or client-side orientation.
- No pixel validation beyond the container structure; malformed compressed data can still be stored.
- No thumbnail/EXIF-derived preview; FILE02 remains PARTIAL.
- PDF metadata is not rewritten.
