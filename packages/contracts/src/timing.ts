export interface TimingSample {
  tool: string;
  write: boolean;
  batch_size: number;
  first_call: boolean;
  duration_ms: number;
  outcome: string;
  server_duration_ms?: number;
  request_id?: string;
  transport?: string;
}
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
};
export function summarizeTimings(samples: TimingSample[]) {
  const groups = new Map<string, TimingSample[]>();
  for (const s of samples) {
    const key = JSON.stringify([s.transport, s.tool, s.write, s.batch_size, s.first_call]);
    const group = groups.get(key) ?? [];
    group.push(s);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const first = group[0];
    const e2e = group.map((s) => s.duration_ms);
    const server = group.flatMap((s) =>
      typeof s.server_duration_ms === 'number' ? [s.server_duration_ms] : [],
    );
    return {
      transport: first.transport,
      tool: first.tool,
      write: first.write,
      batch_size: first.batch_size,
      first_call: first.first_call,
      samples: group.length,
      errors: group.filter((s) => s.outcome !== 'SUCCESS').length,
      error_rate: group.filter((s) => s.outcome !== 'SUCCESS').length / group.length,
      e2e_ms: { p50: percentile(e2e, 0.5), p95: percentile(e2e, 0.95) },
      server_ms: {
        samples: server.length,
        p50: percentile(server, 0.5),
        p95: percentile(server, 0.95),
      },
    };
  });
}
