import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DomainError } from '../../../packages/domain/src/index.js';
import { errorRecovery } from '../../../packages/contracts/src/errors.js';

export type Phase = 'auth_ms' | 'pool_wait_ms' | 'lock_wait_ms' | 'db_ms' | 'business_ms';
export type Trace = {
  request_id: string;
  server_origin?: string;
  auth_started?: number;
  started: number;
  phases: Partial<Record<Phase, number>>;
  tool?: string;
  operation_id?: string;
  idempotency_replay?: boolean;
  batch_size?: number;
  outcome?: string;
};
const serverInstanceId = randomUUID();
export const traces = new AsyncLocalStorage<Trace>();
export const newTrace = (): Trace => ({
  request_id: randomUUID(),
  started: performance.now(),
  phases: {},
});
export async function timed<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
  const trace = traces.getStore(),
    start = performance.now();
  try {
    return await fn();
  } finally {
    if (trace) trace.phases[phase] = (trace.phases[phase] ?? 0) + performance.now() - start;
  }
}
export function traceMetadata(trace = traces.getStore()) {
  if (!trace) return {};
  return {
    request_id: trace.request_id,
    server_instance_id: serverInstanceId,
    process_uptime_ms: process.uptime() * 1000,
    server_duration_ms: performance.now() - trace.started,
    ...trace.phases,
    tool: trace.tool,
    operation_id: trace.operation_id,
    idempotency_replay: trace.idempotency_replay ?? false,
    batch_size: trace.batch_size,
    outcome: trace.outcome,
  };
}
export function failure(error: unknown) {
  const domain = error instanceof DomainError;
  const code = domain ? error.code : 'INTERNAL_ERROR';
  const trace = traces.getStore();
  if (trace) trace.outcome = code;
  return {
    code,
    message: domain
      ? error.message
      : 'Request failed; retry the original request and idempotency key.',
    ...(domain && error.details !== undefined ? { details: error.details } : {}),
    request_id: trace?.request_id ?? randomUUID(),
    recovery: errorRecovery(code),
  };
}
