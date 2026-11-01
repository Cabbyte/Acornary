import { executeExport, exportOperations } from './exports.js';
import {
  implementedFeatures,
  eventTypes as registeredEventTypes,
} from '../../../packages/contracts/src/index.js';
import { maintainReferences, reverseReferences } from './references.js';
import {
  splitInfoSql,
  splitInfo,
  assertVoidable,
  assertNoSplitRestore,
  prepareSplit,
  stockStatus,
} from './semantics.js';
import { derivedAvailability } from '../../../packages/contracts/src/semantics.js';
import { rebuildIdentityIndex } from './intake.js';
import { fileOperations, type fileSchemas } from '../../../packages/contracts/src/notes.js';
import { executeFiles, listNotes, mutateNote, noteSummary, noteRow } from './notes.js';
import { attachmentRead } from './attachments.js';
import {
  findTemplate,
  canUpgrade,
  resolveCapabilities,
  pathCapability,
} from '../../../packages/contracts/src/registry.js';
import {
  bindingStatuses,
  bindingStatus,
  assertWritableTemplate,
  availableTemplate,
  templateForCapabilities,
} from './registry.js';
import {
  intakeReads,
  readIntake,
  proposeCatalogChange,
  authorizeCatalogCommand,
  commitIntake,
} from './intake.js';
import { currentChangeId } from './change-watermark.js';
import { randomUUID, createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  parseCommand,
  templateFor,
  latestTemplateVersion,
  reads,
  templateId,
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
} from '../../../packages/domain/src/index.js';
import { query, transaction, type Client } from './db.js';
import {
  recomputeItemDates,
  itemDateRowsSql,
  dateStateSql,
  itemDatesJsonSql,
  dateView,
  advanceDeadline,
} from './dates.js';
import { recordSyncChange } from './sync.js';
import { publishSyncTombstone } from './sync-api.js';
import { projectLabels } from './label-projection.js';
import { inventoryGroupsV2 } from './web.js';
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
  binding_statuses?: Record<string, string>;
  raw_bindings?: Record<string, string>;
};
const versionOf = (obj: ObjectState, name: string) =>
  obj.versions?.[name] ?? (name === 'lifecycle' ? 2 : 1);
const table = (kind: string) => (kind === 'ITEM' ? 'items' : 'catalog_nodes');

const eventTypes: Record<string, (typeof registeredEventTypes)[number]> = {
  add_deadline: 'ADD_DEADLINE',
  update_deadline: 'UPDATE_DEADLINE',
  remove_deadline: 'REMOVE_DEADLINE',
  complete_deadline: 'COMPLETE_DEADLINE',
  void_item: 'VOID',
  void_catalog_node: 'VOID',
  dispose_item: 'DISPOSE',
  split_item: 'SPLIT',
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
    await query(
      c,
      `SELECT *,ARRAY(SELECT a::text FROM jsonb_array_elements(attributes) a) AS __raw_bindings
      FROM ${table(t.kind)} WHERE household_id=$1 AND id=$2`,
      [ctx.household_id, t.id],
    )
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Object not found in this household.');
  const obj: ObjectState = {
    kind: t.kind,
    row,
    sets: {},
    raw_bindings: Object.fromEntries(
      row.attributes.map((a: any, i: number) => [a.template_id, row.__raw_bindings[i]]),
    ),
    versions: Object.fromEntries(
      row.attributes.map((a: any) => [a.template_id, a.template_version]),
    ),
  };
  delete row.__raw_bindings;
  obj.binding_statuses = Object.fromEntries(await bindingStatuses(c, ctx.household_id));
  await validateBindings(c, ctx, obj, row.attributes);
  obj.sets = Object.fromEntries(row.attributes.map((a: any) => [a.template_id, a.values]));
  const catalog =
    t.kind === 'CATALOG_NODE'
      ? row
      : (
          await query(
            c,
            'SELECT profile,capabilities FROM catalog_nodes WHERE household_id=$1 AND id=$2',
            [ctx.household_id, row.catalog_node_id],
          )
        ).rows[0];
  row.effective_capabilities = resolveCapabilities(
    catalog?.profile ?? null,
    catalog?.capabilities ?? null,
  );
  return obj;
}
async function validateBindings(c: Client, ctx: Context, obj: ObjectState, bindings: any[]) {
  requireFact(
    Array.isArray(bindings),
    'ATTRIBUTE_VALIDATION_FAILED',
    'Attributes must be an array.',
  );
  const seen = new Set<string>();
  const statuses = await bindingStatuses(c, ctx.household_id);
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
        typeof a.template_id === 'string' &&
        a.template_id.length > 0 &&
        !seen.has(a.template_id) &&
        Number.isInteger(a.template_version) &&
        a.template_version > 0 &&
        a.values &&
        typeof a.values === 'object' &&
        !Array.isArray(a.values),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Invalid or duplicate embedded binding.',
    );
    seen.add(a.template_id);
    // Unknown and retired payloads are opaque, including empty/nested objects.
    if (bindingStatus(a, statuses) !== 'KNOWN') continue;
    const t = templateFor(a.template_id, a.template_version);
    requireFact(
      t.target_kind === obj.kind && (obj.kind === 'ITEM' || obj.row.kind === 'SKU'),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Template not applicable to this object.',
    );
    validateValues(a.template_id, a.values, a.template_version);
  }
}

