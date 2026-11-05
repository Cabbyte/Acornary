import worker from '../../apps/cloudflare/src/worker.js';
import type { Env } from '../../apps/cloudflare/src/environment.js';
export { HouseholdStore } from '../../apps/cloudflare/src/household-store.js';
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return worker.fetch(request, env, ctx);
  },
};
