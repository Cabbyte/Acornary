import { Decimal } from 'decimal.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  schemas,
  templates,
  templateDefinition,
  latestTemplateVersion,
  validateValues,
  type TemplateId,
  type Operation,
} from '../../../packages/contracts/src/index.js';
import {
  catalogConfirmSchema,
  catalogReviewSchema,
  intakeBodySchema,
  type CatalogRule,
} from '../../../packages/contracts/src/intake.js';
import {
  canonical,
  getPath,
  requireFact,
  DomainError,
} from '../../../packages/domain/src/index.js';
import { query, transaction, type Client } from './db.js';
import type { Context } from './service.js';

export const intakeReads = new Set([
  'get_intake_context',
  'get_intake_receipt',
  'get_catalog_policy',
]);
const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase();
function normalizedFact(value: any): any {
  if (typeof value === 'string') return normalize(value);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizedFact);
  const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizedFact(v)]));
  if (typeof value.value === 'string' && value.unit)
    result.value = new Decimal(value.value).toString();
  return result;
}
function containsFacts(existing: any, supplied: any, path = ''): boolean {
  if (Array.isArray(supplied))
    return path === 'product.barcodes'
      ? supplied.every((v) => existing?.includes(v))
      : canonical(existing ?? null) === canonical(supplied);
  if (
    supplied &&
    typeof supplied === 'object' &&
    Object.hasOwn(supplied, 'value') &&
    Object.hasOwn(supplied, 'unit')
  )
    return canonical(normalizedFact(existing ?? null)) === canonical(normalizedFact(supplied));
  if (supplied && typeof supplied === 'object')
    return Object.entries(supplied).every(([k, v]) =>
      containsFacts(existing?.[k], v, path ? `${path}.${k}` : k),
    );
  return canonical(normalizedFact(existing ?? null)) === canonical(normalizedFact(supplied));
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const sets = (attrs: any[] = []) => Object.fromEntries(attrs.map((a) => [a.template_id, a.values]));
const resultBase = (operation_id: string) => ({
  operation_id,
  changed: false,
  affected_objects: [] as any[],
  event_ids: [] as string[],
  summary: '',
});
function parseInput(schema: { safeParse: (raw: unknown) => any }, raw: unknown): any {
  const result = schema.safeParse(raw);
  requireFact(
    result.success,
    'ATTRIBUTE_VALIDATION_FAILED',
    'Invalid governance input.',
    result.error?.issues,
  );
  return result.data;
}
async function policy(c: Client, ctx: Context) {
  return (
    (
      await query(
        c,
        'SELECT revision,rules,actor_id,created_at,reason FROM catalog_policy_versions WHERE household_id=$1 ORDER BY revision DESC LIMIT 1',
        [ctx.household_id],
      )
    ).rows[0] ?? { revision: 0, rules: [] as CatalogRule[] }
  );
}
async function checkPolicy(c: Client, ctx: Context, revision: number) {
  const p = await policy(c, ctx);
  requireFact(
    p.revision === revision,
    'POLICY_CONFLICT',
    'Classification rules changed. Read context and reconsider the batch.',
    { expected_revision: revision, current_revision: p.revision },
  );
  return p;
}
// One recursive query for all requested objects and their full ancestry. No per-row reads.
async function paths(c: Client, ctx: Context, table: 'catalog_nodes' | 'items', ids: string[]) {
  if (!ids.length) return [];
  return (
    await query(
      c,
      `WITH RECURSIVE ancestry AS (
    SELECT n.*, n.id AS origin, 0 AS depth FROM ${table} n WHERE household_id=$1 AND id=ANY($2::text[])
    UNION ALL SELECT n.*, a.origin,a.depth+1 FROM ${table} n JOIN ancestry a ON a.parent_id=n.id WHERE n.household_id=$1
  ) SELECT to_jsonb(a)-'origin'-'depth' AS object,origin,depth FROM ancestry a ORDER BY origin,depth DESC`,
      [ctx.household_id, ids],
    )
  ).rows;
}
async function dependencies(
  c: Client,
  ctx: Context,
  ids: string[],
  expected: Record<string, number>,
  strict = true,
) {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows = [
    ...(await paths(
      c,
      ctx,
      'catalog_nodes',
      unique.filter((id) => id.startsWith('catalog_node_')),
    )),
    ...(await paths(
      c,
      ctx,
      'items',
      unique.filter((id) => id.startsWith('item_')),
    )),
  ];
  const found = new Set(rows.map((r) => r.object.id));
  for (const id of unique)
    requireFact(found.has(id), 'NOT_FOUND', 'Dependency not found in this household.', { id });
  for (const { object } of rows)
    if (strict || Object.hasOwn(expected, object.id))
      requireFact(
        expected[object.id] === object.revision,
        'REVISION_CONFLICT',
        'Read the changed dependency and reconsider the operation.',
        {
          id: object.id,
          expected_revision: expected[object.id] ?? null,
          current_revision: object.revision,
        },
      );
  return rows;
}
function withPaths(rows: any[], ancestry: any[]) {
  return rows.map((row) => ({
    ...row,
    path: ancestry
      .filter((a) => a.origin === row.id)
      .map((a) => ({
        id: a.object.id,
        name: a.object.name ?? a.object.display_name ?? null,
        revision: a.object.revision,
      })),
  }));
}
export async function readIntake(c: Client, ctx: Context, name: Operation, input: any) {
  if (name === 'get_intake_receipt') {
    const row = (
      await query(
        c,
        `SELECT result FROM operations WHERE household_id=$1 AND ${input.operation_id ? "result->>'operation_id'=$2" : 'actor_id=$3 AND idempotency_key=$2'}`,
        [ctx.household_id, input.operation_id ?? input.idempotency_key, ctx.actor_id],
      )
    ).rows[0];
    requireFact(row?.result?.receipt, 'NOT_FOUND', 'No intake receipt found for this identifier.');
    return row.result;
  }
  const p = await policy(c, ctx);
  if (name === 'get_catalog_policy') {
    const selected =
      input.revision === undefined
        ? p
        : (
            await query(
              c,
              'SELECT revision,rules,actor_id,created_at,reason FROM catalog_policy_versions WHERE household_id=$1 AND revision=$2',
              [ctx.household_id, input.revision],
            )
          ).rows[0];
    requireFact(selected, 'NOT_FOUND', 'Policy version not found.');
    const pending = (
      await query(
        c,
        "SELECT id,proposal,status,created_at FROM catalog_proposals WHERE household_id=$1 AND actor_id=$2 AND status='PENDING' ORDER BY created_at DESC LIMIT 30",
        [ctx.household_id, ctx.actor_id],
      )
    ).rows;
    return {
      ...selected,
      rules: input.branch_id
        ? selected.rules.filter((r: CatalogRule) => r.branch_id === input.branch_id)
        : selected.rules,
      pending_proposals: pending,
      workflow_version: 'intake/1',
    };
  }
  const aliases = p.rules
    .flatMap((r: CatalogRule) => r.aliases)
    .filter((a: any) =>
      [...input.names, ...input.category_names].some((n: string) =>
        normalize(a.name).includes(normalize(n)),
      ),
    );
  const pattern = [...input.names, ...input.category_names].map(
    (n: string) => '%' + normalize(n).replace(/[\\%_]/g, '\\$&') + '%',
  );
  const locationPattern = input.location_names.map(
    (n: string) => '%' + normalize(n).replace(/[\\%_]/g, '\\$&') + '%',
  );
  const catalog = (
    await query(
      c,
      `SELECT n.*, count(*) OVER()::int AS matching_count FROM catalog_nodes n WHERE household_id=$1 AND (id=ANY($2::text[]) OR acornary_normalize_name(name) LIKE ANY($3::text[]) OR id IN (SELECT catalog_node_id FROM barcode_index WHERE household_id=$1 AND barcode=ANY($6::text[]))) ORDER BY id LIMIT $4 OFFSET $5`,
      [
        ctx.household_id,
        [...input.catalog_node_ids, ...aliases.map((a: any) => a.catalog_node_id)],
        pattern,
        input.limit + 1,
        input.cursor,
        input.barcodes,
      ],
    )
  ).rows;
  const locations = (
    await query(
      c,
      `SELECT i.*,coalesce(i.display_name,n.name) AS name,count(*) OVER()::int AS matching_count FROM items i JOIN catalog_nodes n ON n.household_id=i.household_id AND n.id=i.catalog_node_id WHERE i.household_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.attributes) a WHERE a->>'template_id'='container') AND (i.id=ANY($2::text[]) OR acornary_normalize_name(coalesce(i.display_name,n.name)) LIKE ANY($3::text[])) ORDER BY i.id LIMIT $4 OFFSET $5`,
      [ctx.household_id, input.location_ids, locationPattern, input.limit + 1, input.cursor],
    )
  ).rows;
  const catalogRows = catalog.slice(0, input.limit),
    locationRows = locations.slice(0, input.limit);
  const cp = await paths(c, ctx, 'catalog_nodes', [
    ...catalogRows.map((r) => r.id),
    ...input.catalog_node_ids,
  ]);
  const lp = await paths(c, ctx, 'items', [
    ...locationRows.map((r) => r.id),
    ...input.location_ids,
  ]);
  // Resolve names for unnamed containers in one join, including ancestors.
  const unnamed = lp.filter((r) => !r.object.display_name);
  const labels = unnamed.length
    ? (
        await query(
          c,
          'SELECT id,name FROM catalog_nodes WHERE household_id=$1 AND id=ANY($2::text[])',
          [ctx.household_id, unnamed.map((r) => r.object.catalog_node_id)],
        )
      ).rows
    : [];
  for (const r of lp)
    r.object.name =
      r.object.display_name ?? labels.find((n) => n.id === r.object.catalog_node_id)?.name;
  let catalogCount = catalog[0]?.matching_count ?? 0,
    locationCount = locations[0]?.matching_count ?? 0;
  if (input.cursor > 0 && !catalog.length)
    catalogCount = Number(
      (
        await query(
          c,
          `SELECT count(*) AS count FROM catalog_nodes WHERE household_id=$1 AND (id=ANY($2::text[]) OR acornary_normalize_name(name) LIKE ANY($3::text[]) OR id IN (SELECT catalog_node_id FROM barcode_index WHERE household_id=$1 AND barcode=ANY($4::text[])))`,
          [
            ctx.household_id,
            [...input.catalog_node_ids, ...aliases.map((a: any) => a.catalog_node_id)],
            pattern,
            input.barcodes,
          ],
        )
      ).rows[0].count,
    );
  if (input.cursor > 0 && !locations.length)
    locationCount = Number(
      (
        await query(
          c,
          `SELECT count(*) AS count FROM items i JOIN catalog_nodes n ON n.household_id=i.household_id AND n.id=i.catalog_node_id WHERE i.household_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.attributes) a WHERE a->>'template_id'='container') AND (i.id=ANY($2::text[]) OR acornary_normalize_name(coalesce(i.display_name,n.name)) LIKE ANY($3::text[]))`,
          [ctx.household_id, input.location_ids, locationPattern],
        )
      ).rows[0].count,
    );
  const page = (rows: any[], values: any[], count: number) => ({
    candidates: values,
    matching_count: count,
    complete: input.cursor === 0 && rows.length <= input.limit,
    has_more: rows.length > input.limit,
    next_cursor: rows.length > input.limit ? input.cursor + input.limit : null,
    searched: 'all household matching records; absence from a page is not proof of uniqueness',
  });
  const ids = new Set(cp.map((r) => r.object.id));
  return {
    workflow_version: 'intake/1',
    policy_revision: p.revision,
    rules: p.rules.filter((r: CatalogRule) => ids.has(r.branch_id)),
    referenced_catalog: withPaths(
      cp
        .filter((r) => r.depth === 0 && input.catalog_node_ids.includes(r.object.id))
        .map((r) => r.object),
      cp,
    ),
    referenced_locations: withPaths(
      lp
        .filter((r) => r.depth === 0 && input.location_ids.includes(r.object.id))
        .map((r) => r.object),
      lp,
    ),
    catalog: page(catalog, withPaths(catalogRows, cp), catalogCount),
    locations: page(locations, withPaths(locationRows, lp), locationCount),
    expected_revisions: Object.fromEntries(
      [...cp, ...lp].map((r) => [r.object.id, r.object.revision]),
    ),
    templates: Object.keys(templates).map((id) =>
      templateDefinition(id as TemplateId, latestTemplateVersion(id as TemplateId)),
    ),
    unknowns:
      'Omit unknown values. Physical counts must be explicit. Semantic branch fit is a reasoned judgment, not a permission token.',
  };
}
function commandInput(name: Operation, input: any) {
  const { approval_id: _approval, ...rest } = parseInput(schemas[name], input) as any;
  return rest;
}
function governed(name: Operation, input: any) {
  return (
    ['create_catalog_node', 'update_catalog_node', 'move_catalog_node'].includes(name) ||
    (['bind_attributes', 'update_attributes', 'remove_attributes', 'upgrade_attributes'].includes(
      name,
    ) &&
      input.target?.kind === 'CATALOG_NODE') ||
    (name === 'correct_item' && input.core?.catalog_node_id)
  );
}
function commandDependencies(input: any) {
  return [
    input.catalog_node_id,
    input.target?.id,
    input.item_id,
    input.parent_id,
    input.core?.catalog_node_id,
  ].filter(Boolean);
}
async function validateProposal(c: Client, ctx: Context, proposal: any) {
  if (proposal.kind === 'policy') {
    await checkPolicy(c, ctx, proposal.policy_revision);
    const rule: CatalogRule = proposal.rule;
    const rows = await dependencies(
      c,
      ctx,
      [rule.branch_id, ...rule.aliases.map((a) => a.catalog_node_id), ...rule.legacy_exceptions],
      proposal.expected_revisions,
    );
    requireFact(
      rows.some((r) => r.object.id === rule.branch_id && r.object.kind === 'GROUP'),
      'INVALID_PARENT',
      'Policy branch must be a group.',
    );
    for (const id of rule.legacy_exceptions)
      requireFact(
        rows.some((r) => r.origin === id && r.object.id === rule.branch_id),
        'CLASSIFICATION_CONFLICT',
        'Historical exception must belong to this branch.',
        { id },
      );
    const branchName = rows.find((r) => r.object.id === rule.branch_id)?.object.name;
    requireFact(
      !rule.standard_name || rule.standard_name === branchName,
      'CLASSIFICATION_CONFLICT',
      'A different standard name requires an explicit catalog rename proposal.',
    );
    const aliases = new Map<string, string>();
    for (const a of rule.aliases) {
      requireFact(
        rows.some((r) => r.origin === a.catalog_node_id && r.object.id === rule.branch_id),
        'CLASSIFICATION_CONFLICT',
        'Alias target must belong to the branch.',
        a,
      );
      requireFact(
        !aliases.has(normalize(a.name)) || aliases.get(normalize(a.name)) === a.catalog_node_id,
        'CLASSIFICATION_CONFLICT',
        'Alias has multiple targets.',
        a,
      );
      aliases.set(normalize(a.name), a.catalog_node_id);
    }
    const existing = (await policy(c, ctx)).rules
      .filter((r: CatalogRule) => r.branch_id !== rule.branch_id)
      .flatMap((r: CatalogRule) => r.aliases);
    for (const a of rule.aliases)
      requireFact(
        !existing.some(
          (b: any) =>
            normalize(b.name) === normalize(a.name) && b.catalog_node_id !== a.catalog_node_id,
        ),
        'CLASSIFICATION_CONFLICT',
        'Alias conflicts with another confirmed branch.',
        a,
      );
    const collisions = (
      await query(
        c,
        'SELECT id,name FROM catalog_nodes WHERE household_id=$1 AND acornary_normalize_name(name)=ANY($2::text[])',
        [ctx.household_id, rule.aliases.map((a) => normalize(a.name))],
      )
    ).rows;
    for (const a of rule.aliases)
      requireFact(
        !collisions.some(
          (n) => normalize(n.name) === normalize(a.name) && n.id !== a.catalog_node_id,
        ),
        'CLASSIFICATION_CONFLICT',
        'Alias conflicts with an existing catalog name.',
        a,
      );
  } else if (proposal.kind === 'intake_exception') {
    await checkIntakeDependencies(c, ctx, proposal.intake);
  } else {
    requireFact(
      governed(proposal.operation, proposal.input),
      'ATTRIBUTE_VALIDATION_FAILED',
      'This is not a catalog governance command.',
    );
    const input = commandInput(proposal.operation, proposal.input);
    await dependencies(
      c,
      ctx,
      [...commandDependencies(input), ...Object.keys(input.expected_revisions)],
      input.expected_revisions,
      false,
    );
  }
}
export async function proposeCatalogChange(
  c: Client,
  ctx: Context,
  input: any,
  operation_id: string,
) {
  await validateProposal(c, ctx, input.proposal);
  // Capture all dependencies server-side even if a legacy command only supplies its target revision.
  const proposal = structuredClone(input.proposal);
  if (proposal.kind === 'policy') {
    const branch = (
      await query(c, 'SELECT name FROM catalog_nodes WHERE household_id=$1 AND id=$2', [
        ctx.household_id,
        proposal.rule.branch_id,
      ])
    ).rows[0];
    proposal.rule.standard_name = branch.name;
  }
  if (proposal.kind === 'catalog_command') {
    proposal.input = commandInput(proposal.operation, proposal.input);
    const rows = await dependencies(
      c,
      ctx,
      commandDependencies(proposal.input),
      proposal.input.expected_revisions,
      false,
    );
    proposal.dependencies = Object.fromEntries(rows.map((r) => [r.object.id, r.object.revision]));
    proposal.policy_revision = (await policy(c, ctx)).revision;
  }
  const id = randomUUID();
  await query(
    c,
    'INSERT INTO catalog_proposals(id,household_id,actor_id,proposal) VALUES($1,$2,$3,$4::jsonb)',
    [id, ctx.household_id, ctx.actor_id, JSON.stringify(proposal)],
  );
  return {
    ...resultBase(operation_id),
    changed: true,
    proposal_id: id,
    summary:
      'Review the specific change in the Acornary confirmation card. No catalog or inventory entities have been created.',
  };
}
async function ownedProposal(c: Client, ctx: Context, id: string) {
  const row = (
    await query(
      c,
      'SELECT * FROM catalog_proposals WHERE id=$1 AND household_id=$2 AND actor_id=$3 FOR UPDATE',
      [id, ctx.household_id, ctx.actor_id],
    )
  ).rows[0];
  requireFact(row, 'NOT_FOUND', 'Proposal not found for this operator and household.');
  return row;
}
async function currentProposal(c: Client, ctx: Context, row: any) {
  await validateProposal(c, ctx, row.proposal);
  if (row.proposal.kind === 'catalog_command') {
    await checkPolicy(c, ctx, row.proposal.policy_revision);
    await dependencies(c, ctx, Object.keys(row.proposal.dependencies), row.proposal.dependencies);
  }
}
async function governanceTransaction<T>(ctx: Context, fn: (c: Client) => Promise<T>) {
  return transaction(async (c) => {
    requireFact(
      (
        await query(c, 'SELECT 1 FROM actors WHERE household_id=$1 AND id=$2', [
          ctx.household_id,
          ctx.actor_id,
        ])
      ).rows.length,
      'FORBIDDEN',
      'Invalid household identity.',
    );
    await query(c, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [ctx.household_id]);
    return fn(c);
  });
}
// Transport must keep challenge exclusively in authenticated UI responses, never model content.
export async function reviewCatalogProposal(ctx: Context, scope: string, raw: unknown) {
  const input = parseInput(catalogReviewSchema, raw);
  return governanceTransaction(ctx, async (c) => {
    const row = await ownedProposal(c, ctx, input.proposal_id);
    if (row.status !== 'APPROVED') await currentProposal(c, ctx, row);
    const challenge = randomBytes(32).toString('base64url');
    await query(
      c,
      "UPDATE catalog_proposals SET challenge_hash=$2,challenge_scope=$3,challenge_expires_at=now()+interval '15 minutes' WHERE id=$1",
      [row.id, hash(challenge), scope],
    );
    return {
      proposal_id: row.id,
      proposal: row.proposal,
      status: row.status,
      challenge,
      effect:
        row.proposal.kind === 'policy'
          ? '保存为长期规则；不修改历史目录或实物'
          : '仅批准本次；分类实体仍在实际提交时创建',
      policy: await policy(c, ctx),
    };
  });
}
export async function confirmCatalogProposal(ctx: Context, scope: string, raw: unknown) {
  const input = parseInput(catalogConfirmSchema, raw);
  return governanceTransaction(ctx, async (c) => {
    const row = await ownedProposal(c, ctx, input.proposal_id);
    requireFact(
      row.challenge_scope === scope &&
        row.challenge_hash === hash(input.challenge) &&
        new Date(row.challenge_expires_at).getTime() > Date.now(),
      'APPROVAL_EXPIRED',
      'Open the confirmation card again in the current session.',
    );
    if (row.status === 'APPROVED') return row.result;
    await currentProposal(c, ctx, row);
    let revision = (await policy(c, ctx)).revision;
    if (row.proposal.kind === 'policy') {
      const prior = await policy(c, ctx);
      revision++;
      const rules = [
        ...prior.rules.filter((r: CatalogRule) => r.branch_id !== row.proposal.rule.branch_id),
        row.proposal.rule,
      ];
      await query(
        c,
        'INSERT INTO catalog_policy_versions(household_id,revision,rules,actor_id,reason) VALUES($1,$2,$3::jsonb,$4,$5)',
        [ctx.household_id, revision, JSON.stringify(rules), ctx.actor_id, row.proposal.reason],
      );
      await query(c, 'DELETE FROM catalog_identity_keys WHERE household_id=$1', [ctx.household_id]);
    }
    const result = {
      approval_id: row.id,
      policy_revision: revision,
      scope: row.proposal.kind === 'policy' ? 'LONG_TERM_RULE' : 'THIS_OPERATION_ONLY',
    };
    await query(
      c,
      "UPDATE catalog_proposals SET status='APPROVED',approved_at=now(),result=$2::jsonb WHERE id=$1",
      [row.id, JSON.stringify(result)],
    );
    return result;
  });
}
async function consumeApproval(
  c: Client,
  ctx: Context,
  id: string | undefined,
  operation_id: string,
  matches: (p: any) => boolean,
) {
  requireFact(
    id,
    'APPROVAL_REQUIRED',
    'Create a concrete proposal and approve it in the confirmation card.',
  );
  const row = await ownedProposal(c, ctx, id!);
  requireFact(
    row.status === 'APPROVED' &&
      (!row.consumed_by || row.consumed_by === operation_id) &&
      matches(row.proposal),
    'APPROVAL_REQUIRED',
    'Approval does not authorize these exact changes.',
  );
  await currentProposal(c, ctx, row);
  await query(c, 'UPDATE catalog_proposals SET consumed_by=$2 WHERE id=$1', [row.id, operation_id]);
}
export async function authorizeCatalogCommand(
  c: Client,
  ctx: Context,
  name: Operation,
  input: any,
  operation_id: string,
) {
  if (name === 'create_items') await checkExistingPlacement(c, ctx, input.catalog_node_id);
  if (name === 'create_items_batch') {
    for (const id of new Set<string>(input.items.map((item: any) => item.catalog_node_id)))
      await checkExistingPlacement(c, ctx, id);
  }
  if (!governed(name, input)) return;
  await consumeApproval(
    c,
    ctx,
    input.approval_id,
    operation_id,
    (p) =>
      p.kind === 'catalog_command' &&
      p.operation === name &&
      canonical(p.input) === canonical(commandInput(name, input)),
  );
}
async function checkExistingPlacement(c: Client, ctx: Context, sku: string, checked?: any) {
  const observed = checked?.dependencies?.filter((row: any) => row.origin === sku);
  const ancestry = observed?.length ? observed : await paths(c, ctx, 'catalog_nodes', [sku]);
  const node = ancestry.find((a: any) => a.object.id === sku)?.object;
  requireFact(node, 'NOT_FOUND', 'Product not found in this household.');
  requireFact(
    node.kind === 'SKU',
    'ATTRIBUTE_VALIDATION_FAILED',
    'Physical items require an existing SKU.',
  );
  const p = checked ?? (await policy(c, ctx));
  const rule: CatalogRule | undefined = [...ancestry]
    .reverse()
    .map((a: any) => p.rules.find((r: CatalogRule) => r.branch_id === a.object.id))
    .find(Boolean);
  if (rule)
    requireFact(
      rule.allow_direct_products || rule.legacy_exceptions.includes(sku),
      'CLASSIFICATION_CONFLICT',
      'Existing placement conflicts with the current rule. Mark a historical exception or approve this intake explicitly.',
      { catalog_node_id: sku, rule },
    );
}
async function checkIntakeDependencies(c: Client, ctx: Context, body: any) {
  const p = await checkPolicy(c, ctx, body.policy_revision);
  const ids = body.lines
    .flatMap((l: any) => [
      l.product.catalog_node_id ?? l.product.parent_id,
      ...l.instances.map((i: any) =>
        i.parent_id === undefined ? body.defaults?.parent_id : i.parent_id,
      ),
    ])
    .filter(Boolean);
  const observed = await dependencies(
    c,
    ctx,
    [...ids, ...Object.keys(body.expected_revisions)],
    body.expected_revisions,
  );
  return { ...p, dependencies: observed };
}
function mergeValues(left: any, right: any): any {
  if (
    !left ||
    !right ||
    typeof right !== 'object' ||
    Array.isArray(right) ||
    Object.hasOwn(right, 'value')
  )
    return structuredClone(right);
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) merged[key] = mergeValues(left[key], value);
  return merged;
}
function mergeAttributes(common: any[] = [], individual: any[] = []) {
  for (const attrs of [common, individual])
    requireFact(
      new Set(attrs.map((a) => a.template_id)).size === attrs.length,
      'ATTRIBUTE_VALIDATION_FAILED',
      'Duplicate template bindings.',
    );
  const map = new Map(common.map((a) => [a.template_id, structuredClone(a)]));
  for (const a of individual)
    map.set(a.template_id, { ...a, values: mergeValues(map.get(a.template_id)?.values, a.values) });
  return [...map.values()];
}
type Apply = (
  c: Client,
  ctx: Context,
  name: Operation,
  input: any,
  operation_id: string,
) => Promise<any>;
export async function commitIntake(
  c: Client,
  ctx: Context,
  input: any,
  operation_id: string,
  apply: Apply,
) {
  const body = intakeBodySchema.parse(
    Object.fromEntries(
      Object.entries(input).filter(
        ([k]) => !['idempotency_key', 'approval_id', 'occurred_at'].includes(k),
      ),
    ),
  );
  const p = await checkIntakeDependencies(c, ctx, body);
  if (input.approval_id)
    await consumeApproval(
      c,
      ctx,
      input.approval_id,
      operation_id,
      (proposal) =>
        proposal.kind === 'intake_exception' && canonical(proposal.intake) === canonical(body),
    );
  const result = resultBase(operation_id);
  const receipt: any = {
    policy_revision: p.revision,
    reused_catalog: [],
    created_catalog: [],
    items: [],
    classification: [],
    item_count: 0,
  };
  const add = async (name: Operation, data: any) => {
    const parsed = schemas[name].parse({
      ...data,
      idempotency_key: input.idempotency_key,
      expected_revisions: {},
      ...(input.occurred_at ? { occurred_at: input.occurred_at } : {}),
    });
    const r = await apply(c, ctx, name, parsed, operation_id);
    result.affected_objects.push(...r.affected_objects);
    result.event_ids.push(...r.event_ids);
    return r.affected_objects.map((a: any) => a.id) as string[];
  };
  const aliases = p.rules.flatMap((r: CatalogRule) => r.aliases);
  for (const line of body.lines) {
    let sku: string;
    if ('catalog_node_id' in line.product) {
      sku = line.product.catalog_node_id;
      if (!input.approval_id) await checkExistingPlacement(c, ctx, sku, p);
      receipt.reused_catalog.push(sku);
    } else {
      const product = line.product;
      const ancestry: Awaited<ReturnType<typeof paths>> = p.dependencies.filter(
        (row: any) => row.origin === product.parent_id,
      );
      const parent = ancestry.find((a) => a.object.id === product.parent_id)?.object;
      requireFact(
        parent?.kind === 'GROUP' ||
          (!product.parent_id && input.approval_id && product.new_groups.length),
        'INVALID_PARENT',
        'New products require a group branch.',
      );
      const rule: CatalogRule | undefined = [...ancestry]
        .reverse()
        .map((a) => p.rules.find((r: CatalogRule) => r.branch_id === a.object.id))
        .find(Boolean);
      requireFact(
        rule || input.approval_id,
        'POLICY_REQUIRED',
        'Confirm a rule for this branch before adding a new product.',
        { branch_id: product.parent_id },
      );
      if (!input.approval_id && rule) {
        const depth =
          ancestry.findIndex((a) => a.object.id === product.parent_id) -
          ancestry.findIndex((a) => a.object.id === rule.branch_id);
        requireFact(
          product.new_groups.length
            ? rule.allow_new_groups && depth + product.new_groups.length <= rule.max_new_depth
            : rule.allow_direct_products,
          'CLASSIFICATION_CONFLICT',
          'Requested placement is outside the approved branch structure.',
          { rule },
        );
        requireFact(
          !product.new_groups.some((n) =>
            rule.forbidden_names.some((f) => normalize(f) === normalize(n)),
          ) && !rule.forbidden_names.some((n) => normalize(n) === normalize(product.name)),
          'CLASSIFICATION_CONFLICT',
          'Name conflicts with the approved naming constraints.',
        );
      }
      const naming = [...product.new_groups, product.name];
      if (rule && !input.approval_id) {
        requireFact(
          naming.every((n) => n.length <= rule.name_max_length),
          'CLASSIFICATION_CONFLICT',
          'Name exceeds the approved length.',
        );
        if (rule.forbid_measurement_names)
          requireFact(
            !naming.some((n) => /^\s*\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|克|千克|毫升|升)\s*$/i.test(n)),
            'CLASSIFICATION_CONFLICT',
            'Per-piece measurements cannot be catalog names.',
          );
        if (rule.forbid_location_names) {
          const locations = (
            await query(
              c,
              "SELECT display_name FROM items WHERE household_id=$1 AND acornary_normalize_name(display_name)=ANY($2::text[]) AND EXISTS(SELECT 1 FROM jsonb_array_elements(attributes) a WHERE a->>'template_id'='container')",
              [ctx.household_id, naming.map(normalize)],
            )
          ).rows;
          requireFact(
            !locations.length,
            'CLASSIFICATION_CONFLICT',
            'Known storage locations cannot become classification names.',
            { locations },
          );
        }
      }
      requireFact(
        new Set((product.initial_attributes ?? []).map((a) => a.template_id)).size ===
          (product.initial_attributes ?? []).length,
        'ATTRIBUTE_VALIDATION_FAILED',
        'Duplicate product templates.',
      );
      for (const a of product.initial_attributes ?? []) {
        requireFact(
          templates[a.template_id as TemplateId].target_kind === 'CATALOG_NODE',
          'ATTRIBUTE_VALIDATION_FAILED',
          'Physical attributes belong to instances.',
        );
        validateValues(a.template_id as TemplateId, a.values, a.template_version);
      }
      const fields = rule?.identity_fields ?? [
        'product.brand',
        'product.model',
        'product.specification',
        'product.net_content',
      ];
      const supplied = sets(product.initial_attributes);
      const signature = (attrs: any) =>
        Object.fromEntries(fields.map((f) => [f, normalizedFact(getPath(attrs, f) ?? null)]));
      const identity = signature(supplied);
      const identityKey = hash({ name: normalize(product.name), identity });
      const barcodes: string[] = supplied.product?.barcodes ?? [];
      const aliasTargets = aliases
        .filter((a: any) => normalize(a.name) === normalize(product.name))
        .map((a: any) => a.catalog_node_id);
      if (aliasTargets.length) {
        const aliasRows = (
          await query(
            c,
            'SELECT id,kind FROM catalog_nodes WHERE household_id=$1 AND id=ANY($2::text[])',
            [ctx.household_id, aliasTargets],
          )
        ).rows;
        requireFact(
          aliasRows.every((n) => n.kind === 'SKU'),
          'CLASSIFICATION_CONFLICT',
          'The confirmed name denotes a category, not a product.',
          { candidates: aliasRows },
        );
      }
      const candidates = (
        await query(
          c,
          `SELECT DISTINCT n.* FROM catalog_nodes n LEFT JOIN barcode_index b ON b.household_id=n.household_id AND b.catalog_node_id=n.id WHERE n.household_id=$1 AND n.kind='SKU' AND (acornary_normalize_name(n.name)=$2 OR n.id=ANY($3::text[]) OR b.barcode=ANY($4::text[]) OR n.id IN (SELECT catalog_node_id FROM catalog_identity_keys WHERE household_id=$1 AND identity_key=$5 AND policy_revision=$6))`,
          [
            ctx.household_id,
            normalize(product.name),
            aliasTargets,
            barcodes,
            identityKey,
            p.revision,
          ],
        )
      ).rows;
      const authoritative = candidates.filter(
        (n) =>
          aliasTargets.includes(n.id) ||
          (sets(n.attributes).product?.barcodes ?? []).some((b: string) => barcodes.includes(b)),
      );
      const compatible = candidates.filter((n) => {
        const existing = signature(sets(n.attributes));
        return fields.every(
          (f) =>
            identity[f] === null ||
            existing[f] === null ||
            canonical(identity[f]) === canonical(existing[f]),
        );
      });
      requireFact(
        authoritative.every((n) => compatible.some((x) => x.id === n.id)),
        'AMBIGUOUS_PRODUCT',
        'Barcode or confirmed alias conflicts with supplied identifying facts.',
        { candidates: authoritative },
      );
      const matches = authoritative.length ? authoritative : compatible;
      if (matches.length) {
        requireFact(
          matches.length === 1,
          'AMBIGUOUS_PRODUCT',
          'Multiple historical or alias matches. Choose the actual product; no records were merged.',
          { candidates: matches },
        );
        const candidate = matches[0];
        requireFact(
          authoritative.length ||
            (Object.values(identity).some((v) => v !== null) &&
              canonical(signature(sets(candidate.attributes))) === canonical(identity)),
          'AMBIGUOUS_PRODUCT',
          'Same name with incomplete identifying information. Choose an existing product or clarify the difference.',
          { candidates: matches },
        );
        const actualPath = await paths(c, ctx, 'catalog_nodes', [candidate.id]);
        requireFact(
          actualPath.some((a) => a.object.id === product.parent_id),
          'CLASSIFICATION_CONFLICT',
          'The existing matching product belongs to a different branch. Reuse its confirmed placement or resolve the conflict.',
          { candidate },
        );
        const oldCodes: string[] = sets(candidate.attributes).product?.barcodes ?? [];
        requireFact(
          !barcodes.length || !oldCodes.length || barcodes.some((b) => oldCodes.includes(b)),
          'AMBIGUOUS_PRODUCT',
          'Known barcode sets differ. Clarify the product identity.',
          { candidate },
        );
        requireFact(
          containsFacts(sets(candidate.attributes), supplied),
          'AMBIGUOUS_PRODUCT',
          'The matching SKU does not contain all supplied product facts. Reuse its ID explicitly or propose the specific attribute change; supplied facts were not discarded.',
          { candidate, supplied },
        );
        sku = candidate.id;
        if (!input.approval_id) await checkExistingPlacement(c, ctx, sku, p);
        // Explicitly read candidates must remain at their observed versions; a concurrent identical new SKU can be reused.
        if (body.expected_revisions[sku] !== undefined)
          await dependencies(c, ctx, [sku], body.expected_revisions);
        receipt.reused_catalog.push(sku);
      } else {
        let parent_id: string | null = product.parent_id;
        for (const groupName of product.new_groups) {
          const knownAliases = aliases
            .filter((a: any) => normalize(a.name) === normalize(groupName))
            .map((a: any) => a.catalog_node_id);
          const groups = (
            await query(
              c,
              `SELECT * FROM catalog_nodes WHERE household_id=$1 AND (acornary_normalize_name(name)=$2 OR id=ANY($3::text[]))`,
              [ctx.household_id, normalize(groupName), knownAliases],
            )
          ).rows;
          requireFact(
            !groups.some(
              (g) =>
                knownAliases.includes(g.id) && (g.parent_id !== parent_id || g.kind !== 'GROUP'),
            ),
            'CLASSIFICATION_CONFLICT',
            'A confirmed alias points to a different branch.',
          );
          const same = groups.filter((g) => g.parent_id === parent_id && g.kind === 'GROUP');
          requireFact(
            same.length <= 1 &&
              !groups.some((g) => g.parent_id === parent_id && g.kind !== 'GROUP'),
            'CLASSIFICATION_CONFLICT',
            'Group name is ambiguous or already used by a product.',
            { candidates: groups },
          );
          if (same.length) {
            const specific = p.rules.find((r: CatalogRule) => r.branch_id === same[0].id);
            requireFact(
              input.approval_id || !specific || specific.branch_id === rule?.branch_id,
              'CLASSIFICATION_CONFLICT',
              'A more specific branch rule applies. Read this branch and use its explicit parent reference.',
              { branch_id: same[0].id, rule: specific },
            );
            parent_id = same[0].id;
            receipt.reused_catalog.push(parent_id);
          } else {
            [parent_id] = await add('create_catalog_node', {
              kind: 'GROUP',
              name: groupName,
              parent_id,
            });
            receipt.created_catalog.push(parent_id);
          }
        }
        [sku] = await add('create_catalog_node', {
          kind: 'SKU',
          name: product.name,
          parent_id,
          initial_attributes: product.initial_attributes,
        });
        receipt.created_catalog.push(sku);
        await query(
          c,
          'INSERT INTO catalog_identity_keys(household_id,identity_key,catalog_node_id,policy_revision) VALUES($1,$2,$3,$4) ON CONFLICT(household_id,identity_key) DO UPDATE SET catalog_node_id=excluded.catalog_node_id,policy_revision=excluded.policy_revision',
          [ctx.household_id, identityKey, sku, p.revision],
        );
      }
      receipt.classification.push({
        catalog_node_id: sku,
        branch_id: product.parent_id,
        reason: product.classification_reason,
        approval_id: input.approval_id ?? null,
      });
    }
    for (const instance of line.instances) {
      const ids = await add('create_items', {
        catalog_node_id: sku,
        count: instance.count,
        parent_id:
          instance.parent_id === undefined
            ? (body.defaults?.parent_id ?? null)
            : instance.parent_id,
        display_name: instance.display_name,
        initial_attributes: mergeAttributes(
          body.defaults?.initial_attributes,
          instance.initial_attributes,
        ),
      });
      receipt.items.push(...ids);
      receipt.item_count += ids.length;
    }
  }
  const rows = (
    await query(
      c,
      'SELECT i.*,n.name AS catalog_name FROM items i JOIN catalog_nodes n ON n.household_id=i.household_id AND n.id=i.catalog_node_id WHERE i.household_id=$1 AND i.id=ANY($2::text[]) ORDER BY i.id',
      [ctx.household_id, receipt.items],
    )
  ).rows;
  const ancestry = await paths(c, ctx, 'items', receipt.items);
  const labels = new Map(rows.map((r) => [r.catalog_node_id, r.catalog_name]));
  const missing = [
    ...new Set(
      ancestry
        .filter((a) => !a.object.display_name && !labels.has(a.object.catalog_node_id))
        .map((a) => a.object.catalog_node_id),
    ),
  ];
  if (missing.length)
    for (const row of (
      await query(
        c,
        'SELECT id,name FROM catalog_nodes WHERE household_id=$1 AND id=ANY($2::text[])',
        [ctx.household_id, missing],
      )
    ).rows)
      labels.set(row.id, row.name);
  for (const a of ancestry)
    a.object.name = a.object.display_name ?? labels.get(a.object.catalog_node_id);
  receipt.items = withPaths(rows, ancestry);
  receipt.reused_catalog = [...new Set(receipt.reused_catalog)];
  result.changed = true;
  result.summary = `已入库 ${receipt.item_count} 件实物；新增 ${receipt.created_catalog.length} 个目录对象，复用 ${receipt.reused_catalog.length} 个。各件属性与完整位置见 receipt。`;
  return { ...result, receipt };
}

// Model-facing success contains actual grouped differences without reciting every UUID.
// The immutable operation result remains complete for get_intake_receipt and the app.
export function compactIntakeResult(result: any) {
  const groups = new Map<string, any>();
  for (const item of result.receipt.items) {
    const attributes = item.attributes.map((a: any) => ({
      template_id: a.template_id,
      values: a.values,
    }));
    const location = item.path.slice(0, -1).map((p: any) => p.name);
    const key = canonical({
      sku: item.catalog_node_id,
      display_name: item.display_name,
      location_ids: item.path.slice(0, -1).map((p: any) => p.id),
      attributes,
    });
    const prior = groups.get(key);
    if (prior) prior.count++;
    else
      groups.set(key, {
        product: item.catalog_name,
        display_name: item.display_name,
        location,
        attributes,
        count: 1,
      });
  }
  return {
    operation_id: result.operation_id,
    changed: result.changed,
    summary: result.summary,
    item_count: result.receipt.item_count,
    created_catalog_count: result.receipt.created_catalog.length,
    reused_catalog_count: result.receipt.reused_catalog.length,
    items: [...groups.values()],
    full_receipt: 'get_intake_receipt',
  };
}
