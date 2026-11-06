import { traces } from './inventory/telemetry.js';
import type { Env } from './environment.js';
import { household } from './environment.js';
import type { HouseholdIdentity } from './household-store.js';
import { DomainError } from '../../../packages/domain/src/index.js';
export type BusinessContext = HouseholdIdentity & { env: Env };
export async function invoke(
  ctx: BusinessContext,
  action: string,
  input: unknown = {},
): Promise<any> {
  const { env, ...identity } = ctx;
  const response = JSON.parse(
    await household(env, ctx.household_id).rpc(identity, action, JSON.stringify(input)),
  );
  const trace = traces.getStore();
  if (trace && response.trace) {
    trace.phases.do_ms = (trace.phases.do_ms ?? 0) + (response.trace.server_duration_ms ?? 0);
    trace.operation_id = response.trace.operation_id ?? trace.operation_id;
    trace.tool = response.trace.tool ?? trace.tool;
    trace.idempotency_replay = response.trace.idempotency_replay || trace.idempotency_replay;
  }
  if (response.error)
    throw new DomainError(response.error.code, response.error.message, response.error.details);
  return response.data;
}
export const execute = (ctx: BusinessContext, name: string, input: unknown) =>
  invoke(ctx, 'command', { name, input });
export const webSnapshotV2 = (ctx: BusinessContext) => invoke(ctx, 'snapshot');
export const reviewCatalogProposal = (ctx: BusinessContext, scope: string, input: unknown) =>
  invoke(ctx, 'review', { scope, input });
export const confirmCatalogProposal = (ctx: BusinessContext, scope: string, input: unknown) =>
  invoke(ctx, 'confirm', { scope, input });
