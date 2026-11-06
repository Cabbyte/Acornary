// DO SQLite limits any row/string/BLOB to 2 MB. Existing operation receipts allow 4 MiB.
// Chunked immutable payloads stay in the same SQLite transaction as their owning operation.
export const maxReceiptBytes = 4 * 1024 * 1024;
export const inlineReceiptBytes = 64 * 1024;
const chunkBytes = 128 * 1024;

export class SqlitePayloads {
  constructor(private readonly sql: SqlStorage) {}

  createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS cf_payloads (
        id TEXT PRIMARY KEY, byte_length INTEGER NOT NULL CHECK(byte_length>0 AND byte_length<=4194304),
        chunk_count INTEGER NOT NULL CHECK(chunk_count>0 AND chunk_count<=32)
      );
      CREATE TABLE IF NOT EXISTS cf_payload_chunks (
        payload_id TEXT NOT NULL REFERENCES cf_payloads(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK(ordinal>=0), data BLOB NOT NULL CHECK(length(data)<=131072),
        PRIMARY KEY(payload_id,ordinal)
      );
    `);
  }

  put(bytes: Uint8Array) {
    if (!bytes.byteLength || bytes.byteLength > maxReceiptBytes)
      throw new Error('Operation result exceeds 4 MiB');
    const id = crypto.randomUUID();
    this.sql.exec(
      'INSERT INTO cf_payloads VALUES(?,?,?)',
      id,
      bytes.byteLength,
      Math.ceil(bytes.byteLength / chunkBytes),
    );
    for (let start = 0, ordinal = 0; start < bytes.byteLength; start += chunkBytes, ordinal++)
      this.sql.exec(
        'INSERT INTO cf_payload_chunks VALUES(?,?,?)',
        id,
        ordinal,
        bytes.slice(start, start + chunkBytes),
      );
    return id;
  }

  get(id: string) {
    const meta = this.sql
      .exec<{ byte_length: number; chunk_count: number }>(
        'SELECT byte_length,chunk_count FROM cf_payloads WHERE id=?',
        id,
      )
      .toArray()[0];
    if (!meta) throw new Error('Missing operation payload');
    const output = new Uint8Array(meta.byte_length);
    let offset = 0,
      count = 0;
    for (const chunk of this.sql.exec<{ ordinal: number; data: ArrayBuffer }>(
      'SELECT ordinal,data FROM cf_payload_chunks WHERE payload_id=? ORDER BY ordinal',
      id,
    )) {
      const bytes = new Uint8Array(chunk.data);
      if (
        chunk.ordinal !== count ||
        bytes.byteLength !== Math.min(chunkBytes, output.byteLength - offset)
      )
        throw new Error('Incomplete operation payload');
      output.set(bytes, offset);
      offset += bytes.byteLength;
      count++;
    }
    if (offset !== meta.byte_length || count !== meta.chunk_count)
      throw new Error('Incomplete operation payload');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(output);
  }
}
