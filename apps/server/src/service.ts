import {
  intakeReads,
  readIntake,
  proposeCatalogChange,
  authorizeCatalogCommand,
  commitIntake,
} from './intake.js';
import { currentChangeId } from './change-watermark.js';
import { legacyInput } from './fingerprint.js';
import { randomUUID, createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  parseCommand,
  templateFor,
  latestTemplateVersion,
  reads,
  templates,
  templateDefinition,
  validateValues,
  type Operation,
  type Target,
  type TemplateId,
} from '../../../packages/contracts/src/index.js';
import {
  DomainError,
  requireFact,
  terminal,
  patch,
  prune,
  canonical,
  changes,
  subtract,
  getPath,
  reminderDate,
} from '../../../packages/domain/src/index.js';
import { query, transaction, type Client } from './db.js';
import { recordSyncChange } from './sync.js';
import { timed, traces } from './telemetry.js';
export type Context = {
  household_id: string;
  actor_id: string;
  source: string;
  connection?: {
    server_origin: string;
    mode: 'local' | 'cloud';
    account?: { id: string; name: string };
    scopes: string[];
  };
};
type ObjectState = {
  kind: 'ITEM' | 'CATALOG_NODE';
  row: any;
  sets: Record<string, any>;
  versions?: Record<string, number>;
};
const versionOf = (obj: ObjectState, name: string) => obj.versions?.[name] ?? 1;
const table = (kind: string) => (kind === 'ITEM' ? 'items' : 'catalog_nodes');

