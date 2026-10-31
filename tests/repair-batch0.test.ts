import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import cases from './batch0/cases.json' with { type: 'json' };
import { auditSnapshot, digest, validateAuditUrl } from '../scripts/batch0/audit-model.js';
import { fixtureId, generateFixture } from '../scripts/batch0/fixture.js';
import { terminalLabelTimes as oracle } from './batch0/label-oracle.js';
import { terminalLabelTimes as current } from '../apps/server/src/terminal-label-history.js';

describe('Batch 0 audit tooling (not repair acceptance)', () => {
  it('generates deterministic multi-household fixtures with deep trees', () => {
    const s = generateFixture();
    expect(digest(s)).toBe(digest(generateFixture()));
    expect(s.items).toHaveLength(40);
    expect(s.events).toHaveLength(400);
    expect(s.notes).toHaveLength(40);
    expect(auditSnapshot(s)).toMatchObject({ errors: 0, reviews: 0, verdict: 'NO_FINDINGS' });
  });
  it('finds operation duplicates, absent IDs, orphan targets and cross-household references', () => {
    const s = generateFixture();
    s.operations.push({ ...s.operations[0] });
    s.operations[1].result_operation_id = 'invalid';
    s.events[0].operation_id = s.operations[10].result_operation_id;
    s.events[1].target_id = fixtureId('item', 2);
    const checks = auditSnapshot(s).findings.map((f) => f.check);
    expect(checks).toEqual(
      expect.arrayContaining([
        'DUPLICATE_OPERATION_ID',
        'INVALID_OPERATION_ID',
        'ORPHAN_EVENT_OPERATION',
        'ORPHAN_EVENT_TARGET',
      ]),
    );
  });
  it('terminates on cycles and rejects GROUP SKU references and incapable parents', () => {
    const s = generateFixture();
    s.items[0].parent_id = s.items[2].id; // item3 already has item1 as its parent.
    s.items[20].catalog_node_id = s.catalog_nodes.find(
      (r) => r.household_id === s.items[20].household_id && r.kind === 'GROUP',
    )!.id;
    s.items[22].parent_id = s.items[20].id;
    const checks = auditSnapshot(s).findings.map((f) => f.check);
    expect(checks.filter((c) => c === 'TREE_CYCLE')).toHaveLength(2);
    expect(checks).toEqual(
      expect.arrayContaining(['INVALID_SKU_REFERENCE', 'INVALID_PARENT_CAPABILITY']),
    );
  });
  it('reports invalid/duplicate/missing/unknown bindings without leaking payloads', () => {
    const s = generateFixture(),
      row = s.items[20];
    row.attributes[0].values = { state: 'PRIVATE_SECRET_123' };
    row.attributes.push({ ...row.attributes[0] });
    row.attributes.push({
      ...row.attributes[0],
      template_id: 'custom_unknown',
      values: { secret: 'PRIVATE_SECRET_456' },
    });
    const report = auditSnapshot(s),
      checks = report.findings.map((f) => f.check);
    expect(checks).toEqual(
      expect.arrayContaining([
        'INVALID_BINDING_VALUES',
        'DUPLICATE_BINDING',
        'UNREGISTERED_BINDING',
        'UNKNOWN_TEMPLATE',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('PRIVATE_SECRET');
  });
  it('checks timezone, template drift and unverified migration provenance', () => {
    const s = generateFixture();
    s.households[0].timezone = 'Invalid/Zone';
    s.attribute_templates[0].definition = {};
    s.migrations = [{ name: '001_initial.sql' }];
    expect(auditSnapshot(s).findings.map((f) => f.check)).toEqual(
      expect.arrayContaining([
        'INVALID_TIMEZONE',
        'TEMPLATE_DEFINITION_DRIFT',
        'MIGRATION_CHECKSUM_UNVERIFIED',
      ]),
    );
  });
  it('flags same-name SKUs for review without diagnosing them as invalid identities', () => {
    const s = generateFixture(),
      sku = s.catalog_nodes.find((r) => r.kind === 'SKU')!;
    s.catalog_nodes.push({ ...sku, id: fixtureId('catalog_node', 900) });
    const report = auditSnapshot(s);
    expect(report.errors).toBe(0);
    expect(report.findings.filter((f) => f.check === 'SIBLING_NAME_REVIEW')).toHaveLength(2);
  });
  it('checks barcode content/index mismatches and governance references', () => {
    const s = generateFixture(),
      sku = s.catalog_nodes.find((r) => r.kind === 'SKU')!;
    sku.attributes[0].values.barcodes = ['TEST-CODE'];
    s.catalog_identity_keys.push({
      household_id: sku.household_id,
      catalog_node_id: 'absent',
      policy_revision: 123,
    });
    expect(auditSnapshot(s).findings.map((f) => f.check)).toEqual(
      expect.arrayContaining([
        'BARCODE_INDEX_DRIFT',
        'INVALID_IDENTITY_TARGET',
        'INVALID_IDENTITY_POLICY',
      ]),
    );
  });
  it('does not mutate source data and compares real operation columns when supplied', () => {
    const s = generateFixture();
    s.operations[0].operation_id = fixtureId('operation', 8000);
    const before = digest(s);
    expect(auditSnapshot(s).findings.some((f) => f.check === 'OPERATION_ID_MISMATCH')).toBe(true);
    expect(digest(s)).toBe(before);
  });
  it('distinguishes an absent operation column from a NULL after expand', () => {
    const s = generateFixture();
    expect(auditSnapshot(s).errors).toBe(0);
    s.operations[0].operation_id_column_present = true;
    s.operations[0].operation_id = null;
    expect(auditSnapshot(s).findings.map((f) => f.check)).toContain('NULL_OPERATION_ID_COLUMN');
  });
  it('refuses production destinations, URL overrides and unguarded database names', () => {
    expect(validateAuditUrl('postgres://user@127.0.0.1:5432/acornary_audit_fixture').pathname).toBe(
      '/acornary_audit_fixture',
    );
    for (const url of [
      'postgres://host/acornary_audit_x',
      'postgres://localhost/acornary',
      'postgres://localhost/acornary_test',
      'postgres://localhost/acornary_audit_x?host=remote',
      'postgres://localhost/acornary_audit_x#fragment',
      'not a URL',
    ])
      expect(() => validateAuditUrl(url)).toThrow();
  });
});

describe('Frozen historical oracle (not replacement projection verification)', () => {
  it('pins the copied algorithm and documents the baseline source', () => {
    const provenance = JSON.parse(
      readFileSync('tests/batch0/label-oracle.provenance.json', 'utf8'),
    );
    expect(
      createHash('sha256').update(readFileSync('tests/batch0/label-oracle.ts')).digest('hex'),
    ).toBe(provenance.oracle_sha256);
    expect(provenance.source_commit).toMatch(/^[a-f0-9]{40}$/);
  });
  it('matches the current baseline algorithm on deterministic records', () => {
    const s = generateFixture();
    for (const household of s.households) {
      const data: any = {
        household,
        notes: [],
        container_catalog_id: '',
        cached_at: '',
        catalog: s.catalog_nodes.filter((r) => r.household_id === household.id),
        items: s.items.filter((r) => r.household_id === household.id),
      };
      const history: any = s.events.filter((e) => e.household_id === household.id);
      expect([...oracle(data, history)]).toEqual([...current(data, history)]);
    }
  });
  it('preserves fallback semantics and fans specification changes to 500 objects', () => {
    const created = '2026-10-01T00:00:00.000Z',
      changed = '2026-10-02T00:00:00.000Z';
    const catalog = [
      {
        id: 'sku',
        name: '牛奶',
        attributes: [{ template_id: 'product', values: { specification: '500 mL' } }],
      },
    ];
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `i${i}`,
      catalog_node_id: 'sku',
      display_name: i === 0 ? '' : i === 1 ? ' ' : i % 2 ? '自己的名称' : null,
      created_at: created,
      attributes: [],
    }));
    const event: any = {
      id: 'event',
      target_kind: 'CATALOG_NODE',
      target_id: 'sku',
      before_revision: 1,
      recorded_at: changed,
      changes: [{ path: 'name', before: '旧名', after: '牛奶' }],
    };
    const names = oracle({ catalog, items }, [event]);
    expect(names.get('i0')).toBe(changed);
    expect(names.get('i1')).toBe(created);
    event.changes = [
      { path: 'attributes.product.specification', before: '250 mL', after: '500 mL' },
    ];
    expect(new Set(oracle({ catalog, items }, [event]).values())).toEqual(new Set([changed]));
  });
});

