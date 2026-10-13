// Service-only repeatable probe. This cannot measure ChatGPT voice latency or semantic stability.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { initialize } from '../apps/server/src/initialize.js';
import { execute } from '../apps/server/src/service.js';
import { pool } from '../apps/server/src/db.js';
const candidate = process.argv[2] === 'candidate';
if (!process.env.DATABASE_URL?.includes('acornary_test'))
  throw new Error('Disposable test database required');
const installation = await initialize();
const ctx = { ...installation, source: 'BENCHMARK' };
const key = () => randomUUID();
const write = (name: any, input: any) => execute(ctx, name, { idempotency_key: key(), ...input });
const setup = async (input: any) =>
  candidate
    ? (await import('../tests/catalog-helpers.js')).approvedExecute(ctx, 'create_catalog_node', {
        idempotency_key: key(),
        ...input,
      })
    : write('create_catalog_node', input);
const attribute = (template_id: string, values: any) => ({
  template_id,
  template_version: 1,
  values,
});
try {
  const branch = (await setup({ kind: 'GROUP', name: '食品' })).affected_objects[0].id;
  const sku = (await setup({ kind: 'SKU', name: '已有饮品', parent_id: branch }))
    .affected_objects[0].id;
  const place = (
    await write('create_items', {
      catalog_node_id: installation.container_catalog_id,
      count: 1,
      display_name: '厨房',
      initial_attributes: [attribute('container', { can_contain: true })],
    })
  ).affected_objects[0].id;
  if (candidate) {
    const intake = await import('../apps/server/src/intake.js');
    const proposal = await write('propose_catalog_change', {
      proposal: {
        kind: 'policy',
        policy_revision: 0,
        expected_revisions: { [branch]: 1 },
        rule: {
          branch_id: branch,
          meaning: '食用食品',
          boundaries: '不含餐具',
          subdivision_basis: '食品类型',
          allow_direct_products: true,
          allow_new_groups: true,
          max_new_depth: 2,
          naming_guidance: '食品名称',
        },
        reason: 'Service probe fixture',
      },
    });
    const review = await intake.reviewCatalogProposal(ctx, 'bench-ui', {
      proposal_id: proposal.proposal_id,
    });
    await intake.confirmCatalogProposal(ctx, 'bench-ui', {
      proposal_id: proposal.proposal_id,
      challenge: review.challenge,
    });
  }
  const samples: any[] = [];
  for (const scenario of ['restock', 'new_product', 'new_group'])
    for (let i = -2; i < 20; i++) {
      let calls = 0;
      const start = performance.now();
      const call = (name: any, input: any) => {
        calls++;
        return execute(ctx, name, input);
      };
      const name = `测试食品 ${scenario} ${i}`;
      let count: number;
      if (candidate) {
        const context = await call('get_intake_context', {
          names: [name],
          catalog_node_ids: [branch, sku],
          location_ids: [place],
        });
        const result = await call('commit_intake', {
          idempotency_key: key(),
          policy_revision: context.policy_revision,
          expected_revisions: context.expected_revisions,
          defaults: { parent_id: place },
          lines: [
            {
              product:
                scenario === 'restock'
                  ? { catalog_node_id: sku }
                  : {
                      name,
                      parent_id: branch,
                      initial_attributes: [attribute('product', { specification: '测试规格' })],
                      new_groups: scenario === 'new_group' ? [`食物类型 ${i}`] : [],
                      classification_reason: '食品分支',
                    },
              instances: [{ count: 2 }],
            },
          ],
        });
        count = result.receipt.item_count;
      } else {
        await call('query_catalog_nodes', { name: scenario === 'restock' ? '已有饮品' : name });
        await call('get_item', { item_id: place });
        let parent_id = branch,
          productId = sku;
        if (scenario === 'new_group')
          parent_id = (
            await call('create_catalog_node', {
              kind: 'GROUP',
              name: `食物类型 ${i}`,
              parent_id,
              idempotency_key: key(),
            })
          ).affected_objects[0].id;
        if (scenario !== 'restock')
          productId = (
            await call('create_catalog_node', {
              kind: 'SKU',
              name,
              parent_id,
              initial_attributes: [attribute('product', { specification: '测试规格' })],
              idempotency_key: key(),
            })
          ).affected_objects[0].id;
        const result = await call('create_items', {
          catalog_node_id: productId,
          parent_id: place,
          count: 2,
          idempotency_key: key(),
        });
        count = result.affected_objects.length;
        // The original affected objects already establish the actual created count.
      }
      if (count !== 2) throw new Error('Incomplete intake cannot count as a successful sample');
      if (i >= 0)
        samples.push({
          scenario,
          sample: i + 1,
          duration_ms: performance.now() - start,
          tool_calls: calls,
          success: true,
        });
    }
  const percentile = (a: number[], p: number) =>
    [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
  const summary = Object.fromEntries(
    ['restock', 'new_product', 'new_group'].map((scenario) => {
      const rows = samples.filter((r) => r.scenario === scenario);
      return [
        scenario,
        {
          n: rows.length,
          success_rate: 1,
          median_ms: percentile(
            rows.map((r) => r.duration_ms),
            0.5,
          ),
          p90_ms: percentile(
            rows.map((r) => r.duration_ms),
            0.9,
          ),
          tool_calls: rows[0].tool_calls,
        },
      ];
    }),
  );
  console.log(
    JSON.stringify(
      {
        scope:
          'synthetic service only; no model, voice, user clarification or platform approval time',
        variant: candidate ? 'candidate' : 'main@b3d2463',
        node: process.version,
        conditions: { samples_per_path: 20, warmups_per_path: 2, physical_items_per_task: 2 },
        summary,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