const eventTypes: Record<string, string> = {
  create_catalog_node: 'CREATE',
  create_items: 'CREATE',
  create_items_batch: 'CREATE',
  update_items_lifecycle: 'ATTRIBUTE_UPDATE',
  upgrade_attributes: 'ATTRIBUTE_UPGRADE',
  update_catalog_node: 'UPDATE',
  update_item: 'UPDATE',
  edit_item: 'EDIT',
  move_catalog_node: 'MOVE',
  move_item: 'MOVE',
  move_items: 'MOVE',
  open_item: 'OPEN',
  consume_items: 'CONSUME_ITEMS',
  consume_item_content: 'CONSUME_CONTENT',
  correct_item: 'CORRECT',
  bind_attributes: 'ATTRIBUTE_BIND',
  update_attributes: 'ATTRIBUTE_UPDATE',
  remove_attributes: 'ATTRIBUTE_REMOVE',
  add_note: 'NOTE_CREATE',
  update_note: 'NOTE_UPDATE',
};
export async function load(c: Client, ctx: Context, t: Target): Promise<ObjectState> {
  const row = (
    await query(c, `SELECT * FROM ${table(t.kind)} WHERE household_id=$1 AND id=$2`, [
      ctx.household_id,
      t.id,
    ])
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Object not found in this household.');
  const obj: ObjectState = {
    kind: t.kind,
    row,
    sets: {},
    versions: Object.fromEntries(
      row.attributes.map((a: any) => [a.template_id, a.template_version]),
    ),
  };
  await validateBindings(c, ctx, obj, row.attributes);
  obj.sets = Object.fromEntries(row.attributes.map((a: any) => [a.template_id, a.values]));
  return obj;
}
async function validateBindings(c: Client, ctx: Context, obj: ObjectState, bindings: any[]) {
  requireFact(
    Array.isArray(bindings),
    'ATTRIBUTE_VALIDATION_FAILED',
    'Attributes must be an array.',
  );
  const seen = new Set<string>();
  for (const a of bindings) {
    requireFact(
      a &&
        typeof a === 'object' &&
        !Array.isArray(a) &&
        Object.keys(a).sort().join(',') ===
          'created_at,template_id,template_version,updated_at,values' &&
        typeof a.created_at === 'string' &&
        Number.isFinite(Date.parse(a.created_at)) &&
        typeof a.updated_at === 'string' &&
        Number.isFinite(Date.parse(a.updated_at)) &&
        !seen.has(a.template_id) &&
        Number.isInteger(a.template_version),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid or duplicate embedded binding.',
    );
    seen.add(a.template_id);
    const t = templates[a.template_id as TemplateId];
    requireFact(
      t && t.target_kind === obj.kind && (obj.kind === 'ITEM' || obj.row.kind === 'SKU'),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Template not applicable to this object.',
    );
    const registered = (
      await query(
        c,
        'SELECT target_kind FROM attribute_templates WHERE household_id=$1 AND id=$2 AND version=$3',
        [ctx.household_id, a.template_id, a.template_version],
      )
    ).rows[0];
    requireFact(
      registered?.target_kind === obj.kind,
      'ATTRIBUTE_VALIDATION_FAILED',
      'Template version is not registered for this household and target.',
    );
    validateValues(a.template_id as TemplateId, a.values, a.template_version);
  }
}

function flatten(obj: ObjectState): Record<string, any> {
  const r: Record<string, any> = {};
  for (const field of obj.kind === 'ITEM'
    ? ['catalog_node_id', 'parent_id', 'display_name']
    : ['kind', 'name', 'parent_id'])
    if (Object.hasOwn(obj.row, field)) r[field] = obj.row[field];
  for (const [name, value] of Object.entries(obj.sets)) {
    r[`attributes.${name}.$binding`] = {
      template_id: name,
      template_version: versionOf(obj, name),
    };
    for (const path of templateFor(name as TemplateId, versionOf(obj, name)).paths) {
      const v = getPath(value, path);
      if (v !== undefined) r[`attributes.${name}.${path}`] = v;
    }
  }
  return r;
}
async function validate(
  c: Client,
  ctx: Context,
  obj: ObjectState,
  before?: ObjectState,
  correction = false,
) {
  for (const [name, value] of Object.entries(obj.sets)) {
    const t = templates[name as TemplateId];
    requireFact(
      t && t.target_kind === obj.kind && (obj.kind === 'ITEM' || obj.row.kind === 'SKU'),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Template not applicable to this object.',
    );
    obj.sets[name] = prune(validateValues(name as TemplateId, value, versionOf(obj, name)));
    if (!Object.keys(obj.sets[name]).length) delete obj.sets[name];
  }
  if (obj.kind === 'ITEM') {
    const catalog = await load(c, ctx, { kind: 'CATALOG_NODE', id: obj.row.catalog_node_id });
    requireFact(catalog.row.kind === 'SKU', 'ATTRIBUTE_VALIDATION_FAILED', 'Item requires a SKU.');
    if (obj.sets.container?.can_contain !== true) {
      const children = (
        await query(c, 'SELECT 1 FROM items WHERE household_id=$1 AND parent_id=$2 LIMIT 1', [
          ctx.household_id,
          obj.row.id,
        ])
      ).rows;
      requireFact(!children.length, 'TEMPLATE_IN_USE', 'Container still has children.');
    }
    const was = before?.sets.lifecycle?.state,
      now = obj.sets.lifecycle?.state;
    if (was && terminal.has(was) && !terminal.has(now) && !correction)
      throw new DomainError(
        'INVALID_TRANSITION',
        'Restoring a terminal item requires correct_item with a reason.',
      );
    if (obj.sets.contents?.remaining && new Decimal(obj.sets.contents.remaining.value).isZero())
      obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
  }
  if (obj.row.parent_id) {
    const parent = await load(c, ctx, { kind: obj.kind, id: obj.row.parent_id } as Target);
    requireFact(
      obj.kind === 'ITEM'
        ? parent.sets.container?.can_contain === true
        : parent.row.kind === 'GROUP',
      'INVALID_PARENT',
      'Parent must be a GROUP or capable container.',
    );
    const ancestors = (
      await query(
        c,
        `WITH RECURSIVE a AS (SELECT id,parent_id FROM ${table(obj.kind)} WHERE household_id=$1 AND id=$2 UNION SELECT n.id,n.parent_id FROM ${table(obj.kind)} n JOIN a ON n.id=a.parent_id WHERE n.household_id=$1) SELECT id FROM a`,
        [ctx.household_id, obj.row.parent_id],
      )
    ).rows;
    requireFact(
      !ancestors.some((a) => a.id === obj.row.id),
      'CYCLE_DETECTED',
      'Cannot attach beneath itself.',
    );
  }
  if (obj.kind === 'CATALOG_NODE' && obj.sets.product?.barcodes) {
    for (const barcode of obj.sets.product.barcodes) {
      const existing = (
        await query(
          c,
          'SELECT catalog_node_id FROM barcode_index WHERE household_id=$1 AND barcode=$2',
          [ctx.household_id, barcode],
        )
      ).rows[0];
      requireFact(
        !existing || existing.catalog_node_id === obj.row.id,
        'BARCODE_CONFLICT',
        'Barcode already belongs to another SKU.',
      );
    }
  }
}
function initialSets(input: any[] | undefined) {
  const sets: Record<string, any> = {};
  for (const attr of input ?? []) {
    requireFact(
      !Object.hasOwn(sets, attr.template_id),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Duplicate template binding.',
    );
    validateValues(attr.template_id, attr.values, attr.template_version);
    sets[attr.template_id] = attr.values;
  }
  return sets;
}
function mutateAttributes(obj: ObjectState, input: any, mode: string) {
  const name = input.template_id as TemplateId;
  const definition = templateFor(name, input.template_version);
  if (mode === 'upgrade_attributes') {
    requireFact(
      name === 'product' &&
        obj.sets[name] &&
        versionOf(obj, name) === 1 &&
        input.template_version === 2,
      'ATTRIBUTE_VALIDATION_FAILED',
      'Only an existing product v1 binding can explicitly upgrade to v2.',
    );
    obj.sets[name] = validateValues(name, input.values, 2);
    requireFact(
      Object.keys(prune(structuredClone(obj.sets[name]))).length,
      'ATTRIBUTE_VALIDATION_FAILED',
      'Upgrade requires nonempty complete values.',
    );
    (obj.versions ??= {})[name] = 2;
    return;
  }
  requireFact(
    !obj.sets[name] || versionOf(obj, name) === input.template_version,
    'ATTRIBUTE_VALIDATION_FAILED',
    'Use the binding version; upgrade explicitly to change it.',
  );
  (obj.versions ??= {})[name] = input.template_version;
  if (mode === 'remove_attributes') {
    delete obj.sets[name];
    return;
  }
  if (mode === 'bind_attributes') {
    requireFact(!obj.sets[name], 'ATTRIBUTE_VALIDATION_FAILED', 'Template already bound.');
    obj.sets[name] = input.values;
    return;
  }
  obj.sets[name] = patch(obj.sets[name] ?? {}, input.set, input.unset, [...definition.paths]);
}
export async function execute(ctx: Context, name: Operation, raw: unknown): Promise<any> {
  return timed('business_ms', async () => {
    const result = await executeCommand(ctx, name, raw);
    const trace = traces.getStore();
    if (trace) trace.outcome = 'SUCCESS';
    return result;
  });
}
async function executeCommand(ctx: Context, name: Operation, raw: unknown): Promise<any> {
  const trace = traces.getStore();
  if (trace) trace.tool = name;
  const input = parseCommand(name, raw);
  if (trace) {
    trace.tool = name;
    trace.batch_size = input.items?.length ?? input.item_ids?.length ?? input.count ?? 1;
  }
  try {
    return await transaction(async (c) => {
      if (reads.has(name))
        await query(c, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      requireFact(
        (
          await query(c, 'SELECT 1 FROM actors WHERE household_id=$1 AND id=$2', [
            ctx.household_id,
            ctx.actor_id,
          ])
        ).rows.length,
        'FORBIDDEN',
        'Invalid household context.',
      );
      if (reads.has(name))
        return intakeReads.has(name) ? readIntake(c, ctx, name, input) : read(c, ctx, name, input);
      // Household writes are deliberately serialized for Stage1: one lock order also protects tree/capability races.
      await timed('lock_wait_ms', () =>
        query(c, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [ctx.household_id], false),
      );
      const fingerprint = createHash('sha256').update(canonical({ name, input })).digest('hex');
      const old = (
        await query(
          c,
          'SELECT * FROM operations WHERE household_id=$1 AND actor_id=$2 AND idempotency_key=$3',
          [ctx.household_id, ctx.actor_id, input.idempotency_key],
        )
      ).rows[0];
      if (old) {
        requireFact(
          old.fingerprint ===
            (old.fingerprint_format === 'legacy_v1'
              ? createHash('sha256')
                  .update(canonical({ name, input: legacyInput(name, input) }))
                  .digest('hex')
              : fingerprint),
          'IDEMPOTENCY_CONFLICT',
          'Key was used with different parameters.',
        );
        if (trace) {
          trace.idempotency_replay = true;
          trace.operation_id = old.result.operation_id;
        }
        return old.result;
      }
      const operation_id = 'operation_' + randomUUID();
      if (trace) trace.operation_id = operation_id;
      let result: any;
      if (name === 'propose_catalog_change')
        result = await proposeCatalogChange(c, ctx, input, operation_id);
      else if (name === 'commit_intake')
        result = await commitIntake(c, ctx, input, operation_id, applyDomainCommand);
      else {
        await authorizeCatalogCommand(c, ctx, name, input, operation_id);
        result = await applyDomainCommand(c, ctx, name, input, operation_id);
      }
      await query(
        c,
        'INSERT INTO operations(household_id,actor_id,idempotency_key,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)',
        [
          ctx.household_id,
          ctx.actor_id,
          input.idempotency_key,
          fingerprint,
          JSON.stringify(result),
        ],
      );
      return result;
    });
  } catch (e: any) {
    if (e instanceof DomainError) throw e;
    const code = e.code ?? e.cause?.code;
    if (code === '23505')
      throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Unique constraint conflict.');
    if (code === '23503') throw new DomainError('INVALID_PARENT', 'Invalid household reference.');
    throw e;
  }
}
async function bindingRecords(c: Client, ctx: Context, obj: ObjectState) {
  return obj.row.attributes.map(({ template_id, template_version, values }: any) => ({
    template_id,
    template_version,
    values,
  }));
}

async function view(c: Client, ctx: Context, obj: ObjectState, includePath = false) {
  const path = includePath
    ? (
        await query(
          c,
          `WITH RECURSIVE a AS (SELECT id,parent_id,0 AS depth FROM ${table(obj.kind)} WHERE household_id=$1 AND id=$2 UNION ALL SELECT n.id,n.parent_id,a.depth+1 FROM ${table(obj.kind)} n JOIN a ON n.id=a.parent_id WHERE n.household_id=$1) SELECT a.id FROM a ORDER BY depth DESC`,
          [ctx.household_id, obj.row.id],
        )
      ).rows.map((r) => r.id)
    : undefined;
  const row: any = {
    ...obj.row,
    ...(includePath ? { path_ids: path } : {}),
    attributes: await bindingRecords(c, ctx, obj),
  };
  if (obj.kind === 'ITEM') {
    row.catalog_name = (
      await query(c, 'SELECT name FROM catalog_nodes WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        obj.row.catalog_node_id,
      ])
    ).rows[0].name;
    row.notes = (
      await query(
        c,
        'SELECT * FROM notes WHERE household_id=$1 AND item_id=$2 ORDER BY created_at,id',
        [ctx.household_id, obj.row.id],
      )
    ).rows;
    const household = (
      await query(c, 'SELECT timezone FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0];
    row.reminder = reminderDate(obj.sets.lifecycle, household.timezone);
  }
  return row;
}
export function normalizeQuerySearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
export type BrowseCursor = {
  version: 1;
  household: string;
  query_hash: string;
  sort: { field: string; direction: 'asc' | 'desc' };
  last: { key: string | null; id: string };
  as_of_change_id: string;
};
export function encodeQueryCursor(cursor: BrowseCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeQueryCursor(
  encoded: string,
  expected: Pick<BrowseCursor, 'household' | 'query_hash' | 'sort'>,
): BrowseCursor {
  const invalid = () =>
    new DomainError('INVALID_CURSOR', 'Invalid cursor or changed query conditions.');
  try {
    if (!encoded || encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw invalid();
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) throw invalid();
    const value = JSON.parse(bytes.toString('utf8'));
    if (
      value.version !== 1 ||
      value.household !== expected.household ||
      value.query_hash !== expected.query_hash ||
      canonical(value.sort) !== canonical(expected.sort) ||
      typeof value.as_of_change_id !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(value.as_of_change_id) ||
      !value.last ||
      typeof value.last.id !== 'string' ||
      !/^(item|catalog_node|event)_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value.last.id,
      ) ||
      !(value.last.key === null || typeof value.last.key === 'string')
    )
      throw invalid();
    if (
      ['created_at', 'updated_at', 'recorded_at'].includes(expected.sort.field) &&
      (typeof value.last.key !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/.test(
          value.last.key,
        ) ||
        !Number.isFinite(Date.parse(value.last.key)) ||
        new Date(value.last.key.slice(0, 10)).toISOString().slice(0, 10) !==
          value.last.key.slice(0, 10))
    )
      throw invalid();
    if (
      expected.sort.field === 'reminder_date' &&
      value.last.key !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value.last.key) ||
        !Number.isFinite(Date.parse(value.last.key)) ||
        new Date(value.last.key).toISOString().slice(0, 10) !== value.last.key)
    )
      throw invalid();
    return value;
  } catch {
    throw invalid();
  }
}
function queryCursorContext(ctx: Context, name: string, input: any) {
  const { cursor: _, limit: __, include_path: ___, ...conditions } = input;
  for (const field of ['name', 'search'])
    if (conditions[field] !== undefined)
      conditions[field] = normalizeQuerySearch(conditions[field]);
  const sort = input.sort ?? { field: 'recorded_at', direction: 'desc' };
  const expected = {
    household: ctx.household_id,
    query_hash: createHash('sha256').update(canonical({ name, conditions })).digest('hex'),
    sort,
  };
  return {
    expected,
    cursor: input.cursor === undefined ? undefined : decodeQueryCursor(input.cursor, expected),
  };
}
// Only whitelisted sort expressions reach SQL. Values, paths and cursor keys are parameters.
function cursorPredicate(
  cursor: BrowseCursor | undefined,
  key: string,
  id: string,
  cast: string,
  direction: string,
  params: unknown[],
): string {
  if (!cursor) return 'TRUE';
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const op = direction === 'asc' ? '>' : '<';
  const lastId = bind(cursor.last.id);
  if (cursor.last.key === null) return `(${key} IS NULL AND ${id} ${op} ${lastId})`;
  const lastKey = `${bind(cursor.last.key)}::${cast}`;
  const tuple = `(${key},${id}) ${op} (${lastKey},${lastId})`;
  return cast === 'timestamptz' ? `(${tuple})` : `(${tuple} OR ${key} IS NULL)`;
}
function queryPage(
  rows: any[],
  input: any,
  expected: ReturnType<typeof queryCursorContext>['expected'],
  cursor: BrowseCursor | undefined,
  watermark: string,
) {
  const more = rows.length > input.limit;
  const data = rows.slice(0, input.limit);
  const last = data.at(-1);
  return {
    data: data.map(({ __key, ...row }) => row),
    next_cursor: more
      ? encodeQueryCursor({
          version: 1,
          ...expected,
          last: { key: last.__key, id: last.id },
          as_of_change_id: cursor?.as_of_change_id ?? watermark,
        })
      : null,
    as_of_change_id: cursor?.as_of_change_id ?? watermark,
    stale: cursor !== undefined && cursor.as_of_change_id !== watermark,
  };
}
async function readHistory(c: Client, ctx: Context, input: any) {
  const { expected, cursor } = queryCursorContext(ctx, 'get_history', input);
  if (cursor)
    requireFact(cursor.last.id.startsWith('event_'), 'INVALID_CURSOR', 'Invalid history cursor.');
  if (input.target) {
    const found = await query(
      c,
      `SELECT 1 FROM ${table(input.target.kind)} WHERE household_id=$1 AND id=$2`,
      [ctx.household_id, input.target.id],
    );
    requireFact(found.rows.length, 'NOT_FOUND', 'Object not found in this household.');
  }
  const params: unknown[] = [ctx.household_id];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = ['e.household_id=$1'];
  if (input.target)
    where.push(`e.target_kind=${bind(input.target.kind)} AND e.target_id=${bind(input.target.id)}`);
  if (input.operation_id) where.push(`e.operation_id=${bind(input.operation_id)}`);
  if (input.event_type) where.push(`e.event_type=${bind(input.event_type)}`);
  if (input.recorded_from) where.push(`e.recorded_at >= ${bind(input.recorded_from)}::timestamptz`);
  if (input.recorded_to) where.push(`e.recorded_at <= ${bind(input.recorded_to)}::timestamptz`);
  where.push(cursorPredicate(cursor, 'e.recorded_at', 'e.id', 'timestamptz', 'desc', params));
  const watermark = String(await currentChangeId(c, ctx.household_id));
  // JSON preserves PostgreSQL microseconds; a JS Date would truncate the key and skip ties.
  const rows = (
    await query(
      c,
      `SELECT to_jsonb(e) || jsonb_build_object('__key',e.recorded_at::text) AS row
    FROM events e WHERE ${where.join(' AND ')} ORDER BY e.recorded_at DESC,e.id DESC LIMIT ${bind(input.limit + 1)}`,
      params,
    )
  ).rows.map((r) => r.row);
  return {
    ...queryPage(rows, input, expected, cursor, watermark),
    summary: { as_of_change_id: watermark },
  };
}
async function readQuery(c: Client, ctx: Context, name: Operation, input: any) {
  const isItem = name === 'query_items';
  const kind = isItem ? 'ITEM' : 'CATALOG_NODE';
  const { expected, cursor } = queryCursorContext(ctx, name, input);
  if (cursor)
    requireFact(
      cursor.last.id.startsWith(isItem ? 'item_' : 'catalog_node_'),
      'INVALID_CURSOR',
      'Invalid object cursor.',
    );
  const params: unknown[] = [ctx.household_id];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const ctes: string[] = [];
  const where = ['o.household_id=$1'];
  const catalogId = isItem ? 'o.catalog_node_id' : 'o.id';
  const scopeChecks: string[] = [];
  for (const [field, relation, column] of [
    ['catalog_subtree_id', 'catalog_nodes', catalogId],
    ['within_item_id', 'items', 'o.id'],
  ]) {
    if (!input[field]) continue;
    const scope = `${field}_scope`;
    ctes.push(`${scope} AS (SELECT id FROM ${relation} WHERE household_id=$1 AND id=${bind(input[field])}
      UNION SELECT child.id FROM ${relation} child JOIN ${scope} parent ON child.parent_id=parent.id
      WHERE child.household_id=$1)`);
    where.push(`${column} IN (SELECT id FROM ${scope})`);
    scopeChecks.push(`EXISTS(SELECT 1 FROM ${scope})`);
  }
  if (input.catalog_node_ids)
    where.push(`${catalogId}=ANY(${bind(input.catalog_node_ids)}::text[])`);
  if (input.kind) where.push(`o.kind=${bind(input.kind)}`);
  if (input.barcode)
    where.push(`EXISTS(SELECT 1 FROM barcode_index b WHERE b.household_id=$1
    AND b.catalog_node_id=${catalogId} AND b.barcode=${bind(input.barcode)})`);
  if (!isItem && !input.include_hidden)
    where.push(
      `NOT o.attributes @> '[{"template_id":"catalog","values":{"visibility":"HIDDEN"}}]'::jsonb`,
    );

  // All predicates on a template share one array element, including date kind + both bounds.
  const grouped = new Map<string, string[]>();
  const candidates = new Map<string, Record<string, any>>();
  for (const f of input.attribute_filters ?? []) {
    const t = templateFor(f.template_id, latestTemplateVersion(f.template_id));
    requireFact(
      t.target_kind === kind && (t.paths as readonly string[]).includes(f.path),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Unknown filter path.',
    );
    if (f.op !== 'eq')
      requireFact(
        ['expiry.date', 'acquisition.acquired_on'].includes(f.path),
        'ATTRIBUTE_VALIDATION_FAILED',
        'Range filters support date fields only.',
      );
    validateValues(
      f.template_id,
      patch({}, { [f.path]: f.value }, [], [...t.paths]),
      latestTemplateVersion(f.template_id),
    );
    if (f.op === 'eq')
      candidates.set(
        f.template_id,
        patch(candidates.get(f.template_id) ?? {}, { [f.path]: f.value }, [], [...t.paths]),
      );
    const path = bind(['values', ...f.path.split('.')]);
    const predicate =
      f.op === 'eq'
        ? `(a #> ${path}::text[]) = ${bind(JSON.stringify(f.value))}::jsonb`
        : `(a #>> ${path}::text[]) ${f.op === 'gte' ? '>=' : '<='} ${bind(f.value)}::text`;
    grouped.set(f.template_id, [...(grouped.get(f.template_id) ?? []), predicate]);
  }
  for (const [template, predicates] of grouped) {
    // Indexable candidate predicate plus same-element typed verification.
    where.push(
      `o.attributes @> ${bind(JSON.stringify([{ template_id: template, ...(candidates.has(template) ? { values: candidates.get(template) } : {}) }]))}::jsonb`,
    );
    where.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(o.attributes) a WHERE a->>'template_id'=${bind(template)}
      AND ${predicates.join(' AND ')})`);
  }
  const current = `coalesce(__sets->'lifecycle'->>'state','') NOT IN ('CONSUMED','DISPOSED','LOST','ARCHIVED')`;
  if (
    (input.attribute_filters ?? []).some(
      (f: any) =>
        f.template_id === 'lifecycle' && f.path === 'availability' && f.value === 'AVAILABLE',
    )
  )
    where.push(current);

  for (const term of [input.name, input.search]) {
    if (!term || !normalizeQuerySearch(term)) continue;
    const pattern = bind('%' + normalizeQuerySearch(term).replace(/[\\%_]/g, '\\$&') + '%');
    const match = (expr: string) =>
      `acornary_normalize_search(${expr}) ILIKE ${pattern} ESCAPE E'\\\\'`;
    const productAttributes = isItem ? 'sku.attributes' : 'o.attributes';
    const fields = [match(isItem ? 'o.display_name' : 'o.name'), match('o.id')];
    if (isItem) fields.push(match('sku.name'), match('sku.id'));
    fields.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(${productAttributes}) a
      CROSS JOIN LATERAL (SELECT a->'values'->>'specification' AS value UNION ALL SELECT a->'values'->>'brand'
        UNION ALL SELECT a->'values'->>'model'
        UNION ALL SELECT jsonb_array_elements_text(coalesce(a->'values'->'barcodes','[]'::jsonb))) f
      WHERE a->>'template_id'='product' AND ${match('f.value')})`);
    if (isItem)
      fields.push(
        `EXISTS(SELECT 1 FROM notes n WHERE n.household_id=$1 AND n.item_id=o.id AND ${match('n.body')})`,
      );
    where.push(`(${fields.join(' OR ')})`);
  }
  const dateKey = `LEAST((__sets #>> '{lifecycle,expiry,date}')::date,
    ((__sets #>> '{lifecycle,opening,opened_at}')::timestamptz AT TIME ZONE h.timezone)::date
      + (__sets #>> '{lifecycle,expiry,after_opening_days}')::integer)`;
  const keys: Record<string, string> = {
    created_at: 'o.created_at',
    updated_at: 'o.updated_at',
    name: isItem
      ? 'acornary_normalize_search(coalesce(o.display_name,sku.name))'
      : 'acornary_normalize_search(o.name)',
    reminder_date: dateKey,
  };
  const field = input.sort.field;
  const direction = input.sort.direction === 'asc' ? 'ASC' : 'DESC';
  ctes.push(`matching AS MATERIALIZED (SELECT o.*,${keys[field]} AS __key,__sets
    ${isItem ? ',sku.name AS catalog_name,h.timezone AS __timezone' : ''}
    FROM ${table(kind)} o
    ${isItem ? 'JOIN catalog_nodes sku ON sku.household_id=o.household_id AND sku.id=o.catalog_node_id JOIN households h ON h.id=o.household_id' : ''}
    CROSS JOIN LATERAL (SELECT coalesce(jsonb_object_agg(a->>'template_id',a->'values'),'{}'::jsonb) AS __sets
      FROM jsonb_array_elements(o.attributes) a) bindings
    WHERE ${where.join(' AND ')})`);
  const after = cursorPredicate(
    cursor,
    '__key',
    'id',
    field === 'reminder_date' ? 'date' : field === 'name' ? 'text' : 'timestamptz',
    input.sort.direction,
    params,
  );
  ctes.push(`page AS (SELECT * FROM matching WHERE ${after}
    ORDER BY __key ${direction} NULLS LAST,id ${direction} LIMIT ${bind(input.limit + 1)})`);
  if (input.include_path)
    ctes.push(`ancestors AS (
    SELECT id AS origin,id,parent_id,0 AS depth,ARRAY[id] AS visited FROM page
    UNION ALL SELECT a.origin,p.id,p.parent_id,a.depth+1,a.visited || p.id
    FROM ancestors a JOIN ${table(kind)} p ON p.household_id=$1 AND p.id=a.parent_id
    WHERE NOT p.id=ANY(a.visited))`);
  if (isItem)
    ctes.push(`current_items AS (SELECT * FROM matching WHERE ${current}),
    units AS (SELECT __sets #>> '{contents,remaining,unit}' AS unit,
      trim_scale(sum((__sets #>> '{contents,remaining,value}')::numeric))::text AS value,
      count(*) FILTER (WHERE __sets #>> '{contents,accuracy}'='MEASURED') AS measured_count,
      count(*) FILTER (WHERE __sets #>> '{contents,accuracy}'='ESTIMATED') AS estimated_count,
      count(*) FILTER (WHERE coalesce(__sets #>> '{contents,accuracy}','') NOT IN ('MEASURED','ESTIMATED')) AS unknown_accuracy_count
      FROM current_items WHERE (__sets #>> '{contents,remaining,unit}') <> 'percent' GROUP BY 1)`);
  const summary = isItem
    ? `jsonb_build_object(
    'matching_count',(SELECT count(*) FROM matching),
    'current_count',count(*),
    'unknown_lifecycle_count',count(*) FILTER (WHERE (__sets #>> '{lifecycle,state}') IS NULL),
    'unknown_availability_count',count(*) FILTER (WHERE (__sets #>> '{lifecycle,availability}') IS NULL),
    'content_totals',jsonb_build_object(
      'by_unit',(SELECT coalesce(jsonb_object_agg(unit,to_jsonb(units)-'unit'),'{}'::jsonb) FROM units),
      'unknown_quantity_count',count(*) FILTER (WHERE (__sets #> '{contents,remaining}') IS NULL),
      'unconvertible_percentage_count',count(*) FILTER (WHERE __sets #>> '{contents,remaining,unit}'='percent')))
    FROM current_items`
    : `jsonb_build_object('matching_count',count(*)) FROM matching`;
  const watermark = String(await currentChangeId(c, ctx.household_id));
  const result = (
    await query(
      c,
      `WITH RECURSIVE ${ctes.join(',\n')}
    SELECT (${scopeChecks.join(' AND ') || 'TRUE'}) AS scope_exists,
      (SELECT ${summary}) AS summary,
      (SELECT coalesce(jsonb_agg(
        (to_jsonb(p)-'__sets'-'__timezone') || jsonb_build_object('__key',p.__key::text)
        ${
          isItem
            ? `|| jsonb_build_object('__lifecycle',p.__sets->'lifecycle','__timezone',p.__timezone)`
            : ''
        }
        ${
          input.include_path
            ? `|| jsonb_build_object('path_ids',(SELECT jsonb_agg(a.id ORDER BY a.depth DESC)
          FROM ancestors a WHERE a.origin=p.id))`
            : ''
        }
        ORDER BY p.__key ${direction} NULLS LAST,p.id ${direction}), '[]'::jsonb) FROM page p) AS data`,
      params,
    )
  ).rows[0];
  requireFact(result.scope_exists, 'NOT_FOUND', 'Scope not found in this household.');
  for (const row of result.data) {
    requireFact(
      Array.isArray(row.attributes) &&
        row.attributes.every(
          (a: any) =>
            a &&
            typeof a.template_id === 'string' &&
            Number.isInteger(a.template_version) &&
            a.values &&
            typeof a.values === 'object' &&
            !Array.isArray(a.values),
        ),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid embedded binding shape.',
    );
    row.attributes = row.attributes.map(({ template_id, template_version, values }: any) => ({
      template_id,
      template_version,
      values,
    }));
    if (isItem) {
      row.reminder = reminderDate(row.__lifecycle, row.__timezone);
      delete row.__lifecycle;
      delete row.__timezone;
    }
  }
  return {
    ...queryPage(result.data, input, expected, cursor, watermark),
    ...result.summary,
    summary: { ...result.summary, as_of_change_id: watermark },
  };
}

