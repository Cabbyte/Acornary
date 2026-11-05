import { NativeDatabase, binding } from './inventory/db.js';
import { householdSchemaVersion, columnTypes } from './inventory/schema.js';
import { inlineReceiptBytes } from './sqlite-payloads.js';
import { directoryEvent } from './household-accounts.js';
import {
  householdImportDescriptor,
  householdImportTables,
  importColumns,
  verifyPart,
  sha,
  type HouseholdImportDescriptor,
  type ImportTable,
} from './household-import-model.js';

/** Internal Worker binding capability only. The public Fetch router exposes no import endpoint. */
export class HouseholdImporter {
  constructor(readonly db: NativeDatabase) {}
  begin(raw: unknown) {
    const descriptor = householdImportDescriptor.parse(raw),
      encoded = JSON.stringify(descriptor),
      fingerprint = sha(encoded);
    if (
      Object.keys(descriptor.counts).sort().join('|') !==
        [...householdImportTables].sort().join('|') ||
      descriptor.counts.households !== 1
    )
      throw new Error('Incomplete household table coverage');
    return this.db.transaction(() => {
      const prior = this.db.query('SELECT fingerprint FROM cf_import_manifest WHERE singleton=1')
        .rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error('Destination is anchored to another import');
        return this.status();
      }
      if (this.db.query('SELECT 1 FROM cf_store_state').rowCount)
        throw new Error('Household destination is not empty');
      for (const table of householdImportTables)
        if (this.db.query(`SELECT 1 FROM "${table}" LIMIT 1`).rowCount)
          throw new Error('Household destination is not empty');
      this.db.query(
        "INSERT INTO cf_import_manifest(singleton,fingerprint,descriptor,status) VALUES(1,?1,?2,'IMPORTING')",
        [fingerprint, encoded],
      );
      this.db.query(
        "INSERT INTO cf_store_state(singleton,household_id,schema_version,status,manifest_hash) VALUES(1,?1,?2,'IMPORTING',?3)",
        [descriptor.household_id, householdSchemaVersion, descriptor.manifest_hash],
      );
      return this.status();
    });
  }
  private manifest() {
    const row = this.db.query('SELECT * FROM cf_import_manifest WHERE singleton=1').rows[0];
    if (!row) throw new Error('Import has not started');
    return { ...row, descriptor: JSON.parse(row.descriptor) as HouseholdImportDescriptor };
  }
  status() {
    const m = this.manifest(),
      state = this.db.query('SELECT next_chunk FROM cf_store_state WHERE singleton=1').rows[0];
    return {
      household_id: m.descriptor.household_id,
      manifest_hash: m.descriptor.manifest_hash,
      status: m.status,
      next_chunk: state.next_chunk,
      chunks: m.descriptor.chunks,
    };
  }
  part(manifestHash: string, ordinal: number, body: string, proof: string[]) {
    const m = this.manifest();
    if (m.descriptor.manifest_hash !== manifestHash) throw new Error('Manifest mismatch');
    const checked = verifyPart(m.descriptor, ordinal, body, proof),
      p = checked.part;
    return this.db.transaction(() => {
      const prior = this.db.query('SELECT digest FROM cf_import_chunks WHERE ordinal=?1', [ordinal])
        .rows[0];
      if (prior) {
        if (prior.digest !== checked.digest) throw new Error('Chunk retry differs');
        return this.status();
      }
      if (m.status !== 'IMPORTING') throw new Error('Import is sealed');
      const next = this.db.query('SELECT next_chunk FROM cf_store_state WHERE singleton=1').rows[0]
        .next_chunk;
      if (next !== ordinal) throw new Error('Import chunks must be sequential');
      const current = this.db.query(
        'SELECT row_number,table_name,part_count,count(*) AS received FROM cf_import_parts GROUP BY row_number,table_name,part_count',
      ).rows;
      if (p.part === 0 && current.length) throw new Error('Previous row is incomplete');
      if (
        p.part > 0 &&
        (current.length !== 1 ||
          current[0].row_number !== p.row ||
          current[0].table_name !== p.table ||
          current[0].part_count !== p.parts ||
          current[0].received !== p.part)
      )
        throw new Error('Row fragments are not contiguous');
      this.db.query(
        'INSERT INTO cf_import_parts(row_number,table_name,part_count,ordinal,data) VALUES(?1,?2,?3,?4,?5)',
        [p.row, p.table, p.parts, p.part, p.text],
      );
      if (p.part === p.parts - 1) {
        const encoded = this.db
          .query('SELECT data AS fragment FROM cf_import_parts ORDER BY ordinal')
          .rows.map((row) => row.fragment)
          .join('');
        this.insert(p.table, encoded, m.descriptor.household_id);
        this.db.query('DELETE FROM cf_import_parts');
      }
      this.db.query('INSERT INTO cf_import_chunks VALUES(?1,?2)', [ordinal, checked.digest]);
      this.db.query('UPDATE cf_store_state SET next_chunk=next_chunk+1 WHERE singleton=1');
      return this.status();
    });
  }
  private insert(table: ImportTable, encoded: string, householdId: string) {
    if (Buffer.byteLength(encoded) > 12 * 1024 * 1024)
      throw new Error('Import row exceeds bounded migration memory');
    const row = JSON.parse(encoded) as Record<string, unknown>,
      columns = importColumns(table);
    if (
      !row ||
      Array.isArray(row) ||
      Object.keys(row).sort().join('|') !== [...columns].sort().join('|')
    )
      throw new Error('Imported columns differ from the source schema');
    if ((table === 'households' ? row.id : row.household_id) !== householdId)
      throw new Error('Cross-household import rejected');
    for (const [key, type] of Object.entries(columnTypes[table])) {
      const value = row[key];
      if (value === null) continue;
      if (['jsonb', '_text'].includes(type)) {
        if (typeof value !== 'string') throw new Error('JSON columns require lossless source text');
        JSON.parse(value);
      } else if (type === 'bool') {
        if (value !== 0 && value !== 1) throw new Error('Invalid boolean binding');
      } else if (['int4', 'int2'].includes(type)) {
        if (typeof value !== 'number' || !Number.isSafeInteger(value))
          throw new Error('Invalid integer binding');
      } else if (typeof value !== 'string')
        throw new Error('Scalar import values must preserve source text');
    }
    const values = columns.map((name) => row[name]);
    if (table === 'operations') {
      const result = row.result as string,
        receipt = JSON.parse(result);
      if (receipt.operation_id !== row.operation_id)
        throw new Error('Operation receipt identity mismatch');
      const bytes = new TextEncoder().encode(result);
      if (bytes.length > inlineReceiptBytes) {
        values[columns.indexOf('result')] = null;
        columns.push('result_payload');
        values.push(this.db.payloads.put(bytes));
      }
    }
    const originalColumns = importColumns(table);
    const returning = originalColumns
      .map((name) =>
        columnTypes[table][name as never] === 'int8'
          ? `CAST("${name}" AS TEXT) AS "${name}"`
          : `"${name}"`,
      )
      .join(',');
    const persisted = this.db.storage.sql
      .exec(
        `INSERT INTO "${table}"(${columns.map((c) => '"' + c + '"').join(',')}) VALUES(${columns.map((_, i) => '?' + (i + 1)).join(',')}) RETURNING ${returning}`,
        ...values.map(binding),
      )
      .one();
    if (table === 'operations' && columns.includes('result_payload'))
      persisted.result = this.db.payloads.get(values.at(-1) as string);
    if (
      JSON.stringify(originalColumns.map((name) => persisted[name])) !==
      JSON.stringify(originalColumns.map((name) => row[name]))
    )
      throw new Error('Imported row differs after SQLite persistence');
  }
  finish(manifestHash: string) {
    return this.db.transaction(() => {
      const m = this.manifest(),
        status = this.status();
      if (status.manifest_hash !== manifestHash) throw new Error('Manifest mismatch');
      if (m.status !== 'IMPORTING') return status;
      if (
        status.next_chunk !== status.chunks ||
        this.db.query('SELECT 1 FROM cf_import_parts').rowCount
      )
        throw new Error('Import is incomplete');
      if (this.db.query('PRAGMA foreign_key_check').rowCount)
        throw new Error('Imported foreign keys are inconsistent');
      for (const table of householdImportTables)
        if (
          this.db.query(`SELECT count(*) AS n FROM "${table}"`).rows[0].n !==
          m.descriptor.counts[table]
        )
          throw new Error('Imported table count mismatch: ' + table);
      const hh = m.descriptor.household_id;
      const invalidCatalog = this.db.query(
        "SELECT 1 FROM catalog_nodes c JOIN catalog_nodes p ON p.id=c.parent_id WHERE p.kind<>'GROUP' OR p.household_id<>c.household_id LIMIT 1",
      ).rowCount;
      if (invalidCatalog) throw new Error('Imported catalog parent is invalid');
      const sync = this.db.query('SELECT * FROM household_sync_state WHERE household_id=?1', [hh])
        .rows[0];
      if (
        !sync ||
        this.db.query(
          'SELECT 1 FROM sync_changes WHERE CAST(change_id AS INTEGER)>CAST(?1 AS INTEGER) LIMIT 1',
          [sync.last_committed_change_id],
        ).rowCount
      )
        throw new Error('Imported sync watermark is invalid');
      this.db.query("UPDATE cf_import_manifest SET status='VALIDATED' WHERE singleton=1");
      return this.status();
    });
  }
  blobPage(manifestHash: string, after: string = '') {
    const m = this.manifest();
    if (m.descriptor.manifest_hash !== manifestHash) throw new Error('Manifest mismatch');
    return this.db.query<{ storage_key: string }>(
      `SELECT storage_key FROM (SELECT storage_key FROM attachment_blobs UNION SELECT thumbnail_key AS storage_key FROM attachment_blobs WHERE thumbnail_key IS NOT NULL) WHERE storage_key>?1 ORDER BY storage_key LIMIT 10`,
      [after],
    ).rows;
  }
  confirmBlob(manifestHash: string, key: string, bytes: number, digest: string) {
    return this.db.transaction(() => {
      const m = this.manifest();
      if (m.descriptor.manifest_hash !== manifestHash || m.status !== 'VALIDATED')
        throw new Error('A validated import is required');
      const rows = this.db.query(
        'SELECT storage_key,thumbnail_key,file_size,sha256 FROM attachment_blobs WHERE storage_key=?1 OR thumbnail_key=?1',
        [key],
      ).rows;
      if (
        !rows.length ||
        !Number.isInteger(bytes) ||
        bytes <= 0 ||
        bytes > 25 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(digest)
      )
        throw new Error('Invalid imported blob verification');
      if (
        rows.some(
          (r) => r.storage_key === key && (Number(r.file_size) !== bytes || r.sha256 !== digest),
        )
      )
        throw new Error('Source attachment metadata differs from verified bytes');
      this.db.query(
        'INSERT INTO cf_import_blob_checks VALUES(?1,?2,?3) ON CONFLICT(storage_key) DO UPDATE SET byte_length=excluded.byte_length,sha256=excluded.sha256',
        [key, bytes, digest],
      );
      return { verified: true };
    });
  }
  activate(manifestHash: string) {
    return this.db.transaction(() => {
      const m = this.manifest();
      if (
        m.descriptor.manifest_hash !== manifestHash ||
        !['VALIDATED', 'ACTIVE'].includes(m.status)
      )
        throw new Error('A verified import is required');
      if (m.status === 'ACTIVE') return this.status();
      const required = this.db.query(
        'SELECT count(*) AS n FROM (SELECT storage_key FROM attachment_blobs UNION SELECT thumbnail_key FROM attachment_blobs WHERE thumbnail_key IS NOT NULL)',
      ).rows[0].n;
      if (this.db.query('SELECT count(*) AS n FROM cf_import_blob_checks').rows[0].n !== required)
        throw new Error('Imported attachment bytes have not all been verified');
      const hh = m.descriptor.household_id;
      this.db.query('UPDATE household_sync_state SET sync_generation=?1 WHERE household_id=?2', [
        crypto.randomUUID(),
        hh,
      ]);
      // D1 imported routing indexes start at revision 1, so activation must supersede them.
      this.db.query("UPDATE cf_directory_clock SET revision='1' WHERE singleton=1");
      directoryEvent(this.db, 'import:' + manifestHash, hh);
      this.db.query("UPDATE cf_store_state SET status='ACTIVE' WHERE singleton=1");
      this.db.query("UPDATE cf_import_manifest SET status='ACTIVE' WHERE singleton=1");
      return this.status();
    });
  }
}
