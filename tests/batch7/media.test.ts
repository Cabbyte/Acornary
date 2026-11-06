import { describe, expect, it } from 'vitest';
import { SafeMediaProcessor } from '../../apps/cloudflare/src/inventory/attachments.js';

const chunk = (type: string, data: Buffer) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out;
};
const pngWithExif = () => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('eXIf', Buffer.from('Exif\0\0secret')), chunk('IDAT', Buffer.from([1, 2])), chunk('IEND', Buffer.alloc(0))]);
};
const jpegWithExif = () => {
  const exif = Buffer.from('Exif\0\0secret-metadata');
  const app1 = Buffer.alloc(4 + exif.length);
  app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(2 + exif.length, 2); exif.copy(app1, 4);
  const sof = Buffer.alloc(4 + 15);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(480, 5); sof.writeUInt16BE(640, 7); sof[9] = 3;
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x0c, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from([1, 2, 3]), Buffer.from([0xff, 0xd9])]);
};

describe('SafeMediaProcessor', () => {
  it('strips JPEG EXIF and reads dimensions without re-encoding', async () => {
    const source = jpegWithExif();
    const out = await new SafeMediaProcessor().process(source, 'image/jpeg');
    expect(out.width).toBe(640);
    expect(out.height).toBe(480);
    expect(out.exifStripped).toBe(true);
    expect(out.bytes.includes(Buffer.from('Exif'))).toBe(false);
    expect(out.bytes.length).toBeLessThan(source.length);
  });
  it('strips PNG eXIf and reads IHDR dimensions', async () => {
    const source = pngWithExif();
    const out = await new SafeMediaProcessor().process(source, 'image/png');
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(out.exifStripped).toBe(true);
    expect(out.bytes.includes(Buffer.from('eXIf'))).toBe(false);
  });
  it('leaves malformed images untouched and never claims a thumbnail', async () => {
    const source = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const out = await new SafeMediaProcessor().process(source, 'image/png');
    expect(out).toMatchObject({ bytes: source, width: null, height: null, exifStripped: false });
    expect((out as any).thumbnail).toBeUndefined();
  });
});
