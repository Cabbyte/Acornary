// Batch 0 diagnostics only. No migration, repair, or application writes.
import { createHash } from 'node:crypto';
import { canonical } from '../../packages/domain/src/index.js';
import {
  templates,
  templateFor,
  templateDefinition,
  validateValues,
  type TemplateId,
} from '../../packages/contracts/src/index.js';

export type Row = Record<string, any>;
export interface AuditSnapshot {
  households: Row[];
  actors: Row[];
  catalog_nodes: Row[];
  items: Row[];
  attribute_templates: Row[];
  barcode_index: Row[];
  notes: Row[];
  events: Row[];
  operations: Row[];
  migrations: Row[];
  catalog_policy_versions: Row[];
  catalog_identity_keys: Row[];
}
export interface Finding {
  check: string;
  severity: 'ERROR' | 'REVIEW';
  household_id: string | null;
  object_kind: string;
  object_id: string | null;
  related_ids: string[];
  disposition: 'REVIEW_REQUIRED';
}
export function digest(value: unknown): string {
  // Stream canonical tokens instead of allocating another full performance dataset string.
  const hash = createHash('sha256');
  const feed = (v: any): void => {
    if (v instanceof Date) {
      hash.update(JSON.stringify(v.toISOString()));
      return;
    }
    if (Array.isArray(v)) {
      hash.update('[');
      v.forEach((x, i) => {
        if (i) hash.update(',');
        feed(x);
      });
      hash.update(']');
      return;
    }
    if (v && typeof v === 'object') {
      hash.update('{');
      Object.keys(v)
        .sort()
        .filter((k) => v[k] !== undefined)
        .forEach((k, i) => {
          if (i) hash.update(',');
          hash.update(JSON.stringify(k) + ':');
          feed(v[k]);
        });
      hash.update('}');
      return;
    }
    hash.update(JSON.stringify(v) ?? 'null');
  };
  feed(value);
  return hash.digest('hex');
}
const opPattern =
  /^operation_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pair = (household: string, id: string) => `${household}/${id}`;
const values = (r: Row, id: string) =>
  Array.isArray(r.attributes)
    ? r.attributes.find((a: any) => a?.template_id === id)?.values
    : undefined;

