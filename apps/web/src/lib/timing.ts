import { reads, type Operation } from '../../../../packages/contracts/src/index.js';
import { summarizeTimings, type TimingSample } from '../../../../packages/contracts/src/timing.js';
export type CallTiming = TimingSample & { transport: 'HTTP' | 'MCP_UI' };
let startedCalls = 0;
const samples: CallTiming[] = [];
export const callTimingSummary = () => summarizeTimings(samples);
export const callTimingSamples = () => samples.map((s) => ({ ...s }));
export function beginCall(transport: CallTiming['transport'], tool: string, input?: any) {
  const started = performance.now();
  const actual = tool === 'apply_inventory_command' ? (input?.operation ?? tool) : tool;
  const args = tool === 'apply_inventory_command' ? input?.input : input;
  const sample: CallTiming = {
    transport,
    tool: actual,
    write:
      !reads.has(actual as Operation) && !['open_inventory', 'get_inventory_view'].includes(actual),
    batch_size: args?.items?.length ?? args?.item_ids?.length ?? args?.count ?? 1,
    first_call: startedCalls++ === 0,
    duration_ms: 0,
    outcome: 'UNKNOWN',
  };
  return {
    sample,
    finish(outcome: string) {
      sample.duration_ms = performance.now() - started;
      sample.outcome = outcome;
      samples.push(sample);
      if (samples.length > 500) samples.shift();
      if (typeof window !== 'undefined')
        window.dispatchEvent(new CustomEvent('acornary-call-timing', { detail: { ...sample } }));
    },
  };
}