async function read(c: Client, ctx: Context, name: Operation, input: any): Promise<any> {
  if (name === 'get_connection_context') {
    const household = (
      await query(c, 'SELECT id,name,timezone FROM households WHERE id=$1', [ctx.household_id])
    ).rows[0];
    const actor = (
      await query(c, 'SELECT id,name FROM actors WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        ctx.actor_id,
      ])
    ).rows[0];
    return {
      ...ctx.connection,
      ...(traces.getStore()?.server_origin
        ? { server_origin: traces.getStore()!.server_origin }
        : {}),
      household,
      actor,
    };
  }
  if (name === 'list_attribute_templates')
    return {
      data: Object.keys(templates)
        .map((n) => templateDefinition(n as TemplateId, latestTemplateVersion(n as TemplateId)))
        .filter((t) => !input.target_kind || t.target_kind === input.target_kind),
    };
  if (name === 'get_attribute_template')
    return templateDefinition(input.template_id, input.template_version);
  if (name === 'get_history') return readHistory(c, ctx, input);
  if (name === 'get_attribute_sets') {
    const obj = await load(c, ctx, input.target);
    return {
      data: await bindingRecords(c, ctx, obj),
    };
  }
  if (name === 'get_item' || name === 'get_catalog_node')
    return view(
      c,
      ctx,
      await load(c, ctx, {
        kind: name === 'get_item' ? 'ITEM' : 'CATALOG_NODE',
        id: input.item_id ?? input.catalog_node_id,
      } as Target),
      input.include_path,
    );
  return readQuery(c, ctx, name, input);
}