export function auditSnapshot(s: AuditSnapshot) {
  const findings: Finding[] = [];
  const add = (
    check: string,
    kind: string,
    r: Row,
    severity: Finding['severity'] = 'ERROR',
    related: string[] = [],
  ) => {
    // No names, attributes, note bodies, receipt values, credentials or validation input in reports.
    findings.push({
      check,
      severity,
      household_id: r.household_id ?? (kind === 'HOUSEHOLD' ? r.id : null),
      object_kind: kind,
      object_id: r.id ?? r.operation_id ?? r.result_operation_id ?? null,
      related_ids: related.filter((id) => typeof id === 'string'),
      disposition: 'REVIEW_REQUIRED',
    });
  };
  const households = new Set(s.households.map((r) => r.id));
  const actors = new Set(s.actors.map((r) => pair(r.household_id, r.id)));
  const catalogs = new Map(s.catalog_nodes.map((r) => [pair(r.household_id, r.id), r]));
  const items = new Map(s.items.map((r) => [pair(r.household_id, r.id), r]));
  const registered = new Map(
    s.attribute_templates.map((r) => [`${r.household_id}/${r.id}/${r.version}`, r]),
  );
  for (const h of s.households) {
    try {
      if (typeof h.timezone !== 'string' || !h.timezone) throw new Error();
      new Intl.DateTimeFormat('en', { timeZone: h.timezone });
    } catch {
      add('INVALID_TIMEZONE', 'HOUSEHOLD', h);
    }
  }
  for (const [kind, rows, byId] of [
    ['CATALOG_NODE', s.catalog_nodes, catalogs],
    ['ITEM', s.items, items],
  ] as const) {
    for (const row of rows) {
      if (!households.has(row.household_id)) add('MISSING_HOUSEHOLD', kind, row);
      if (!Number.isInteger(row.revision) || row.revision <= 0) add('INVALID_REVISION', kind, row);
      if (kind === 'CATALOG_NODE' && !['GROUP', 'SKU'].includes(row.kind))
        add('INVALID_CATALOG_KIND', kind, row);
      if (row.parent_id) {
        const parent = byId.get(pair(row.household_id, row.parent_id));
        if (!parent) add('INVALID_PARENT_REFERENCE', kind, row, 'ERROR', [row.parent_id]);
        else if (
          kind === 'CATALOG_NODE'
            ? parent.kind !== 'GROUP'
            : values(parent, 'container')?.can_contain !== true
        )
          add('INVALID_PARENT_CAPABILITY', kind, row, 'ERROR', [row.parent_id]);
      }
      if (kind === 'ITEM') {
        const sku = catalogs.get(pair(row.household_id, row.catalog_node_id));
        if (!sku || sku.kind !== 'SKU')
          add('INVALID_SKU_REFERENCE', kind, row, 'ERROR', [row.catalog_node_id]);
      }
      if (!Array.isArray(row.attributes)) {
        add('INVALID_BINDING_ARRAY', kind, row);
        continue;
      }
      if (row.attributes.length > 16) add('BINDING_RESOURCE_LIMIT', kind, row);
      const seen = new Set<string>();
      for (const a of row.attributes) {
        if (
          !a ||
          typeof a !== 'object' ||
          Array.isArray(a) ||
          Object.keys(a).sort().join(',') !==
            'created_at,template_id,template_version,updated_at,values' ||
          typeof a.template_id !== 'string' ||
          !Number.isInteger(a.template_version) ||
          a.template_version < 1 ||
          !a.values ||
          typeof a.values !== 'object' ||
          Array.isArray(a.values) ||
          !Object.keys(a.values).length ||
          typeof a.created_at !== 'string' ||
          !Number.isFinite(Date.parse(a.created_at)) ||
          typeof a.updated_at !== 'string' ||
          !Number.isFinite(Date.parse(a.updated_at))
        ) {
          add('INVALID_BINDING_SHAPE', kind, row);
          continue;
        }
        if (seen.has(a.template_id)) add('DUPLICATE_BINDING', kind, row);
        seen.add(a.template_id);
        const registration = registered.get(
          `${row.household_id}/${a.template_id}/${a.template_version}`,
        );
        if (!registration) add('UNREGISTERED_BINDING', kind, row);
        else if (registration.target_kind !== kind) add('REGISTERED_TARGET_MISMATCH', kind, row);
        if (!Object.hasOwn(templates, a.template_id)) {
          add('UNKNOWN_TEMPLATE', kind, row, 'REVIEW');
          continue;
        }
        let template;
        try {
          template = templateFor(a.template_id as TemplateId, a.template_version);
        } catch {
          add('UNKNOWN_TEMPLATE_VERSION', kind, row, 'REVIEW');
          continue;
        }
        if (template.target_kind !== kind || (kind === 'CATALOG_NODE' && row.kind !== 'SKU'))
          add('INVALID_BINDING_TARGET', kind, row);
        try {
          validateValues(a.template_id, a.values, a.template_version);
        } catch {
          add('INVALID_BINDING_VALUES', kind, row);
        }
      }
    }
    // Linear-time functional-graph walk. Bad historical cycles cannot hang the auditor.
    const done = new Set<string>();
    for (const row of rows) {
      let key: string | undefined = pair(row.household_id, row.id);
      const path: string[] = [],
        positions = new Map<string, number>();
      while (key && !done.has(key) && byId.has(key)) {
        if (positions.has(key)) {
          const cycle = path.slice(positions.get(key));
          for (const node of cycle)
            add(
              'TREE_CYCLE',
              kind,
              byId.get(node)!,
              'ERROR',
              cycle.map((k) => byId.get(k)!.id),
            );
          break;
        }
        positions.set(key, path.length);
        path.push(key);
        const node: Row = byId.get(key)!;
        key = node.parent_id ? pair(node.household_id, node.parent_id) : undefined;
      }
      path.forEach((k) => done.add(k));
    }
  }
  for (const r of s.attribute_templates) {
    if (!Object.hasOwn(templates, r.id)) {
      add('UNKNOWN_REGISTERED_TEMPLATE', 'TEMPLATE', r, 'REVIEW');
      continue;
    }
    try {
      if (digest(r.definition) !== digest(templateDefinition(r.id as TemplateId, r.version)))
        add('TEMPLATE_DEFINITION_DRIFT', 'TEMPLATE', r, 'REVIEW');
    } catch {
      add('UNKNOWN_REGISTERED_VERSION', 'TEMPLATE', r, 'REVIEW');
    }
  }
  const ops = new Set<string>();
  for (const op of s.operations) {
    const id = op.result_operation_id ?? op.result?.operation_id;
    if (op.operation_id_column_present === true && op.operation_id == null)
      add('NULL_OPERATION_ID_COLUMN', 'OPERATION', op);
    if (typeof id !== 'string' || !opPattern.test(id)) {
      add('INVALID_OPERATION_ID', 'OPERATION', op);
      continue;
    }
    if (op.operation_id != null && op.operation_id !== id)
      add('OPERATION_ID_MISMATCH', 'OPERATION', op);
    const key = pair(op.household_id, id);
    if (ops.has(key)) add('DUPLICATE_OPERATION_ID', 'OPERATION', { ...op, id });
    ops.add(key);
    if (!actors.has(pair(op.household_id, op.actor_id)))
      add('INVALID_ACTOR_REFERENCE', 'OPERATION', { ...op, id });
  }
  for (const e of s.events) {
    const targets =
      e.target_kind === 'ITEM' ? items : e.target_kind === 'CATALOG_NODE' ? catalogs : undefined;
    if (!targets?.has(pair(e.household_id, e.target_id)))
      add('ORPHAN_EVENT_TARGET', 'EVENT', e, 'ERROR', [e.target_id]);
    if (!ops.has(pair(e.household_id, e.operation_id)))
      add('ORPHAN_EVENT_OPERATION', 'EVENT', e, 'ERROR', [e.operation_id]);
    if (!actors.has(pair(e.household_id, e.actor_id))) add('INVALID_ACTOR_REFERENCE', 'EVENT', e);
    if ((e.changes_type && e.changes_type !== 'array') || !Array.isArray(e.changes))
      add('INVALID_EVENT_CHANGES', 'EVENT', e);
  }
  for (const n of s.notes) {
    const targets = n.target_kind === 'CATALOG_NODE' ? catalogs : items;
    if (!targets.has(pair(n.household_id, n.target_id ?? n.item_id)))
      add('ORPHAN_NOTE_TARGET', 'NOTE', n);
    if (!actors.has(pair(n.household_id, n.created_by))) add('INVALID_ACTOR_REFERENCE', 'NOTE', n);
  }
  const names = new Map<string, Row[]>();
  for (const r of s.catalog_nodes) {
    const name = typeof r.name === 'string' ? r.name.normalize('NFKC').trim().toLowerCase() : '';
    if (!name) add('INVALID_CATALOG_NAME', 'CATALOG_NODE', r);
    const key = JSON.stringify([r.household_id, r.parent_id, r.kind, name]);
    const group = names.get(key) ?? [];
    group.push(r);
    names.set(key, group);
  }
  for (const group of names.values())
    if (group.length > 1)
      for (const r of group)
        add(
          'SIBLING_NAME_REVIEW',
          'CATALOG_NODE',
          r,
          'REVIEW',
          group.filter((x) => x.id !== r.id).map((x) => x.id),
        );
  const barcodeOwner = new Map<string, string>();
  const indexed = new Map<string, Row>();
  for (const b of s.barcode_index) {
    const key = pair(b.household_id, b.barcode);
    if (indexed.has(key))
      add('DUPLICATE_BARCODE_INDEX', 'CATALOG_NODE', { ...b, id: b.catalog_node_id });
    indexed.set(key, b);
    const sku = catalogs.get(pair(b.household_id, b.catalog_node_id));
    if (!sku || sku.kind !== 'SKU')
      add('INVALID_BARCODE_TARGET', 'CATALOG_NODE', { ...b, id: b.catalog_node_id });
    const codes = sku && values(sku, 'product')?.barcodes;
    if (!Array.isArray(codes) || !codes.includes(b.barcode))
      add('BARCODE_INDEX_DRIFT', 'CATALOG_NODE', { ...b, id: b.catalog_node_id });
  }
  for (const sku of s.catalog_nodes) {
    const codes = values(sku, 'product')?.barcodes;
    if (!Array.isArray(codes)) continue;
    for (const code of codes) {
      if (typeof code !== 'string') continue;
      const key = pair(sku.household_id, code),
        prior = barcodeOwner.get(key);
      if (prior && prior !== sku.id) add('BARCODE_CONFLICT', 'CATALOG_NODE', sku, 'ERROR', [prior]);
      barcodeOwner.set(key, sku.id);
      if (indexed.get(key)?.catalog_node_id !== sku.id)
        add('BARCODE_INDEX_DRIFT', 'CATALOG_NODE', sku);
    }
  }
  const policies = new Set(
    s.catalog_policy_versions.map((p) => pair(p.household_id, String(p.revision))),
  );
  for (const k of s.catalog_identity_keys) {
    const sku = catalogs.get(pair(k.household_id, k.catalog_node_id));
    if (!sku || sku.kind !== 'SKU')
      add('INVALID_IDENTITY_TARGET', 'CATALOG_NODE', { ...k, id: k.catalog_node_id });
    if (!policies.has(pair(k.household_id, String(k.policy_revision))))
      add('INVALID_IDENTITY_POLICY', 'CATALOG_NODE', { ...k, id: k.catalog_node_id });
  }
  for (const m of s.migrations)
    if (!m.checksum) add('MIGRATION_CHECKSUM_UNVERIFIED', 'MIGRATION', { id: m.name }, 'REVIEW');
  findings.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return {
    format_version: 1,
    verdict: findings.length ? 'REVIEW_REQUIRED' : 'NO_FINDINGS',
    counts: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.length])),
    errors: findings.filter((f) => f.severity === 'ERROR').length,
    reviews: findings.filter((f) => f.severity === 'REVIEW').length,
    findings,
    limitations: [
      'No repairs performed.',
      'No production readiness or performance claim.',
      'Migration hashes require independent historical provenance.',
    ],
  };
}

export function validateAuditUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid audit database configuration.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^\/acornary_audit_[a-z0-9_]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Audit requires a loopback acornary_audit_* restored database, without URL options.',
    );
  return url;
}
