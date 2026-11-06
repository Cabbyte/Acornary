import { join } from 'node:path';
import { lines } from './files.js';
import { verifySnapshot } from './verify.js';
import { columnTypes } from '../../../apps/cloudflare/src/inventory/schema.js';
import { utcTimestamp } from '../../../apps/cloudflare/src/inventory/timestamps.js';
import {
  householdImportTables,
  importColumns,
  leafHash,
  merkle,
  type ImportTable,
  type ImportPart,
  type HouseholdImportDescriptor,
} from '../../../apps/cloudflare/src/household-import-model.js';

// Preserve arbitrary JSON numeric literals in legacy opaque attributes/receipts. This runs offline on Node 24.
function parseLossless(line: string): Record<string, any> {
  return (JSON.parse as any)(line, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source && !Number.isSafeInteger(value)
      ? (JSON as any).rawJSON(context.source)
      : value,
  );
}
function topological(rows: Record<string, any>[]) {
  const byId = new Map(rows.map((r) => [r.id, r])),
    ordered: Record<string, any>[] = [],
    state = new Map<string, number>();
  for (const first of rows) {
    const stack = [{ row: first, leaving: false }];
    while (stack.length) {
      const entry = stack.pop()!,
        row = entry.row;
      if (entry.leaving) {
        state.set(row.id, 2);
        ordered.push(row);
        continue;
      }
      if (state.get(row.id) === 2) continue;
      if (state.get(row.id) === 1) throw new Error('Source tree contains a cycle');
      state.set(row.id, 1);
      stack.push({ row, leaving: true });
      if (row.parent_id) {
        const parent = byId.get(row.parent_id);
        if (!parent) throw new Error('Source tree has an absent/cross-household parent');
        stack.push({ row: parent, leaving: false });
      }
    }
  }
  return ordered;
}
function encodeRow(table: ImportTable, source: Record<string, any>) {
  const columns = importColumns(table),
    row: Record<string, unknown> = {};
  if (Object.keys(source).sort().join('|') !== [...columns].sort().join('|'))
    throw new Error('Source columns differ from the reviewed household schema: ' + table);
  for (const name of columns) {
    const value = source[name],
      type = (columnTypes[table] as Record<string, string>)[name];
    row[name] =
      value === null
        ? null
        : type === 'jsonb' || type === '_text'
          ? JSON.stringify(value)
          : type === 'bool'
            ? Number(value)
            : type === 'timestamptz'
              ? utcTimestamp(value)
              : value;
  }
  return JSON.stringify(row);
}
function parts(table: ImportTable, row: number, text: string): ImportPart[] {
  // Splitting by Unicode code points prevents fragment-boundary replacement characters.
  const fragments: string[] = [];
  let pending = '',
    bytes = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point);
    if (bytes + size > 128 * 1024) {
      fragments.push(pending);
      pending = '';
      bytes = 0;
    }
    pending += point;
    bytes += size;
  }
  if (pending) fragments.push(pending);
  if (fragments.length > 128) throw new Error('Source row exceeds migration fragment bound');
  return fragments.map((text, part) => ({ table, row, part, parts: fragments.length, text }));
}
export async function prepareHouseholdImports(root: string, expectedManifestHash: string) {
  const manifest = await verifySnapshot(root, expectedManifestHash);
  const households = new Map<string, Map<ImportTable, Record<string, any>[]>>();
  for await (const line of lines(join(root, 'tables', 'households.ndjson'))) {
    const row = parseLossless(line);
    households.set(row.id, new Map(householdImportTables.map((table) => [table, []])));
  }
  for (const table of householdImportTables)
    for await (const line of lines(join(root, 'tables', table + '.ndjson'))) {
      const row = parseLossless(line),
        hh = table === 'households' ? row.id : row.household_id,
        destination = households.get(hh);
      if (!destination) throw new Error('Source fact belongs to an absent household');
      destination.get(table)!.push(row);
    }
  const plans = [];
  for (const [hh, tables] of households) {
    const bodies: string[] = [],
      counts: Record<string, number> = {};
    let rowNumber = 0;
    for (const table of householdImportTables) {
      const all = tables.get(table)!,
        rows = ['catalog_nodes', 'items'].includes(table) ? topological(all) : all;
      counts[table] = rows.length;
      for (const row of rows)
        for (const part of parts(table, rowNumber++, encodeRow(table, row)))
          bodies.push(JSON.stringify(part));
    }
    const tree = merkle(bodies.map((body, i) => leafHash(i, body)));
    const descriptor: HouseholdImportDescriptor = {
      format: 'acornary-household-import-v1',
      household_id: hh,
      manifest_hash: expectedManifestHash,
      mode: manifest.mode,
      root_hash: tree.root,
      chunks: bodies.length,
      counts,
    };
    plans.push({
      descriptor,
      chunks: bodies.map((body, ordinal) => ({ ordinal, body, proof: tree.proof(ordinal) })),
    });
  }
  await verifySnapshot(root, expectedManifestHash);
  return plans;
}