function flatten(obj: ObjectState): Record<string, any> {
  const r: Record<string, any> = {};
  for (const field of obj.kind === 'ITEM'
    ? ['catalog_node_id', 'parent_id', 'display_name', 'record_state', 'voided_at']
    : [
        'kind',
        'name',
        'parent_id',
        'profile',
        'capabilities',
        'one_off',
        'record_state',
        'voided_at',
      ])
    if (Object.hasOwn(obj.row, field)) r[field] = obj.row[field];
  for (const [name, value] of Object.entries(obj.sets)) {
    r[`attributes.${name}.$binding`] = {
      template_id: name,
      template_version: versionOf(obj, name),
    };
    const definition = findTemplate(name, versionOf(obj, name));
    if (!definition) {
      r[`attributes.${name}.$values`] = value;
      continue;
    }
    for (const path of definition.paths) {
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
  command = '',
) {
  requireFact(
    !before || before.row.record_state !== 'VOID' || correction,
    'STATE_CONFLICT',
    'Restore a void record through correct_item before editing.',
  );
  if (JSON.stringify(obj.sets.disposition) !== JSON.stringify(before?.sets.disposition))
    requireFact(
      ['dispose_item', 'correct_item'].includes(command),
      'STATE_CONFLICT',
      'Disposition changes require dispose_item or a reasoned correction.',
    );
  if (
    obj.kind === 'ITEM' &&
    terminal.has(obj.sets.lifecycle?.state) &&
    obj.sets.lifecycle?.state !== before?.sets.lifecycle?.state
  )
    requireFact(
      [
        'dispose_item',
        'consume_items',
        'consume_item_content',
        'split_item',
        'correct_item',
      ].includes(command),
      'STATE_CONFLICT',
      'Use a terminal-state command or reasoned correction.',
    );
  if (
    obj.kind === 'ITEM' &&
    before &&
    ((terminal.has(before.sets.lifecycle?.state) && !terminal.has(obj.sets.lifecycle?.state)) ||
      (before.row.record_state === 'VOID' && obj.row.record_state === 'VALID'))
  )
    await assertNoSplitRestore(c, ctx.household_id, obj.row.id);
  if (
    obj.kind === 'CATALOG_NODE' &&
    obj.row.kind === 'GROUP' &&
    (!before || before.row.name !== obj.row.name || before.row.parent_id !== obj.row.parent_id)
  ) {
    const duplicate = await query(
      c,
      `SELECT 1 FROM catalog_nodes WHERE household_id=$1 AND kind='GROUP' AND record_state='VALID' AND parent_id IS NOT DISTINCT FROM $2 AND acornary_normalize_search(name)=acornary_normalize_search($3) AND id<>$4 LIMIT 1`,
      [ctx.household_id, obj.row.parent_id, obj.row.name, obj.row.id],
    );
    requireFact(!duplicate.rows.length, 'STATE_CONFLICT', 'Sibling GROUP names must be distinct.');
  }
  requireFact(
    Object.keys(obj.sets).length <= 16,
    'ATTRIBUTE_VALIDATION_FAILED',
    'At most 16 template bindings are allowed.',
  );
  const statuses = await bindingStatuses(c, ctx.household_id);
  const catalog =
    obj.kind === 'CATALOG_NODE'
      ? obj.row
      : (
          await query(
            c,
            'SELECT profile,capabilities FROM catalog_nodes WHERE household_id=$1 AND id=$2',
            [ctx.household_id, obj.row.catalog_node_id],
          )
        ).rows[0];
  const capabilities = resolveCapabilities(catalog?.profile ?? null, catalog?.capabilities ?? null);
  const configured = catalog?.profile != null || catalog?.capabilities != null;
  for (const [name, value] of Object.entries(obj.sets)) {
    const unchanged =
      before &&
      Object.hasOwn(before.sets, name) &&
      versionOf(before, name) === versionOf(obj, name) &&
      canonical(before.sets[name]) === canonical(value);
    if (unchanged) continue;
    const t = await assertWritableTemplate(c, ctx.household_id, name, versionOf(obj, name));
    requireFact(
      t.target_kind === obj.kind && (obj.kind === 'ITEM' || obj.row.kind === 'SKU'),
      'ATTRIBUTE_VALIDATION_FAILED',
      'Template not applicable to this object.',
    );
    // Capabilities govern new bindings for explicitly configured SKUs; legacy
    // unprofiled SKUs remain writable so existing clients keep working.
    if (configured && !before?.sets[name]) {
      for (const path of t.paths) {
        const capability = pathCapability(name, path);
        requireFact(
          !capability || getPath(value, path) === undefined || capabilities.includes(capability),
          'ATTRIBUTE_VALIDATION_FAILED',
          'Enable the capability before adding this binding.',
        );
      }
    }
    // Historical v1 remains readable; live lifecycle writes use the current field set.
    obj.sets[name] = prune(
      validateValues(name, value, name === 'lifecycle' ? 2 : versionOf(obj, name)),
    );
    if (!Object.keys(obj.sets[name]).length && !(name === 'lifecycle' && versionOf(obj, name) === 2))
      delete obj.sets[name];
  }
  if (obj.kind === 'ITEM') {
    const catalog = await load(c, ctx, { kind: 'CATALOG_NODE', id: obj.row.catalog_node_id });
    requireFact(
      catalog.row.kind === 'SKU' && catalog.row.record_state !== 'VOID',
      'ATTRIBUTE_VALIDATION_FAILED',
      'Item requires a SKU.',
    );
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
    if (
      bindingStatus(
        { template_id: 'contents', template_version: versionOf(obj, 'contents') },
        statuses,
      ) === 'KNOWN' &&
      obj.sets.contents?.remaining &&
      new Decimal(obj.sets.contents.remaining.value).isZero() &&
      obj.sets.lifecycle?.state !== 'CONSUMED'
    ) {
      requireFact(
        ['consume_items', 'consume_item_content', 'split_item', 'correct_item'].includes(command),
        'STATE_CONFLICT',
        'Use a consumption command or reasoned correction to zero contents.',
      );
      await assertWritableTemplate(c, ctx.household_id, 'lifecycle', versionOf(obj, 'lifecycle'));
      obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
    }
  }
  if (obj.row.parent_id) {
    const parent = await load(c, ctx, { kind: obj.kind, id: obj.row.parent_id } as Target);
    requireFact(
      parent.row.record_state !== 'VOID' &&
        (obj.kind === 'ITEM'
          ? parent.sets.container?.can_contain === true
          : parent.row.kind === 'GROUP'),
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
  if (
    obj.kind === 'CATALOG_NODE' &&
    bindingStatus(
      { template_id: 'product', template_version: versionOf(obj, 'product') },
      statuses,
    ) === 'KNOWN' &&
    obj.sets.product?.barcodes
  ) {
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
  requireFact(
    Object.keys(obj.sets).length <= 16,
    'ATTRIBUTE_VALIDATION_FAILED',
    'At most 16 template bindings are allowed.',
  );
  for (const [name, value] of Object.entries(before?.sets ?? {})) {
    if (
      bindingStatus({ template_id: name, template_version: versionOf(before!, name) }, statuses) !==
      'KNOWN'
    )
      requireFact(
        Object.hasOwn(obj.sets, name) &&
          versionOf(before!, name) === versionOf(obj, name) &&
          canonical(value) === canonical(obj.sets[name]),
        'ATTRIBUTE_VALIDATION_FAILED',
        'Unknown or retired template is read-only.',
      );
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
  requireFact(
    obj.binding_statuses?.[`${name}@${versionOf(obj, name)}`] !== 'RETIRED' &&
      obj.binding_statuses?.[`${name}@${input.to_version ?? input.template_version}`] !== 'RETIRED',
    'ATTRIBUTE_VALIDATION_FAILED',
    'Unknown or retired template is read-only.',
  );
  if (mode === 'upgrade_attributes') {
    const from = input.from_version ?? versionOf(obj, name);
    const to = input.to_version ?? input.template_version;
    requireFact(
      obj.sets[name] && versionOf(obj, name) === from && canUpgrade(name, from, to),
      'ATTRIBUTE_VALIDATION_FAILED',
      'No registered upgrade from the bound version to the requested version.',
    );
    obj.sets[name] = validateValues(name, input.values, to);
    requireFact(
      (name === 'lifecycle' && to === 2) || Object.keys(prune(structuredClone(obj.sets[name]))).length,
      'ATTRIBUTE_VALIDATION_FAILED',
      'Upgrade requires nonempty complete values.',
    );
    (obj.versions ??= {})[name] = to;
    return;
  }
  const definition = templateFor(name, input.template_version);
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
  obj.sets[name] = patch(obj.sets[name] ?? {}, input.set, input.unset, [
    ...(name === 'lifecycle' ? templates.lifecycle.paths : definition.paths),
  ]);
}
export async function execute(ctx: Context, name: Operation, raw: unknown): Promise<any> {
  return timed('business_ms', async () => {
    const result = fileOperations.has(name)
      ? await executeFiles(ctx, name as keyof typeof fileSchemas, raw)
      : await executeCommand(ctx, name, raw);
    const trace = traces.getStore();
    if (trace) trace.outcome = 'SUCCESS';
    return result;
  }).catch((error) => {
    throw mapDatabaseError(error);
  });
}
export async function assertWriteIsolation(c: Client): Promise<void> {
  const isolation = (await query(c, 'SHOW transaction_isolation')).rows[0]?.transaction_isolation;
  requireFact(
    isolation === 'read committed',
    'UNSUPPORTED_WRITE_ISOLATION',
    'Writes require READ COMMITTED transactions.',
  );
}
async function executeCommand(ctx: Context, name: Operation, raw: unknown): Promise<any> {
  if (exportOperations.has(name)) return executeExport(ctx, name, raw, readQuery);
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
      await assertWriteIsolation(c);
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
          old.fingerprint === fingerprint,
          'IDEMPOTENCY_CONFLICT',
          'Key was used with different parameters.',
        );
        if (trace) {
          trace.idempotency_replay = true;
          trace.operation_id = old.result.operation_id;
        }
        if (name === 'edit_item' && old.result.note_id)
          return { ...old.result, note: noteSummary(await noteRow(c, ctx, old.result.note_id)) };
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
    throw mapDatabaseError(e);
  }
}
async function bindingRecords(c: Client, ctx: Context, obj: ObjectState) {
  const statuses = await bindingStatuses(c, ctx.household_id);
  return obj.row.attributes.map((a: any) => {
    const status = bindingStatus(a, statuses);
    return {
      template_id: a.template_id,
      template_version: a.template_version,
      values: a.values,
      ...(status === 'KNOWN' ? {} : { status }),
    };
  });
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
    row.split = await splitInfo(c, ctx.household_id, obj.row.id);
    row.derived_availability = derivedAvailability(obj.sets);
    row.catalog_name = (
      await query(c, 'SELECT name FROM catalog_nodes WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        obj.row.catalog_node_id,
      ])
    ).rows[0].name;
    const target = { kind: 'ITEM' as const, id: obj.row.id };
    row.notes = (await listNotes(c, ctx, { target, limit: 200 })).data;
    row.attachments = (await attachmentRead(c, ctx, { target, limit: 200 })).data;
    const dates = (
      await query(
        c,
        `SELECT ${itemDatesJsonSql()} AS dates
      FROM items o JOIN households h ON h.id=o.household_id
      WHERE o.household_id=$1 AND o.id=$2`,
        [ctx.household_id, obj.row.id],
      )
    ).rows[0].dates;
    Object.assign(row, dateView(dates, row.attributes));
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
  const isGroups = name === 'query_inventory_groups';
  if (isGroups) input = { ...input, sort: { field: 'name', direction: 'asc' } };
  const isItem = name === 'query_items' || isGroups;
  const kind = isItem ? 'ITEM' : 'CATALOG_NODE';
  const { expected, cursor } = queryCursorContext(ctx, name, input);
  if (cursor)
    requireFact(
      cursor.last.id.startsWith(isItem && !isGroups ? 'item_' : 'catalog_node_'),
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
  if (!input.include_void) where.push("o.record_state='VALID'");
  if (!isItem && !input.include_one_off) where.push('NOT o.one_off');
  if (isItem && !input.include_terminal)
    where.push(
      "coalesce(__sets->'lifecycle'->>'state','') NOT IN ('CONSUMED','DISPOSED','LOST','ARCHIVED')",
    );
  const profileAlias = isItem ? 'sku' : 'o';
  if (input.profile) where.push(`${profileAlias}.profile=${bind(input.profile)}`);
  if (input.capabilities?.length) {
    const defaults = Object.fromEntries(
      ['CONSUMABLE', 'DURABLE', 'WEARABLE', 'SPACE', 'MISC'].map((p) => [
        p,
        resolveCapabilities(p as any, null),
      ]),
    );
    where.push(
      `coalesce(${profileAlias}.capabilities, ARRAY(SELECT jsonb_array_elements_text(${bind(JSON.stringify(defaults))}::jsonb -> ${profileAlias}.profile))) @> ${bind(input.capabilities)}::text[]`,
    );
  }
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
    const filterValues = patch({}, { [f.path]: f.value }, [], [...t.paths]);
    if (f.template_id === 'disposition' || f.template_id === 'stock')
      requireFact(
        t.schema.partial().safeParse(filterValues).success,
        'ATTRIBUTE_VALIDATION_FAILED',
        'Invalid filter value.',
      );
    else validateValues(f.template_id, filterValues, latestTemplateVersion(f.template_id));
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
        `EXISTS(SELECT 1 FROM notes n WHERE n.household_id=$1 AND n.target_kind='ITEM' AND n.target_id=o.id AND ${match('n.body')})`,
      );
    where.push(`(${fields.join(' OR ')})`);
  }
  for (const filter of input.date_filters ?? []) {
    const predicates: string[] = [];
    if (filter.kind) predicates.push(`d.kind=${bind(filter.kind)}`);
    if (filter.source)
      predicates.push(
        `d.source_template=${bind(filter.source === 'DEADLINE' ? 'deadline' : 'lifecycle')}`,
      );
    if (filter.from) predicates.push(`d.due_on >= ${bind(filter.from)}::date`);
    if (filter.to) predicates.push(`d.due_on <= ${bind(filter.to)}::date`);
    if (filter.state) predicates.push(`${dateStateSql()}=${bind(filter.state)}`);
    where.push(
      `EXISTS(SELECT 1 FROM ${itemDateRowsSql()} d WHERE ${predicates.join(' AND ') || 'TRUE'})`,
    );
  }
  const dateKey = `(SELECT min(d.due_on) FROM ${itemDateRowsSql()} d WHERE d.completed_on IS NULL)`;
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
    ${isItem ? ',sku.name AS catalog_name,sku.profile AS __profile,sku.capabilities AS __capabilities,h.timezone AS __timezone' : ''}
    FROM ${table(kind)} o
    ${isItem ? 'JOIN catalog_nodes sku ON sku.household_id=o.household_id AND sku.id=o.catalog_node_id JOIN households h ON h.id=o.household_id' : ''}
    CROSS JOIN LATERAL (SELECT coalesce(jsonb_object_agg(a->>'template_id',a->'values'),'{}'::jsonb) AS __sets
      FROM jsonb_array_elements(o.attributes) a) bindings
    WHERE ${where.join(' AND ')})`);
  if (isGroups) {
    const watermark = String(await currentChangeId(c, ctx.household_id));
    const result = (await query(c, `WITH RECURSIVE ${ctes.join(',\n')}
      SELECT (${scopeChecks.join(' AND ') || 'TRUE'}) AS scope_exists,
      (SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM matching m) AS items`, params)).rows[0];
    requireFact(result.scope_exists, 'NOT_FOUND', 'Scope not found in this household.');
    const catalog = [...new Map<string, any>(result.items.map((i: any) => [i.catalog_node_id, { id: i.catalog_node_id, name: i.catalog_name, profile: i.__profile }])).values()];
    const groups = inventoryGroupsV2(result.items, catalog);
    groups.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const remaining = groups.filter(g => !cursor || g.id > cursor.last.id);
    const page = remaining.slice(0, input.limit);
    return { groups: page, matching_group_count: groups.length, as_of_change_id: watermark,
      stale: !!cursor && cursor.as_of_change_id !== watermark,
      next_cursor: remaining.length > input.limit ? encodeQueryCursor({ version: 1, ...expected,
        last: { key: page.at(-1)!.id, id: page.at(-1)!.id }, as_of_change_id: cursor?.as_of_change_id ?? watermark }) : null };
  }
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
    ctes.push(`current_items AS (SELECT * FROM matching WHERE record_state='VALID' AND ${current}),
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
            ? `|| jsonb_build_object('__dates',(SELECT ${itemDatesJsonSql('p', 'h')} FROM households h WHERE h.id=$1), 'split', ${splitInfoSql('p')})`
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
    row.effective_capabilities = resolveCapabilities(
      isItem ? row.__profile : row.profile,
      isItem ? row.__capabilities : row.capabilities,
    );
    delete row.__profile;
    delete row.__capabilities;
    if (isItem) {
      row.split ??= null;
      row.derived_availability = derivedAvailability(
        Object.fromEntries(row.attributes.map((a: any) => [a.template_id, a.values])),
      );
      Object.assign(row, dateView(row.__dates, row.attributes));
      delete row.__dates;
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
      protocol: { current: 2, min: 2 },
      features: [...implementedFeatures],
    };
  }
  if (name === 'list_attribute_templates') {
    const catalog = input.catalog_node_id
      ? await load(c, ctx, { kind: 'CATALOG_NODE', id: input.catalog_node_id })
      : undefined;
    const filtered = catalog !== undefined || input.profile !== undefined;
    const capabilities = resolveCapabilities(
      input.profile !== undefined ? input.profile : (catalog?.row.profile ?? null),
      catalog?.row.capabilities ?? null,
    );
    const statuses = await bindingStatuses(c, ctx.household_id);
    let data = templateId.options
      .map((n) => templateDefinition(n, latestTemplateVersion(n)))
      .filter(
        (t) =>
          bindingStatus({ template_id: t.id, template_version: t.version }, statuses) === 'KNOWN',
      )
      .filter((t) => !input.target_kind || t.target_kind === input.target_kind)
      .filter(
        (t) =>
          !catalog ||
          t.target_kind === 'ITEM' ||
          t.allowed_catalog_node_kinds.includes(catalog.row.kind),
      )
      .filter((t) => !filtered || availableTemplate(t, capabilities));
    if (filtered) data = data.map((t) => templateForCapabilities(t, capabilities));
    if (input.capability)
      data = data.filter(
        (t) =>
          t.capability === input.capability ||
          t.fields.some((field) => pathCapability(t.id, field.path) === input.capability),
      );
    return { data };
  }
  if (name === 'get_attribute_template')
    return templateDefinition(input.template_id, input.template_version);
  if (name === 'query_references') {
    requireFact(
      input.target.kind !== 'EXTERNAL',
      'REFERENCE_INVALID',
      'External names have no identity index.',
    );
    return { data: await reverseReferences(c, ctx.household_id, input.target) };
  }
  if (name === 'query_stock') return readStock(c, ctx, input);
  if (name === 'get_history') return readHistory(c, ctx, input);
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
    await validate(c, ctx, obj, before, name === 'correct_item', name);
    const delta = changes(
      { ...(before ? flatten(before) : {}), ...extraBefore },
      { ...flatten(obj), ...extraAfter },
    );
    if (!delta.length && before) return;
    const rev = before?.row.revision ?? 0;
    const now = (await query(c, 'SELECT to_jsonb(now()) AS time')).rows[0].time;
    const priorOrder: string[] = (before?.row.attributes ?? []).map((a: any) => a.template_id);
    const order = before
      ? [
          ...priorOrder.filter((id) => Object.hasOwn(obj.sets, id)),
          ...Object.keys(obj.sets)
            .filter((id) => !priorOrder.includes(id))
            .sort(),
        ]
      : Object.keys(obj.sets).sort();
    const attributes = order.map((template_id) => {
      const prior = before?.row.attributes.find((a: any) => a.template_id === template_id);
      if (
        prior &&
        prior.template_version === versionOf(obj, template_id) &&
        canonical(prior.values) === canonical(obj.sets[template_id])
      )
        return prior;
      return {
        template_id,
        template_version: versionOf(obj, template_id),
        values: obj.sets[template_id],
        created_at: prior?.created_at ?? now,
        updated_at: now,
      };
    });
    await validateBindings(c, ctx, obj, attributes);
    // Reuse PostgreSQL's JSONB text for unchanged bindings. JSON.parse/stringify alone would
    // round large numeric literals in opaque future payloads even on an unrelated rename.
    const embedded =
      '[' +
      attributes
        .map((a) =>
          before?.row.attributes.includes(a) && before.raw_bindings?.[a.template_id]
            ? before.raw_bindings[a.template_id]
            : JSON.stringify(a),
        )
        .join(',') +
      ']';
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
          'INSERT INTO catalog_nodes(id,household_id,parent_id,kind,name,attributes,profile,capabilities,one_off) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',
          [
            obj.row.id,
            ctx.household_id,
            obj.row.parent_id,
            obj.row.kind,
            obj.row.name,
            embedded,
            obj.row.profile ?? null,
            obj.row.capabilities ?? null,
            obj.row.one_off ?? false,
          ],
        );
    } else if (obj.kind === 'ITEM')
      await query(
        c,
        'UPDATE items SET catalog_node_id=$1,parent_id=$2,display_name=$3,attributes=$6::jsonb,record_state=$7,voided_at=$8,revision=revision+1,updated_at=now() WHERE household_id=$4 AND id=$5',
        [
          obj.row.catalog_node_id,
          obj.row.parent_id,
          obj.row.display_name ?? null,
          ctx.household_id,
          obj.row.id,
          embedded,
          obj.row.record_state ?? 'VALID',
          obj.row.voided_at ?? null,
        ],
      );
    else
      await query(
        c,
        'UPDATE catalog_nodes SET name=$1,parent_id=$2,attributes=$5::jsonb,profile=$6,capabilities=$7,one_off=$8,record_state=$9,voided_at=$10,revision=revision+1,updated_at=now() WHERE household_id=$3 AND id=$4',
        [
          obj.row.name,
          obj.row.parent_id,
          ctx.household_id,
          obj.row.id,
          embedded,
          obj.row.profile ?? null,
          obj.row.capabilities ?? null,
          obj.row.one_off ?? false,
          obj.row.record_state ?? 'VALID',
          obj.row.voided_at ?? null,
        ],
      );
    if (
      obj.kind === 'CATALOG_NODE' &&
      bindingStatus(
        { template_id: 'product', template_version: versionOf(obj, 'product') },
        new Map(Object.entries(obj.binding_statuses ?? {})) as Map<
          string,
          'KNOWN' | 'UNKNOWN' | 'RETIRED'
        >,
      ) === 'KNOWN'
    ) {
      const beforeBarcodes = new Set(
        findTemplate('product', versionOf(before ?? obj, 'product'))
          ? (before?.sets.product?.barcodes ?? [])
          : [],
      );
      const afterBarcodes = new Set(
        findTemplate('product', versionOf(obj, 'product'))
          ? (obj.sets.product?.barcodes ?? [])
          : [],
      );
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
    await maintainReferences(c, ctx.household_id, obj);
    if (obj.kind === 'CATALOG_NODE') {
      const rebuilt = await rebuildIdentityIndex(c, ctx.household_id);
      if (rebuilt.conflicts.length) result.identity_conflicts = rebuilt.conflicts;
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
    if (
      canonical(before?.sets ?? {}) !== canonical(obj.sets) &&
      ((obj.sets.device && versionOf(obj, 'device') === 2) ||
        (obj.sets.clothing && versionOf(obj, 'clothing') === 2) ||
        (obj.sets.contents && versionOf(obj, 'contents') === 2) ||
        obj.sets.stock)
    )
      enriched.push({
        path: 'quantity_input',
        before_present: false,
        after_present: true,
        after: originalQuantityInputs(input),
      });
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
    if (obj.row.record_state === 'VOID' || obj.sets.lifecycle?.state === 'ARCHIVED')
      await publishSyncTombstone(c, ctx.household_id, obj.kind, obj.row.id, rev + 1, operation_id);
    else await recordSyncChange(c, ctx.household_id, obj.kind, obj.row.id, rev + 1, operation_id);
    if (obj.kind === 'ITEM') await recomputeItemDates(c, ctx.household_id, obj.row.id);
    await projectLabels(c, ctx.household_id, obj.kind, obj.row.id, event_id, operation_id);
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
        profile: input.profile ?? null,
        capabilities: input.capabilities ?? null,
        one_off: input.one_off ?? false,
        parent_id: input.parent_id,
      },
      sets: initialSets(input.initial_attributes),
      versions: Object.fromEntries(
        (input.initial_attributes ?? []).map((a: any) => [a.template_id, a.template_version]),
      ),
    };
    await save(obj);
  } else if (name === 'split_item') {
    const before = await load(c, ctx, { kind: 'ITEM', id: input.source_item_id });
    checkRevision(before);
    const plan = await prepareSplit(c, ctx.household_id, before, input);
    const obj = structuredClone(before);
    obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
    obj.sets.contents.remaining.value = '0';
    await save(obj, before);
    result.children = [];
    for (let i = 0; i < input.count; i++) {
      const childId = 'item_' + randomUUID();
      await save({
        kind: 'ITEM',
        row: {
          id: childId,
          catalog_node_id: input.target_catalog_node_id,
          parent_id: before.row.parent_id,
        },
        sets: initialSets(input.child_attributes),
        versions: Object.fromEntries(
          (input.child_attributes ?? []).map((a: any) => [a.template_id, a.template_version]),
        ),
      });
      await query(
        c,
        `INSERT INTO item_splits(household_id,split_id,source_item_id,child_item_id,operation_id,quantity,unit,basis) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          ctx.household_id,
          plan.split_id,
          before.row.id,
          childId,
          operation_id,
          plan.quantity,
          plan.unit,
          plan.basis,
        ],
      );
      result.children.push({ item_id: childId, revision: 1 });
    }
    result.split = await splitInfo(c, ctx.household_id, before.row.id);
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
        case 'void_item':
        case 'void_catalog_node':
          await assertVoidable(c, ctx.household_id, obj);
          obj.row.record_state = 'VOID';
          obj.row.voided_at = new Date().toISOString();
          break;
        case 'dispose_item':
          requireFact(
            !terminal.has(obj.sets.lifecycle?.state),
            'STATE_CONFLICT',
            'Only a non-terminal item can be disposed.',
          );
          obj.sets.disposition = input.disposition;
          obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'DISPOSED' };
          break;
        case 'add_deadline':
        case 'update_deadline':
        case 'remove_deadline':
        case 'complete_deadline': {
          const entries = obj.sets.deadline?.entries ?? [];
          if (name === 'add_deadline') {
            entries.push({ ...input.entry, id: 'deadline_' + randomUUID() });
            obj.sets.deadline = { entries };
          } else {
            const entry = entries.find((entry: any) => entry.id === input.entry_id);
            requireFact(entry, 'NOT_FOUND', 'Deadline not found on this item.');
            if (name === 'remove_deadline') {
              obj.sets.deadline = {
                entries: entries.filter((entry: any) => entry.id !== input.entry_id),
              };
            } else if (name === 'update_deadline') {
              Object.assign(entry, input.patch);
            } else {
              requireFact(
                entry.recurrence_days ||
                  !entry.last_completed_on ||
                  entry.last_completed_on === input.completed_on,
                'INVALID_TRANSITION',
                'One-off deadline is already completed.',
              );
              if (entry.last_completed_on === input.completed_on) break;
              entry.last_completed_on = input.completed_on;
              if (entry.recurrence_days)
                entry.due_on = advanceDeadline(input.completed_on, entry.recurrence_days);
              if (entry.kind === 'SERVICE_DUE')
                obj.sets.service = { ...obj.sets.service, last_service_on: input.completed_on };
            }
          }
          // Existing households predate these templates; seed missing definitions without rewriting registrations.
          for (const template of [
            'deadline',
            ...(obj.sets.service ? ['service'] : []),
          ] as TemplateId[])
            await query(
              c,
              `INSERT INTO attribute_templates(household_id,id,version,target_kind,definition)
              VALUES($1,$2,1,'ITEM',$3::jsonb) ON CONFLICT DO NOTHING`,
              [ctx.household_id, template, JSON.stringify(templateDefinition(template))],
            );
          break;
        }
        case 'update_catalog_node':
          for (const field of ['name', 'profile', 'capabilities', 'one_off'])
            if (Object.hasOwn(input, field)) obj.row[field] = input[field];
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
          if (input.record_state === 'VALID') {
            obj.row.record_state = 'VALID';
            obj.row.voided_at = null;
          }
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
        case 'edit_item': {
          if (name === 'edit_item') {
            if (input.display_name !== undefined) obj.row.display_name = input.display_name;
            const set: Record<string, unknown> = {},
              unset: string[] = [];
            for (const [field, path] of [
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
          const note = await mutateNote(c, ctx, { kind: obj.kind, id: obj.row.id }, input.note);
          await save(obj, before, note.left, note.right);
          result.note_id = note.row.id;
          result.note = noteSummary(note.row);
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

async function readStock(c: Client, ctx: Context, input: any) {
  const { expected, cursor } = queryCursorContext(ctx, 'query_stock', {
    ...input,
    sort: { field: 'name', direction: 'asc' },
  });
  if (cursor)
    requireFact(
      cursor.last.id.startsWith('catalog_node_'),
      'INVALID_CURSOR',
      'Invalid stock cursor.',
    );
  const params: any[] = [ctx.household_id];
  const where = [
    'n.household_id=$1',
    "n.kind='SKU'",
    "n.record_state='VALID'",
    "EXISTS(SELECT 1 FROM jsonb_array_elements(n.attributes) a WHERE a->>'template_id'='stock')",
  ];
  const bind = (v: any) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (input.catalog_node_ids) where.push(`n.id=ANY(${bind(input.catalog_node_ids)}::text[])`);
  if (input.catalog_subtree_id) {
    await load(c, ctx, { kind: 'CATALOG_NODE', id: input.catalog_subtree_id });
    where.push(
      `n.id IN (WITH RECURSIVE scope AS (SELECT id FROM catalog_nodes WHERE household_id=$1 AND id=${bind(input.catalog_subtree_id)} UNION SELECT n.id FROM catalog_nodes n JOIN scope s ON n.parent_id=s.id WHERE n.household_id=$1) SELECT id FROM scope)`,
    );
  }
  const catalog = (
    await query(
      c,
      `SELECT n.* FROM catalog_nodes n WHERE ${where.join(' AND ')} ORDER BY n.id`,
      params,
    )
  ).rows;
  let location = '';
  if (input.within_item_id) {
    await load(c, ctx, { kind: 'ITEM', id: input.within_item_id });
    location = `AND i.id IN (WITH RECURSIVE scope AS (SELECT id FROM items WHERE household_id=$1 AND id=$3 UNION SELECT i.id FROM items i JOIN scope s ON i.parent_id=s.id WHERE i.household_id=$1) SELECT id FROM scope)`;
  }
  const items = (
    await query(
      c,
      `SELECT i.* FROM items i WHERE i.household_id=$1 AND i.catalog_node_id=ANY($2::text[]) ${location}`,
      [ctx.household_id, catalog.map((n) => n.id), ...(location ? [input.within_item_id] : [])],
    )
  ).rows;
  const data = catalog
    .map((n) =>
      stockStatus(
        n,
        items.filter((i) => i.catalog_node_id === n.id),
      ),
    )
    .filter((s) => !input.low_only || s.low === true);
  const watermark = String(await currentChangeId(c, ctx.household_id));
  const remaining = data.filter((s) => !cursor || s.catalog_node_id > cursor.last.id);
  const selected = remaining.slice(0, input.limit);
  return {
    data: selected,
    matching_count: data.length,
    as_of_change_id: cursor?.as_of_change_id ?? watermark,
    stale: !!cursor && cursor.as_of_change_id !== watermark,
    next_cursor:
      remaining.length > input.limit
        ? encodeQueryCursor({
            version: 1,
            ...expected,
            last: { key: selected.at(-1)!.catalog_node_id, id: selected.at(-1)!.catalog_node_id },
            as_of_change_id: cursor?.as_of_change_id ?? watermark,
          })
        : null,
  };
}

function originalQuantityInputs(input: any, path = ''): any[] {
  if (!input || typeof input !== 'object') return [];
  if (typeof input.value === 'string' && typeof input.unit === 'string')
    return [{ path, value: input.value, unit: input.unit }];
  const stock = input.content_unit
    ? ['reorder_threshold', 'target']
        .filter((key) => input[key] !== undefined)
        .map((key) => ({ path: `${path}.${key}`, value: input[key], unit: input.content_unit }))
    : [];
  return [
    ...stock,
    ...Object.entries(input).flatMap(([key, value]) =>
      originalQuantityInputs(value, path ? `${path}.${key}` : key),
    ),
  ];
}

// Never expose PostgreSQL detail (it can contain user data). Unknown SQL failures
// retain their original cause and uncertain-outcome recovery behavior.
export function mapDatabaseError(error: any): any {
  if (error instanceof DomainError) return error;
  const pg = error?.cause?.code ? error.cause : error;
  if (!['23505', '23503', '23514'].includes(pg?.code)) return error;
  const named: Record<string, string> = {
    barcode_index_pkey: 'BARCODE_CONFLICT',
    operations_pkey: 'IDEMPOTENCY_CONFLICT',
    operations_household_operation_unique: 'IDEMPOTENCY_CONFLICT',
    catalog_identity_keys_pkey: 'CLASSIFICATION_CONFLICT',
    catalog_policy_versions_pkey: 'POLICY_CONFLICT',
    events_target_guard: 'REFERENCE_INVALID',
    notes_target_guard: 'REFERENCE_INVALID',
    attachments_target_guard: 'REFERENCE_INVALID',
    uploads_target_guard: 'REFERENCE_INVALID',
    attribute_references_guard: 'REFERENCE_INVALID',
    item_splits_guard: 'STATE_CONFLICT',
    immutable_events: 'STATE_CONFLICT',
    immutable_item_splits: 'STATE_CONFLICT',
    events_source_check: 'ATTRIBUTE_VALIDATION_FAILED',
    events_event_type_check: 'ATTRIBUTE_VALIDATION_FAILED',
    attachment_blobs_file_size_check: 'ATTACHMENT_TOO_LARGE',
    upload_sessions_file_size_check: 'ATTACHMENT_TOO_LARGE',
    attachment_blobs_mime_type_check: 'ATTACHMENT_TYPE_UNSUPPORTED',
    items_household_id_parent_id_fkey: 'INVALID_PARENT',
    catalog_nodes_household_id_parent_id_fkey: 'INVALID_PARENT',
  };
  // Older tree guards predate PostgreSQL CONSTRAINT diagnostics; their stable
  // message prefix is the trigger's public identifier, never the full message.
  const legacy: Record<string, string> = {
    TREE_ITEM_SKU: 'REFERENCE_INVALID',
    TREE_ITEM_PARENT: 'INVALID_PARENT',
    TREE_CATALOG_PARENT: 'INVALID_PARENT',
    TREE_ITEM_CYCLE: 'CYCLE_DETECTED',
    TREE_CATALOG_CYCLE: 'CYCLE_DETECTED',
    TREE_ITEM_SELF_PARENT: 'CYCLE_DETECTED',
    TREE_CATALOG_SELF_PARENT: 'CYCLE_DETECTED',
    TREE_IMMUTABLE_IDENTITY: 'STATE_CONFLICT',
    TREE_CONTAINER_IN_USE: 'STATE_CONFLICT',
    TREE_SKU_IN_USE: 'STATE_CONFLICT',
    TREE_SKU_CHILDREN: 'STATE_CONFLICT',
  };
  const code =
    named[pg.constraint] ??
    legacy[String(pg.message).split(':')[0]] ??
    (pg.code === '23503'
      ? 'REFERENCE_INVALID'
      : pg.code === '23505'
        ? 'STATE_CONFLICT'
        : 'ATTRIBUTE_VALIDATION_FAILED');
  return new DomainError(code, 'Database integrity check rejected the request.');
}