// Transaction-scoped primitive: caller owns authorization, lock, idempotency and commit.
async function applyDomainCommand(
  c: Client,
  ctx: Context,
  name: Operation,
  input: any,
  operation_id: string,
): Promise<any> {
  const result: any = {
    operation_id,
    changed: false,
    affected_objects: [],
    event_ids: [],
    summary: 'No changes.',
  };
  const checkRevision = (obj: ObjectState) =>
    requireFact(
      input.expected_revisions[obj.row.id] === obj.row.revision,
      'REVISION_CONFLICT',
      'Re-query and submit the current revision.',
      {
        id: obj.row.id,
        expected_revision: input.expected_revisions[obj.row.id],
        current_revision: obj.row.revision,
      },
    );
  const save = async (
    obj: ObjectState,
    before?: ObjectState,
    extraBefore: Record<string, any> = {},
    extraAfter: Record<string, any> = {},
  ) => {
    if (
      obj.sets.product &&
      versionOf(obj, 'product') === 2 &&
      (!before?.sets.product || versionOf(before, 'product') !== 2)
    )
      requireFact(
        process.env.ACORNARY_PRODUCT_V2_WRITES !== '0',
        'ATTRIBUTE_VALIDATION_FAILED',
        'New product v2 bindings are disabled for the compatibility rollout.',
      );
    await validate(c, ctx, obj, before, name === 'correct_item');
    const delta = changes(
      { ...(before ? flatten(before) : {}), ...extraBefore },
      { ...flatten(obj), ...extraAfter },
    );
    if (!delta.length && before) return;
    const rev = before?.row.revision ?? 0;
    const now = (await query(c, 'SELECT to_jsonb(now()) AS time')).rows[0].time;
    const attributes = Object.keys(obj.sets)
      .sort()
      .map((template_id) => {
        const prior = before?.row.attributes.find((a: any) => a.template_id === template_id);
        return {
          template_id,
          template_version: versionOf(obj, template_id),
          values: obj.sets[template_id],
          created_at: prior?.created_at ?? now,
          updated_at:
            prior &&
            prior.template_version === versionOf(obj, template_id) &&
            canonical(prior.values) === canonical(obj.sets[template_id])
              ? prior.updated_at
              : now,
        };
      });
    await validateBindings(c, ctx, obj, attributes);
    const embedded = JSON.stringify(attributes);
    if (!before) {
      if (obj.kind === 'ITEM')
        await query(
          c,
          'INSERT INTO items(id,household_id,catalog_node_id,parent_id,display_name,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
          [
            obj.row.id,
            ctx.household_id,
            obj.row.catalog_node_id,
            obj.row.parent_id,
            obj.row.display_name ?? null,
            embedded,
          ],
        );
      else
        await query(
          c,
          'INSERT INTO catalog_nodes(id,household_id,parent_id,kind,name,attributes) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
          [obj.row.id, ctx.household_id, obj.row.parent_id, obj.row.kind, obj.row.name, embedded],
        );
    } else if (obj.kind === 'ITEM')
      await query(
        c,
        'UPDATE items SET catalog_node_id=$1,parent_id=$2,display_name=$3,attributes=$6::jsonb,revision=revision+1,updated_at=now() WHERE household_id=$4 AND id=$5',
        [
          obj.row.catalog_node_id,
          obj.row.parent_id,
          obj.row.display_name ?? null,
          ctx.household_id,
          obj.row.id,
          embedded,
        ],
      );
    else
      await query(
        c,
        'UPDATE catalog_nodes SET name=$1,parent_id=$2,attributes=$5::jsonb,revision=revision+1,updated_at=now() WHERE household_id=$3 AND id=$4',
        [obj.row.name, obj.row.parent_id, ctx.household_id, obj.row.id, embedded],
      );
    if (obj.kind === 'CATALOG_NODE') {
      const beforeBarcodes = new Set(before?.sets.product?.barcodes ?? []);
      const afterBarcodes = new Set(obj.sets.product?.barcodes ?? []);
      const barcodesChanged =
        beforeBarcodes.size !== afterBarcodes.size ||
        [...afterBarcodes].some((barcode) => !beforeBarcodes.has(barcode));
      if (barcodesChanged) {
        await query(c, 'DELETE FROM barcode_index WHERE household_id=$1 AND catalog_node_id=$2', [
          ctx.household_id,
          obj.row.id,
        ]);
        for (const barcode of afterBarcodes)
          await query(
            c,
            'INSERT INTO barcode_index(household_id,barcode,catalog_node_id) VALUES($1,$2,$3)',
            [ctx.household_id, barcode, obj.row.id],
          );
      }
    }
    const event_id = 'event_' + randomUUID();
    const enriched = delta.map((d) =>
      d.path.startsWith('attributes.')
        ? {
            ...d,
            template_id: d.path.split('.')[1],
            template_version: versionOf(obj, d.path.split('.')[1]),
          }
        : d,
    );
    await query(
      c,
      'INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,before_revision,after_revision,changes,actor_id,source,occurred_at,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)',
      [
        event_id,
        ctx.household_id,
        obj.kind,
        obj.row.id,
        operation_id,
        eventTypes[name],
        rev,
        rev + 1,
        JSON.stringify(enriched),
        ctx.actor_id,
        ctx.source,
        input.occurred_at ?? new Date().toISOString(),
        input.reason ?? null,
      ],
    );
    await recordSyncChange(c, ctx.household_id, obj.kind, obj.row.id, rev + 1, operation_id);
    result.affected_objects.push({
      kind: obj.kind,
      id: obj.row.id,
      before_revision: rev,
      after_revision: rev + 1,
    });
    result.event_ids.push(event_id);
  };
  if (name === 'create_catalog_node') {
    const obj: ObjectState = {
      kind: 'CATALOG_NODE',
      row: {
        id: 'catalog_node_' + randomUUID(),
        kind: input.kind,
        name: input.name,
        parent_id: input.parent_id,
      },
      sets: initialSets(input.initial_attributes),
      versions: Object.fromEntries(
        (input.initial_attributes ?? []).map((a: any) => [a.template_id, a.template_version]),
      ),
    };
    await save(obj);
  } else if (name === 'create_items_batch' || name === 'update_items_lifecycle') {
    const identity = name === 'create_items_batch' ? 'client_ref' : 'item_id';
    const seen = new Set<string>();
    if (name === 'create_items_batch') result.created_items = [];
    for (const [item_index, entry] of input.items.entries()) {
      try {
        requireFact(
          !seen.has(entry[identity]),
          'ATTRIBUTE_VALIDATION_FAILED',
          `Duplicate ${identity}.`,
        );
        seen.add(entry[identity]);
        if (name === 'create_items_batch') {
          const item_id = 'item_' + randomUUID();
          await save({
            kind: 'ITEM',
            row: {
              id: item_id,
              catalog_node_id: entry.catalog_node_id,
              parent_id: entry.parent_id,
              display_name: entry.display_name ?? null,
            },
            sets: initialSets(entry.initial_attributes),
            versions: Object.fromEntries(
              (entry.initial_attributes ?? []).map((a: any) => [a.template_id, a.template_version]),
            ),
          });
          result.created_items.push({
            client_ref: entry.client_ref,
            item_id,
            after_revision: 1,
          });
        } else {
          const before = await load(c, ctx, { kind: 'ITEM', id: entry.item_id });
          checkRevision(before);
          const obj = structuredClone(before);
          mutateAttributes(obj, { ...entry, template_id: 'lifecycle' }, 'update_attributes');
          await save(obj, before);
        }
      } catch (error) {
        if (error instanceof DomainError)
          throw new DomainError(error.code, error.message, {
            ...(error.details && typeof error.details === 'object' && !Array.isArray(error.details)
              ? error.details
              : { cause_details: error.details }),
            item_index,
            ...(entry.client_ref ? { client_ref: entry.client_ref } : { item_id: entry.item_id }),
          });
        throw error;
      }
    }
  } else if (name === 'create_items') {
    for (let i = 0; i < input.count; i++)
      await save({
        kind: 'ITEM',
        row: {
          id: 'item_' + randomUUID(),
          catalog_node_id: input.catalog_node_id,
          parent_id: input.parent_id,
          display_name: input.display_name ?? null,
        },
        sets: initialSets(input.initial_attributes),
        versions: Object.fromEntries(
          (input.initial_attributes ?? []).map((a: any) => [a.template_id, a.template_version]),
        ),
      });
  } else {
    let targets: Target[];
    if (name === 'consume_items' || name === 'move_items') {
      requireFact(
        new Set(input.item_ids).size === input.item_ids.length,
        'ATTRIBUTE_VALIDATION_FAILED',
        'Duplicate item IDs.',
      );
      targets = input.item_ids.map((id: string) => ({ kind: 'ITEM', id }));
    } else
      targets = [
        input.target ??
          (input.item_id
            ? { kind: 'ITEM', id: input.item_id }
            : { kind: 'CATALOG_NODE', id: input.catalog_node_id }),
      ];
    for (const t of targets.sort((a, b) => a.id.localeCompare(b.id))) {
      const before = await load(c, ctx, t);
      checkRevision(before);
      const obj = structuredClone(before);
      switch (name) {
        case 'update_catalog_node':
          obj.row.name = input.name;
          break;
        case 'update_item':
          obj.row.display_name = input.display_name;
          break;
        case 'move_catalog_node':
        case 'move_item':
        case 'move_items':
          obj.row.parent_id = input.parent_id;
          break;
        case 'upgrade_attributes':
        case 'bind_attributes':
        case 'update_attributes':
        case 'remove_attributes':
          mutateAttributes(obj, input, name);
          break;
        case 'open_item': {
          requireFact(
            !terminal.has(obj.sets.lifecycle?.state),
            'INVALID_TRANSITION',
            'Terminal item cannot be opened.',
          );
          const opening = obj.sets.lifecycle?.opening;
          if (opening?.state !== 'OPENED' && !opening?.opened_at)
            obj.sets.lifecycle = {
              ...obj.sets.lifecycle,
              opening: {
                state: 'OPENED',
                ...(input.opened_at ? { opened_at: input.opened_at } : {}),
              },
            };
          break;
        }
        case 'consume_items':
        case 'consume_item_content': {
          requireFact(
            !terminal.has(obj.sets.lifecycle?.state),
            'INVALID_TRANSITION',
            'Terminal item cannot be consumed.',
          );
          if (name === 'consume_items') {
            obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
            if (obj.sets.contents?.remaining) obj.sets.contents.remaining.value = '0';
          } else {
            requireFact(
              obj.sets.contents?.remaining,
              'MISSING_FACTS',
              'Known contents.remaining is required to subtract.',
              { required_paths: ['contents.remaining'], purpose: 'subtract content' },
            );
            obj.sets.contents = subtract(
              obj.sets.contents.remaining,
              input.amount,
              obj.sets.contents.accuracy,
              input.accuracy,
            );
          }
          break;
        }
        case 'correct_item': {
          if (input.core) obj.row.catalog_node_id = input.core.catalog_node_id;
          const ids = (input.attributes ?? []).map((a: any) => a.template_id);
          requireFact(
            new Set(ids).size === ids.length,
            'ATTRIBUTE_VALIDATION_FAILED',
            'Duplicate template patches.',
          );
          for (const attr of input.attributes ?? [])
            mutateAttributes(obj, attr, 'update_attributes');
          break;
        }
        case 'edit_item':
        case 'add_note':
        case 'update_note': {
          if (name === 'edit_item') {
            if (input.display_name !== undefined) obj.row.display_name = input.display_name;
            const set: Record<string, unknown> = {},
              unset: string[] = [];
            for (const [field, path] of [
              ['availability', 'availability'],
              ['acquired_on', 'acquisition.acquired_on'],
            ]) {
              if (input[field] === null) unset.push(path);
              else if (input[field] !== undefined) set[path] = input[field];
            }
            if (Object.keys(set).length || unset.length)
              obj.sets.lifecycle = patch(obj.sets.lifecycle ?? {}, set, unset, [
                ...templates.lifecycle.paths,
              ]);
            if (!input.note) break;
          }
          const noteInput = name === 'edit_item' ? input.note : input;
          const prior = noteInput.note_id
            ? (
                await query(
                  c,
                  'SELECT * FROM notes WHERE household_id=$1 AND item_id=$2 AND id=$3',
                  [ctx.household_id, obj.row.id, noteInput.note_id],
                )
              ).rows[0]
            : undefined;
          if (noteInput.note_id) requireFact(prior, 'NOT_FOUND', 'Note not found on this item.');
          const note_id = prior?.id ?? 'note_' + randomUUID();
          const title = noteInput.title === undefined ? (prior?.title ?? null) : noteInput.title;
          const left = prior
            ? { [`notes.${note_id}.body`]: prior.body, [`notes.${note_id}.title`]: prior.title }
            : {};
          const right = {
            [`notes.${note_id}.body`]: noteInput.body,
            [`notes.${note_id}.title`]: title,
          };
          if (changes(left, right).length) {
            if (prior)
              await query(c, 'UPDATE notes SET title=$1,body=$2,updated_at=now() WHERE id=$3', [
                title,
                noteInput.body,
                note_id,
              ]);
            else
              await query(
                c,
                'INSERT INTO notes(id,household_id,item_id,title,body,created_by) VALUES($1,$2,$3,$4,$5,$6)',
                [note_id, ctx.household_id, obj.row.id, title, noteInput.body, ctx.actor_id],
              );
          }
          await save(obj, before, left, right);
          result.note_id = note_id;
          continue;
        }
        default:
          throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Unsupported command.');
      }
      await save(obj, before);
    }
  }
  result.changed = result.affected_objects.length > 0;
  result.summary = result.changed
    ? `${result.affected_objects.length} object(s) changed; inspect affected_objects and get_history.`
    : 'No changes.';
  return result;
}
