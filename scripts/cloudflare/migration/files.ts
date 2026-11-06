import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

export async function regularFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  if (!(await file.stat()).isFile()) {
    await file.close();
    throw new Error('Expected regular snapshot file');
  }
  return file;
}
export async function directory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected snapshot directory');
}
export async function fingerprint(path: string) {
  const file = await regularFile(path);
  try {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await file.close();
  }
}
export async function* lines(path: string): AsyncGenerator<string> {
  const file = await regularFile(path);
  const stream = file.createReadStream({ autoClose: false });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!line || Buffer.byteLength(line) > 32 * 1024 * 1024)
        throw new Error('Invalid snapshot row');
      yield line;
    }
  } finally {
    reader.close();
    stream.destroy();
    await file.close();
  }
}