describe('Evidence inventory integrity', () => {
  it('keeps not-run cases evidence-free and requires evidence for pass/partial', () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(['NOT_RUN', 'PASS', 'PARTIAL']).toContain(c.status);
      if (c.status === 'NOT_RUN') expect(c.evidence).toEqual([]);
      else {
        expect(Array.isArray(c.evidence)).toBe(true);
        expect(c.evidence.length).toBeGreaterThan(0);
      }
      expect(c.acceptance.length).toBeGreaterThan(20);
    }
    for (const group of ['OP', 'TREE', 'SYNC', 'QUERY', 'LABEL', 'MODEL', 'FILE', 'OPS'])
      expect(cases.some((c) => c.id.startsWith(group))).toBe(true);
  });
  it('tracks all 44 findings and the specified evidence columns', () => {
    const csv = readFileSync('docs/data-model-findings.csv', 'utf8');
    expect([...csv.matchAll(/^(D\d{2}|S\d{2}),/gm)]).toHaveLength(44);
    for (const col of [
      'decision',
      'decision_reason',
      'implementation_batch',
      'acceptance_cases',
      'migration_pr',
      'exercise_evidence',
      'status',
    ])
      expect(csv.split(/\r?\n/)[0].split(',')).toContain(col);
    const ids = new Set(cases.map((c) => c.id));
    for (const match of csv.matchAll(/\b(?:OP|TREE|SYNC|QUERY|LABEL|MODEL|FILE|OPS)\d{2}\b/g))
      expect(ids.has(match[0])).toBe(true);
  });
});

describe('Future repair acceptance — NOT_RUN, never counted as passed', () => {
  for (const c of cases) it.todo(`${c.id} · ${c.title}`);
});
