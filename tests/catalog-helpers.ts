// Test fixtures exercise the real proposal/challenge/confirmation boundary; no production bypass.
import { randomUUID } from 'node:crypto';
import { execute, type Context } from '../apps/server/src/service.js';
import { reviewCatalogProposal, confirmCatalogProposal } from '../apps/server/src/intake.js';
import type { Operation } from '../packages/contracts/src/index.js';
const approvals = new Map<string, string>();
export async function approvedInput(ctx: Context, operation: Operation, input: any) {
  const key = `${ctx.household_id}:${ctx.actor_id}:${operation}:${input.idempotency_key}`;
  let approval_id = approvals.get(key);
  if (!approval_id) {
    const result = await execute(ctx, 'propose_catalog_change', {
      idempotency_key: randomUUID(),
      proposal: {
        kind: 'catalog_command',
        operation,
        input,
        reason: 'Explicit synthetic fixture governance',
      },
    });
    const review = await reviewCatalogProposal(ctx, 'isolated-test-ui', {
      proposal_id: result.proposal_id,
    });
    const confirmed = await confirmCatalogProposal(ctx, 'isolated-test-ui', {
      proposal_id: result.proposal_id,
      challenge: review.challenge,
    });
    approval_id = confirmed.approval_id;
    approvals.set(key, approval_id!);
  }
  return { ...input, approval_id };
}
export async function approvedExecute(ctx: Context, operation: Operation, input: any) {
  const key = `${ctx.household_id}:${ctx.actor_id}:${operation}:${input.idempotency_key}`;
  if (approvals.has(key))
    return execute(ctx, operation, { ...input, approval_id: approvals.get(key) });
  try {
    return await execute(ctx, operation, input);
  } catch (e: any) {
    if (e.code !== 'APPROVAL_REQUIRED') throw e;
    return execute(ctx, operation, await approvedInput(ctx, operation, input));
  }
}
