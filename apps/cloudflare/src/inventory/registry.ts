import { createHash } from 'node:crypto';
import {
  findTemplate,
  templateDefinition,
  resolveCapabilities,
  pathCapability,
  type BindingStatus,
  type TemplateDefinition,
  type CapabilityKey,
} from '../../../../packages/contracts/src/registry.js';
import { canonical, requireFact } from '../../../../packages/domain/src/index.js';
import { query, type Client } from './db.js';

const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function definitionHashes(definition: TemplateDefinition) {
  return {
    schema_hash: hash({
      id: definition.id,
      version: definition.version,
      target_kind: definition.target_kind,
      allowed_catalog_node_kinds: definition.allowed_catalog_node_kinds,
      paths: definition.paths,
      schema: definition.schema,
    }),
    ui_hash: hash({
      name: definition.name,
      capability: definition.capability,
      fields: definition.fields,
    }),
  };
}
// INSERT-only: conflicts are compared, never overwritten, including pre-hash publications.
export function publishTemplate(c: Client, householdId: string, definition: TemplateDefinition) {
  const hashes = definitionHashes(definition);
  query(
    c,
    `INSERT INTO attribute_templates(household_id,id,version,target_kind,definition)
    VALUES(?1,?2,?3,?4,?5) ON CONFLICT(household_id,id,version) DO NOTHING`,
    [
      householdId,
      definition.id,
      definition.version,
      definition.target_kind,
      JSON.stringify({ ...definition, ...hashes }),
    ],
  );
  const stored = query(
    c,
    'SELECT target_kind,definition FROM attribute_templates WHERE household_id=?1 AND id=?2 AND version=?3',
    [householdId, definition.id, definition.version],
  ).rows[0];
  requireFact(
    stored.target_kind === definition.target_kind &&
      definitionHashes(stored.definition).schema_hash === hashes.schema_hash,
    'TEMPLATE_DEFINITION_CONFLICT',
    'Published template schema is immutable.',
  );
  return hashes;
}
export function bindingStatuses(c: Client, householdId: string) {
  const rows = query(
    c,
    'SELECT id,version,definition FROM attribute_templates WHERE household_id=?1',
    [householdId],
  ).rows;
  return new Map<string, BindingStatus>(
    rows.map((r) => [
      `${r.id}@${r.version}`,
      r.definition.status === 'RETIRED' || findTemplate(r.id, r.version)?.retired
        ? 'RETIRED'
        : findTemplate(r.id, r.version)
          ? 'KNOWN'
          : 'UNKNOWN',
    ]),
  );
}
export function bindingStatus(binding: any, statuses: Map<string, BindingStatus>): BindingStatus {
  return (
    statuses.get(`${binding.template_id}@${binding.template_version}`) ??
    (findTemplate(binding.template_id, binding.template_version)?.retired
      ? 'RETIRED'
      : findTemplate(binding.template_id, binding.template_version)
        ? 'KNOWN'
        : 'UNKNOWN')
  );
}
export function assertWritableTemplate(
  c: Client,
  householdId: string,
  id: string,
  version: number,
) {
  const t = findTemplate(id, version);
  const statuses = bindingStatuses(c, householdId);
  requireFact(
    t && bindingStatus({ template_id: id, template_version: version }, statuses) === 'KNOWN',
    'ATTRIBUTE_VALIDATION_FAILED',
    'Unknown or retired template is read-only.',
  );
  publishTemplate(c, householdId, templateDefinition(t.id, version));
  return t;
}
export function availableTemplate(definition: TemplateDefinition, capabilities: CapabilityKey[]) {
  return !definition.capability || capabilities.includes(definition.capability);
}
export function templateForCapabilities(
  definition: TemplateDefinition,
  capabilities: CapabilityKey[],
) {
  const paths = definition.paths.filter((path) => {
    const capability = pathCapability(definition.id, path);
    return !capability || capabilities.includes(capability);
  });
  // Legal paths and schema stay immutable; fields describe the suggested form.
  return { ...definition, fields: definition.fields.filter((f) => paths.includes(f.path)) };
}
export function decorateRecords(c: Client, householdId: string, catalog: any[], items: any[]) {
  const statuses = bindingStatuses(c, householdId);
  const byId = new Map(catalog.map((row) => [row.id, row]));
  for (const row of catalog)
    row.effective_capabilities = resolveCapabilities(row.profile, row.capabilities);
  for (const row of items) {
    const sku = byId.get(row.catalog_node_id);
    row.effective_capabilities = sku ? resolveCapabilities(sku.profile, sku.capabilities) : [];
  }
  for (const row of [...catalog, ...items])
    row.attributes = row.attributes.map((a: any) => {
      const status = bindingStatus(a, statuses);
      return {
        template_id: a.template_id,
        template_version: a.template_version,
        values: a.values,
        ...(status === 'KNOWN' ? {} : { status }),
      };
    });
}
