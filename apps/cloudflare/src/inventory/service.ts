import { executeExport, exportOperations } from './exports.js';
import {
  implementedFeatures,
  eventTypes as registeredEventTypes,
} from '../../../../packages/contracts/src/index.js';
import { maintainReferences, reverseReferences } from './references.js';
import {
  splitInfo,
  assertVoidable,
  assertNoSplitRestore,
  prepareSplit,
  stockStatus,
} from './semantics.js';
import { derivedAvailability } from '../../../../packages/contracts/src/semantics.js';
import { rebuildIdentityIndex } from './intake.js';
import { fileOperations, type fileSchemas } from '../../../../packages/contracts/src/notes.js';
import { executeFiles, listNotes, mutateNote, noteSummary, noteRow } from './notes.js';
import { attachmentRead } from './attachments.js';
import {
  findTemplate,
  canUpgrade,
  resolveCapabilities,
  pathCapability,
} from '../../../../packages/contracts/src/registry.js';
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
} from '../../../../packages/contracts/src/index.js';
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
} from '../../../../packages/domain/src/index.js';
import { query, transaction, type Client, requireTransaction, utcTimestamp } from './db.js';
import { recomputeItemDates, itemDates, dateView, advanceDeadline } from './dates.js';
import { recordSyncChange } from './sync.js';
import { publishSyncTombstone } from './sync-api.js';
import { projectLabels } from './label-projection.js';
import { inventoryGroupsV2 } from './web.js';
import { timed, traces } from './telemetry.js';
export type Context = {
  db: Client;
  user_id: string;
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
export function load(c: Client, ctx: Context, t: Target): ObjectState {
  const row = query(c, `SELECT * FROM ${table(t.kind)} WHERE household_id=?1 AND id=?2`, [
    ctx.household_id,
    t.id,
  ]).rows[0];
  requireFact(row, 'NOT_FOUND', 'Object not found in this household.');
  const obj: ObjectState = {
    kind: t.kind,
    row,
    sets: {},
    raw_bindings: Object.fromEntries(
      row.attributes.map((a: any, i: number) => [
        a.template_id,
        query(c, 'SELECT value FROM json_each(?1) WHERE key=?2', [
          query(c, `SELECT attributes AS raw FROM ${table(t.kind)} WHERE id=?1`, [t.id]).rows[0]
            .raw,
          i,
        ]).rows[0].value,
      ]),
    ),
    versions: Object.fromEntries(
      row.attributes.map((a: any) => [a.template_id, a.template_version]),
    ),
  };
  delete row.__raw_bindings;
  obj.binding_statuses = Object.fromEntries(bindingStatuses(c, ctx.household_id));
  validateBindings(c, ctx, obj, row.attributes);
  obj.sets = Object.fromEntries(row.attributes.map((a: any) => [a.template_id, a.values]));
  const catalog =
    t.kind === 'CATALOG_NODE'
      ? row
      : query(c, 'SELECT profile,capabilities FROM catalog_nodes WHERE household_id=?1 AND id=?2', [
          ctx.household_id,
          row.catalog_node_id,
        ]).rows[0];
  row.effective_capabilities = resolveCapabilities(
    catalog?.profile ?? null,
    catalog?.capabilities ?? null,
  );
  return obj;
}
function validateBindings(c: Client, ctx: Context, obj: ObjectState, bindings: any[]) {
  requireFact(
    Array.isArray(bindings),
    'ATTRIBUTE_VALIDATION_FAILED',
    'Attributes must be an array.',
  );
  const seen = new Set<string>();
  const statuses = bindingStatuses(c, ctx.household_id);
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
function validate(
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
    assertNoSplitRestore(c, ctx.household_id, obj.row.id);
  if (
    obj.kind === 'CATALOG_NODE' &&
    obj.row.kind === 'GROUP' &&
    (!before || before.row.name !== obj.row.name || before.row.parent_id !== obj.row.parent_id)
  ) {
    const duplicate = query(
      c,
      `SELECT name FROM catalog_nodes WHERE household_id=?1 AND kind='GROUP' AND record_state='VALID' AND parent_id IS ?2 AND id<>?3`,
      [ctx.household_id, obj.row.parent_id, obj.row.id],
    );
    requireFact(
      !duplicate.rows.some(
        (r) => normalizeQuerySearch(r.name) === normalizeQuerySearch(obj.row.name),
      ),
      'STATE_CONFLICT',
      'Sibling GROUP names must be distinct.',
    );
  }
  requireFact(
    Object.keys(obj.sets).length <= 16,
    'ATTRIBUTE_VALIDATION_FAILED',
    'At most 16 template bindings are allowed.',
  );
  const statuses = bindingStatuses(c, ctx.household_id);
  const catalog =
    obj.kind === 'CATALOG_NODE'
      ? obj.row
      : query(c, 'SELECT profile,capabilities FROM catalog_nodes WHERE household_id=?1 AND id=?2', [
          ctx.household_id,
          obj.row.catalog_node_id,
        ]).rows[0];
  const capabilities = resolveCapabilities(catalog?.profile ?? null, catalog?.capabilities ?? null);
  const configured = catalog?.profile != null || catalog?.capabilities != null;
  for (const [name, value] of Object.entries(obj.sets)) {
    const unchanged =
      before &&
      Object.hasOwn(before.sets, name) &&
      versionOf(before, name) === versionOf(obj, name) &&
      canonical(before.sets[name]) === canonical(value);
    if (unchanged) continue;
    const t = assertWritableTemplate(c, ctx.household_id, name, versionOf(obj, name));
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
    if (
      !Object.keys(obj.sets[name]).length &&
      !(name === 'lifecycle' && versionOf(obj, name) === 2)
    )
      delete obj.sets[name];
  }
  if (obj.kind === 'ITEM') {
    const catalog = load(c, ctx, { kind: 'CATALOG_NODE', id: obj.row.catalog_node_id });
    requireFact(
      catalog.row.kind === 'SKU' && catalog.row.record_state !== 'VOID',
      'ATTRIBUTE_VALIDATION_FAILED',
      'Item requires a SKU.',
    );
    if (obj.sets.container?.can_contain !== true) {
      const children = query(
        c,
        'SELECT 1 FROM items WHERE household_id=?1 AND parent_id=?2 LIMIT 1',
        [ctx.household_id, obj.row.id],
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
      assertWritableTemplate(c, ctx.household_id, 'lifecycle', versionOf(obj, 'lifecycle'));
      obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
    }
  }
  if (obj.row.parent_id) {
    const parent = load(c, ctx, { kind: obj.kind, id: obj.row.parent_id } as Target);
    requireFact(
      parent.row.record_state !== 'VOID' &&
        (obj.kind === 'ITEM'
          ? parent.sets.container?.can_contain === true
          : parent.row.kind === 'GROUP'),
      'INVALID_PARENT',
      'Parent must be a GROUP or capable container.',
    );
    const ancestors = query(
      c,
      `WITH RECURSIVE a AS (SELECT id,parent_id FROM ${table(obj.kind)} WHERE household_id=?1 AND id=?2 UNION SELECT n.id,n.parent_id FROM ${table(obj.kind)} n JOIN a ON n.id=a.parent_id WHERE n.household_id=?1) SELECT id FROM a`,
      [ctx.household_id, obj.row.parent_id],
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
      const existing = query(
        c,
        'SELECT catalog_node_id FROM barcode_index WHERE household_id=?1 AND barcode=?2',
        [ctx.household_id, barcode],
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
      (name === 'lifecycle' && to === 2) ||
        Object.keys(prune(structuredClone(obj.sets[name]))).length,
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
export function execute(ctx: Context, name: Operation, raw: unknown): any {
  try {
    return timed('business_ms', () => {
      const result = fileOperations.has(name)
        ? executeFiles(ctx, name as keyof typeof fileSchemas, raw)
        : executeCommand(ctx, name, raw);
      const trace = traces.getStore();
      if (trace) trace.outcome = 'SUCCESS';
      return result;
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}
export function assertWriteIsolation(c: Client): void {
  requireTransaction(c);
}
function executeCommand(ctx: Context, name: Operation, raw: unknown): any {
  if (exportOperations.has(name)) return executeExport(ctx, name, raw, readQuery);
  const trace = traces.getStore();
  if (trace) trace.tool = name;
  const input = parseCommand(name, raw);
  if (trace) {
    trace.tool = name;
    trace.batch_size = input.items?.length ?? input.item_ids?.length ?? input.count ?? 1;
  }
  try {
    return transaction(ctx.db, (c) => {
      requireFact(
        query(c, 'SELECT 1 FROM actors WHERE household_id=?1 AND id=?2', [
          ctx.household_id,
          ctx.actor_id,
        ]).rows.length,
        'FORBIDDEN',
        'Invalid household context.',
      );
      if (reads.has(name))
        return intakeReads.has(name) ? readIntake(c, ctx, name, input) : read(c, ctx, name, input);
      // Household writes are deliberately serialized for Stage1: one lock order also protects tree/capability races.
      assertWriteIsolation(c);
      const fingerprint = createHash('sha256').update(canonical({ name, input })).digest('hex');
      const old = query(
        c,
        'SELECT * FROM operations WHERE household_id=?1 AND actor_id=?2 AND idempotency_key=?3',
        [ctx.household_id, ctx.actor_id, input.idempotency_key],
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
          return { ...old.result, note: noteSummary(noteRow(c, ctx, old.result.note_id)) };
        return old.result;
      }
      const operation_id = 'operation_' + randomUUID();
      if (trace) trace.operation_id = operation_id;
      let result: any;
      if (name === 'propose_catalog_change')
        result = proposeCatalogChange(c, ctx, input, operation_id);
      else if (name === 'commit_intake')
        result = commitIntake(c, ctx, input, operation_id, applyDomainCommand);
      else {
        authorizeCatalogCommand(c, ctx, name, input, operation_id);
        result = applyDomainCommand(c, ctx, name, input, operation_id);
      }
      c.saveOperation(ctx.household_id, ctx.actor_id, input.idempotency_key, fingerprint, result);
      return result;
    });
  } catch (e: any) {
    throw mapDatabaseError(e);
  }
}
function bindingRecords(c: Client, ctx: Context, obj: ObjectState) {
  const statuses = bindingStatuses(c, ctx.household_id);
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

function view(c: Client, ctx: Context, obj: ObjectState, includePath = false) {
  const path = includePath
    ? query(
        c,
        `WITH RECURSIVE a AS (SELECT id,parent_id,0 AS depth FROM ${table(obj.kind)} WHERE household_id=?1 AND id=?2 UNION ALL SELECT n.id,n.parent_id,a.depth+1 FROM ${table(obj.kind)} n JOIN a ON n.id=a.parent_id WHERE n.household_id=?1) SELECT a.id FROM a ORDER BY depth DESC`,
        [ctx.household_id, obj.row.id],
      ).rows.map((r) => r.id)
    : undefined;
  const row: any = {
    ...obj.row,
    ...(includePath ? { path_ids: path } : {}),
    attributes: bindingRecords(c, ctx, obj),
  };
  if (obj.kind === 'ITEM') {
    row.split = splitInfo(c, ctx.household_id, obj.row.id);
    row.derived_availability = derivedAvailability(obj.sets);
    row.catalog_name = query(c, 'SELECT name FROM catalog_nodes WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      obj.row.catalog_node_id,
    ]).rows[0].name;
    const target = { kind: 'ITEM' as const, id: obj.row.id };
    row.notes = listNotes(c, ctx, { target, limit: 200 }).data;
    row.attachments = attachmentRead(c, ctx, { target, limit: 200 }).data;
    const dates = itemDates(c, ctx.household_id, obj.row.id, obj.row.attributes);
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
function compareRows(a: any, b: any, direction: string): number {
  // Null keys are last in either direction. Code-point comparisons match database C collation.
  if (a.__key === null || b.__key === null) {
    if (a.__key !== b.__key) return a.__key === null ? 1 : -1;
  } else if (a.__key !== b.__key)
    return (a.__key < b.__key ? -1 : 1) * (direction === 'asc' ? 1 : -1);
  return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * (direction === 'asc' ? 1 : -1);
}
function readHistory(c: Client, ctx: Context, input: any) {
  const { expected, cursor } = queryCursorContext(ctx, 'get_history', input);
  if (cursor)
    requireFact(cursor.last.id.startsWith('event_'), 'INVALID_CURSOR', 'Invalid history cursor.');
  if (input.target) load(c, ctx, input.target);
  const params: unknown[] = [ctx.household_id],
    where = ['household_id=?1'];
  const bind = (value: unknown) => {
    params.push(value);
    return `?${params.length}`;
  };
  if (input.target)
    where.push(`target_kind=${bind(input.target.kind)} AND target_id=${bind(input.target.id)}`);
  if (input.operation_id) where.push(`operation_id=${bind(input.operation_id)}`);
  if (input.event_type) where.push(`event_type=${bind(input.event_type)}`);
  if (input.recorded_from) where.push(`recorded_at >= ${bind(utcTimestamp(input.recorded_from))}`);
  if (input.recorded_to) where.push(`recorded_at <= ${bind(utcTimestamp(input.recorded_to))}`);
  if (cursor)
    where.push(
      `(recorded_at,id)<(${bind(utcTimestamp(cursor.last.key!))},${bind(cursor.last.id)})`,
    );
  const rows = query(
    c,
    `SELECT *,recorded_at AS __key FROM events WHERE ${where.join(' AND ')} ORDER BY recorded_at DESC,id DESC LIMIT ${bind(input.limit + 1)}`,
    params,
  ).rows;
  const watermark = currentChangeId(c, ctx.household_id);
  return {
    ...queryPage(rows, input, expected, cursor, watermark),
    summary: { as_of_change_id: watermark },
  };
}
function scopeIds(rows: any[], id: string | undefined): Set<string> | undefined {
  if (!id) return;
  requireFact(
    rows.some((row) => row.id === id),
    'NOT_FOUND',
    'Scope not found in this household.',
  );
  const children = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = children.get(row.parent_id) ?? [];
    bucket.push(row.id);
    children.set(row.parent_id, bucket);
  }
  const found = new Set<string>(),
    pending = [id];
  for (let index = 0; index < pending.length; index++) {
    const next = pending[index];
    if (found.has(next)) continue;
    found.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return found;
}
function readQuery(c: Client, ctx: Context, name: Operation, input: any): any {
  const isGroups = name === 'query_inventory_groups';
  if (isGroups) input = { ...input, sort: { field: 'name', direction: 'asc' } };
  const isItem = name === 'query_items' || isGroups,
    kind = isItem ? 'ITEM' : 'CATALOG_NODE';
  const { expected, cursor } = queryCursorContext(ctx, name, input);
  if (cursor)
    requireFact(
      cursor.last.id.startsWith(isItem && !isGroups ? 'item_' : 'catalog_node_'),
      'INVALID_CURSOR',
      'Invalid object cursor.',
    );
  const catalog = query(c, 'SELECT * FROM catalog_nodes WHERE household_id=?1', [
    ctx.household_id,
  ]).rows;
  const items =
    isItem || input.within_item_id
      ? query(c, 'SELECT * FROM items WHERE household_id=?1', [ctx.household_id]).rows
      : [];
  const bySku = new Map(catalog.map((row) => [row.id, row]));
  const catalogScope = scopeIds(catalog, input.catalog_subtree_id),
    itemScope = scopeIds(items, input.within_item_id);
  const barcodes = input.barcode
    ? new Set(
        query(c, 'SELECT catalog_node_id FROM barcode_index WHERE household_id=?1 AND barcode=?2', [
          ctx.household_id,
          input.barcode,
        ]).rows.map((r) => r.catalog_node_id),
      )
    : undefined;
  const noteBodies = new Map<string, string[]>();
  if (isItem && (input.name || input.search))
    for (const note of query(
      c,
      "SELECT target_id,body FROM notes WHERE household_id=?1 AND target_kind='ITEM'",
      [ctx.household_id],
    ).rows) {
      const bucket = noteBodies.get(note.target_id) ?? [];
      bucket.push(note.body);
      noteBodies.set(note.target_id, bucket);
    }
  // Validate filters before selecting records, including an empty household.
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
    const value = patch({}, { [f.path]: f.value }, [], [...t.paths]);
    if (f.template_id === 'disposition' || f.template_id === 'stock')
      requireFact(
        t.schema.partial().safeParse(value).success,
        'ATTRIBUTE_VALIDATION_FAILED',
        'Invalid filter value.',
      );
    else validateValues(f.template_id, value, latestTemplateVersion(f.template_id));
  }
  const matching = (isItem ? items : catalog).filter((row) => {
    const sku = isItem ? bySku.get(row.catalog_node_id) : row;
    requireFact(sku, 'STATE_CONFLICT', 'Catalog relationship is missing.');
    const sets = Object.fromEntries(row.attributes.map((a: any) => [a.template_id, a.values]));
    if (!input.include_void && row.record_state !== 'VALID') return false;
    if (!isItem && !input.include_one_off && row.one_off) return false;
    if (isItem && !input.include_terminal && terminal.has(sets.lifecycle?.state)) return false;
    if (input.profile && sku.profile !== input.profile) return false;
    if (
      input.capabilities?.some(
        (cap: any) => !resolveCapabilities(sku.profile, sku.capabilities).includes(cap),
      )
    )
      return false;
    const catalogId = isItem ? row.catalog_node_id : row.id;
    if ((catalogScope && !catalogScope.has(catalogId)) || (itemScope && !itemScope.has(row.id)))
      return false;
    if (input.catalog_node_ids && !input.catalog_node_ids.includes(catalogId)) return false;
    if (input.kind && row.kind !== input.kind) return false;
    if (barcodes && !barcodes.has(catalogId)) return false;
    if (!isItem && !input.include_hidden && sets.catalog?.visibility === 'HIDDEN') return false;
    for (const f of input.attribute_filters ?? []) {
      const value = getPath(sets[f.template_id], f.path);
      if (value === undefined) return false;
      if (
        f.op === 'eq'
          ? canonical(value) !== canonical(f.value)
          : f.op === 'gte'
            ? value < f.value
            : value > f.value
      )
        return false;
    }
    const product = sku.attributes.find((a: any) => a.template_id === 'product')?.values ?? {};
    const fields = [
      isItem ? row.display_name : row.name,
      row.id,
      ...(isItem ? [sku.name, sku.id] : []),
      product.specification,
      product.brand,
      product.model,
      ...(product.barcodes ?? []),
      ...(noteBodies.get(row.id) ?? []),
    ]
      .filter((x) => typeof x === 'string')
      .map(normalizeQuerySearch);
    for (const term of [input.name, input.search])
      if (
        term &&
        normalizeQuerySearch(term) &&
        !fields.some((v) => v.includes(normalizeQuerySearch(term)))
      )
        return false;
    row.__sets = sets;
    if (isItem) {
      row.catalog_name = sku.name;
      row.__profile = sku.profile;
      row.__capabilities = sku.capabilities;
      row.__dates = itemDates(c, ctx.household_id, row.id, row.attributes);
      for (const f of input.date_filters ?? [])
        if (
          !row.__dates.some(
            (d: any) =>
              (!f.kind || d.kind === f.kind) &&
              (!f.source ||
                d.source_template === (f.source === 'DEADLINE' ? 'deadline' : 'lifecycle')) &&
              (!f.from || d.due_on >= f.from) &&
              (!f.to || d.due_on <= f.to) &&
              (!f.state || d.state === f.state),
          )
        )
          return false;
    }
    row.__key =
      input.sort.field === 'name'
        ? normalizeQuerySearch(isItem ? (row.display_name ?? sku.name) : row.name)
        : input.sort.field === 'reminder_date'
          ? ((row.__dates ?? [])
              .filter((d: any) => !d.completed_on)
              .map((d: any) => d.due_on)
              .sort()[0] ?? null)
          : row[input.sort.field];
    return true;
  });
  const watermark = currentChangeId(c, ctx.household_id);
  if (isGroups) {
    const groups = inventoryGroupsV2(matching, catalog),
      remaining = groups.filter((g) => !cursor || g.id > cursor.last.id),
      page = remaining.slice(0, input.limit);
    return {
      groups: page,
      matching_group_count: groups.length,
      as_of_change_id: watermark,
      stale: !!cursor && cursor.as_of_change_id !== watermark,
      next_cursor:
        remaining.length > input.limit
          ? encodeQueryCursor({
              version: 1,
              ...expected,
              last: { key: page.at(-1)!.id, id: page.at(-1)!.id },
              as_of_change_id: cursor?.as_of_change_id ?? watermark,
            })
          : null,
    };
  }
  const summary: any = { matching_count: matching.length };
  if (isItem) {
    const current = matching.filter(
      (r) => r.record_state === 'VALID' && !terminal.has(r.__sets.lifecycle?.state),
    );
    const by_unit: Record<string, any> = {};
    let unknown = 0,
      percent = 0;
    for (const row of current) {
      const content = row.__sets.contents,
        q = content?.remaining;
      if (!q) {
        unknown++;
        continue;
      }
      if (q.unit === 'percent') {
        percent++;
        continue;
      }
      const total = (by_unit[q.unit] ??= {
        value: '0',
        measured_count: 0,
        estimated_count: 0,
        unknown_accuracy_count: 0,
      });
      total.value = new Decimal(total.value).plus(q.value).toFixed();
      total[
        content.accuracy === 'MEASURED'
          ? 'measured_count'
          : content.accuracy === 'ESTIMATED'
            ? 'estimated_count'
            : 'unknown_accuracy_count'
      ]++;
    }
    Object.assign(summary, {
      current_count: current.length,
      unknown_lifecycle_count: current.filter((r) => !r.__sets.lifecycle?.state).length,
      content_totals: {
        by_unit,
        unknown_quantity_count: unknown,
        unconvertible_percentage_count: percent,
      },
    });
  }
  matching.sort((a, b) => compareRows(a, b, input.sort.direction));
  const last = cursor
    ? {
        id: cursor.last.id,
        __key:
          ['created_at', 'updated_at'].includes(input.sort.field) && cursor.last.key
            ? utcTimestamp(cursor.last.key)
            : cursor.last.key,
      }
    : undefined;
  const page = matching
    .filter((row) => !last || compareRows(row, last, input.sort.direction) > 0)
    .slice(0, input.limit + 1);
  const byId = new Map((isItem ? items : catalog).map((row) => [row.id, row]));
  for (const row of page) {
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
    if (input.include_path) {
      const ids: string[] = [],
        seen = new Set<string>();
      let node: any = row;
      while (node && !seen.has(node.id)) {
        ids.unshift(node.id);
        seen.add(node.id);
        node = byId.get(node.parent_id);
      }
      row.path_ids = ids;
    }
    if (isItem) {
      row.split = splitInfo(c, ctx.household_id, row.id);
      row.derived_availability = derivedAvailability(row.__sets);
      Object.assign(row, dateView(row.__dates, row.attributes));
    }
    delete row.__sets;
    delete row.__profile;
    delete row.__capabilities;
    delete row.__dates;
  }
  return {
    ...queryPage(page, input, expected, cursor, watermark),
    ...summary,
    summary: { ...summary, as_of_change_id: watermark },
  };
}

function read(c: Client, ctx: Context, name: Operation, input: any): any {
  if (name === 'get_connection_context') {
    const household = query(c, 'SELECT id,name,timezone FROM households WHERE id=?1', [
      ctx.household_id,
    ]).rows[0];
    const actor = query(c, 'SELECT id,name FROM actors WHERE household_id=?1 AND id=?2', [
      ctx.household_id,
      ctx.actor_id,
    ]).rows[0];
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
      ? load(c, ctx, { kind: 'CATALOG_NODE', id: input.catalog_node_id })
      : undefined;
    const filtered = catalog !== undefined || input.profile !== undefined;
    const capabilities = resolveCapabilities(
      input.profile !== undefined ? input.profile : (catalog?.row.profile ?? null),
      catalog?.row.capabilities ?? null,
    );
    const statuses = bindingStatuses(c, ctx.household_id);
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
    return { data: reverseReferences(c, ctx.household_id, input.target) };
  }
  if (name === 'query_stock') return readStock(c, ctx, input);
  if (name === 'get_history') return readHistory(c, ctx, input);
  if (name === 'get_item' || name === 'get_catalog_node')
    return view(
      c,
      ctx,
      load(c, ctx, {
        kind: name === 'get_item' ? 'ITEM' : 'CATALOG_NODE',
        id: input.item_id ?? input.catalog_node_id,
      } as Target),
      input.include_path,
    );
  return readQuery(c, ctx, name, input);
}

// Transaction-scoped primitive: caller owns authorization, lock, idempotency and commit.
function applyDomainCommand(
  c: Client,
  ctx: Context,
  name: Operation,
  input: any,
  operation_id: string,
): any {
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
  const save = (
    obj: ObjectState,
    before?: ObjectState,
    extraBefore: Record<string, any> = {},
    extraAfter: Record<string, any> = {},
  ) => {
    validate(c, ctx, obj, before, name === 'correct_item', name);
    const delta = changes(
      { ...(before ? flatten(before) : {}), ...extraBefore },
      { ...flatten(obj), ...extraAfter },
    );
    if (!delta.length && before) return;
    const rev = before?.row.revision ?? 0;
    const now = query(c, 'SELECT now AS time FROM cf_clock').rows[0].time;
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
    validateBindings(c, ctx, obj, attributes);
    // Reuse SQLite's raw JSON text for unchanged bindings. JSON.parse/stringify alone would
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
        query(
          c,
          'INSERT INTO items(id,household_id,catalog_node_id,parent_id,display_name,attributes) VALUES(?1,?2,?3,?4,?5,?6)',
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
        query(
          c,
          'INSERT INTO catalog_nodes(id,household_id,parent_id,kind,name,attributes,profile,capabilities,one_off) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)',
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
      query(
        c,
        'UPDATE items SET catalog_node_id=?1,parent_id=?2,display_name=?3,attributes=?6,record_state=?7,voided_at=?8,revision=revision+1,updated_at=(SELECT now FROM cf_clock) WHERE household_id=?4 AND id=?5',
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
      query(
        c,
        'UPDATE catalog_nodes SET name=?1,parent_id=?2,attributes=?5,profile=?6,capabilities=?7,one_off=?8,record_state=?9,voided_at=?10,revision=revision+1,updated_at=(SELECT now FROM cf_clock) WHERE household_id=?3 AND id=?4',
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
        query(c, 'DELETE FROM barcode_index WHERE household_id=?1 AND catalog_node_id=?2', [
          ctx.household_id,
          obj.row.id,
        ]);
        for (const barcode of afterBarcodes)
          query(
            c,
            'INSERT INTO barcode_index(household_id,barcode,catalog_node_id) VALUES(?1,?2,?3)',
            [ctx.household_id, barcode, obj.row.id],
          );
      }
    }
    maintainReferences(c, ctx.household_id, obj);
    if (obj.kind === 'CATALOG_NODE') {
      const rebuilt = rebuildIdentityIndex(c, ctx.household_id);
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
    query(
      c,
      'INSERT INTO events(id,household_id,target_kind,target_id,operation_id,event_type,before_revision,after_revision,changes,actor_id,source,occurred_at,reason) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)',
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
      publishSyncTombstone(c, ctx.household_id, obj.kind, obj.row.id, rev + 1, operation_id);
    else recordSyncChange(c, ctx.household_id, obj.kind, obj.row.id, rev + 1, operation_id);
    if (obj.kind === 'ITEM') recomputeItemDates(c, ctx.household_id, obj.row.id);
    projectLabels(c, ctx.household_id, obj.kind, obj.row.id, event_id, operation_id);
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
    save(obj);
  } else if (name === 'split_item') {
    const before = load(c, ctx, { kind: 'ITEM', id: input.source_item_id });
    checkRevision(before);
    const plan = prepareSplit(c, ctx.household_id, before, input);
    const obj = structuredClone(before);
    obj.sets.lifecycle = { ...obj.sets.lifecycle, state: 'CONSUMED' };
    obj.sets.contents.remaining.value = '0';
    save(obj, before);
    result.children = [];
    for (let i = 0; i < input.count; i++) {
      const childId = 'item_' + randomUUID();
      save({
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
      query(
        c,
        `INSERT INTO item_splits(household_id,split_id,source_item_id,child_item_id,operation_id,quantity,unit,basis) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`,
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
    result.split = splitInfo(c, ctx.household_id, before.row.id);
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
          save({
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
          const before = load(c, ctx, { kind: 'ITEM', id: entry.item_id });
          checkRevision(before);
          const obj = structuredClone(before);
          mutateAttributes(obj, { ...entry, template_id: 'lifecycle' }, 'update_attributes');
          save(obj, before);
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
      save({
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
      const before = load(c, ctx, t);
      checkRevision(before);
      const obj = structuredClone(before);
      switch (name) {
        case 'void_item':
        case 'void_catalog_node':
          assertVoidable(c, ctx.household_id, obj);
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
            query(
              c,
              `INSERT INTO attribute_templates(household_id,id,version,target_kind,definition)
              VALUES(?1,?2,1,'ITEM',?3) ON CONFLICT DO NOTHING`,
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
            for (const [field, path] of [['acquired_on', 'acquisition.acquired_on']]) {
              if (input[field] === null) unset.push(path);
              else if (input[field] !== undefined) set[path] = input[field];
            }
            if (Object.keys(set).length || unset.length)
              obj.sets.lifecycle = patch(obj.sets.lifecycle ?? {}, set, unset, [
                ...templates.lifecycle.paths,
              ]);
            if (!input.note) break;
          }
          const note = mutateNote(c, ctx, { kind: obj.kind, id: obj.row.id }, input.note);
          save(obj, before, note.left, note.right);
          result.note_id = note.row.id;
          result.note = noteSummary(note.row);
          continue;
        }
        default:
          throw new DomainError('ATTRIBUTE_VALIDATION_FAILED', 'Unsupported command.');
      }
      save(obj, before);
    }
  }
  result.changed = result.affected_objects.length > 0;
  result.summary = result.changed
    ? `${result.affected_objects.length} object(s) changed; inspect affected_objects and get_history.`
    : 'No changes.';
  return result;
}

function readStock(c: Client, ctx: Context, input: any) {
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
    'n.household_id=?1',
    "n.kind='SKU'",
    "n.record_state='VALID'",
    "EXISTS(SELECT 1 FROM json_each(n.attributes) a WHERE a.value->>'template_id'='stock')",
  ];
  const bind = (v: any) => {
    params.push(v);
    return `?${params.length}`;
  };
  if (input.catalog_node_ids)
    where.push(`n.id IN (SELECT value FROM json_each(${bind(input.catalog_node_ids)}))`);
  if (input.catalog_subtree_id) {
    load(c, ctx, { kind: 'CATALOG_NODE', id: input.catalog_subtree_id });
    where.push(
      `n.id IN (WITH RECURSIVE scope AS (SELECT id FROM catalog_nodes WHERE household_id=?1 AND id=${bind(input.catalog_subtree_id)} UNION SELECT n.id FROM catalog_nodes n JOIN scope s ON n.parent_id=s.id WHERE n.household_id=?1) SELECT id FROM scope)`,
    );
  }
  const catalog = query(
    c,
    `SELECT n.* FROM catalog_nodes n WHERE ${where.join(' AND ')} ORDER BY n.id`,
    params,
  ).rows;
  let location = '';
  if (input.within_item_id) {
    load(c, ctx, { kind: 'ITEM', id: input.within_item_id });
    location = `AND i.id IN (WITH RECURSIVE scope AS (SELECT id FROM items WHERE household_id=?1 AND id=?3 UNION SELECT i.id FROM items i JOIN scope s ON i.parent_id=s.id WHERE i.household_id=?1) SELECT id FROM scope)`;
  }
  const items = query(
    c,
    `SELECT i.* FROM items i WHERE i.household_id=?1 AND i.catalog_node_id IN (SELECT value FROM json_each(?2)) ${location}`,
    [ctx.household_id, catalog.map((n) => n.id), ...(location ? [input.within_item_id] : [])],
  ).rows;
  const data = catalog
    .map((n) =>
      stockStatus(
        n,
        items.filter((i) => i.catalog_node_id === n.id),
      ),
    )
    .filter((s) => !input.low_only || s.low === true);
  const watermark = String(currentChangeId(c, ctx.household_id));
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

// Map stable SQLite constraint categories without exposing row values or SQL text.
export function mapDatabaseError(error: any): any {
  if (error instanceof DomainError) return error;
  const message = String(error?.message ?? '');
  if (!/(?:constraint failed|SQLITE_CONSTRAINT)/i.test(message)) return error;
  let code = 'ATTRIBUTE_VALIDATION_FAILED';
  const guard = message.match(
    /(?:^|: )(STATE_CONFLICT|REFERENCE_INVALID|ATTRIBUTE_VALIDATION_FAILED):/,
  );
  if (guard) return new DomainError(guard[1], 'Database integrity check rejected the request.');
  if (/UNIQUE constraint failed: barcode_index\./.test(message)) code = 'BARCODE_CONFLICT';
  else if (/UNIQUE constraint failed: operations\./.test(message)) code = 'IDEMPOTENCY_CONFLICT';
  else if (/UNIQUE constraint failed: catalog_identity_keys\./.test(message))
    code = 'CLASSIFICATION_CONFLICT';
  else if (/UNIQUE constraint failed: catalog_policy_versions\./.test(message))
    code = 'POLICY_CONFLICT';
  else if (/FOREIGN KEY constraint failed/.test(message)) code = 'REFERENCE_INVALID';
  else if (/UNIQUE constraint failed/.test(message)) code = 'STATE_CONFLICT';
  return new DomainError(code, 'Database integrity check rejected the request.');
}
