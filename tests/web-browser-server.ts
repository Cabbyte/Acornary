import { initialize } from '../apps/server/src/initialize.js';
import { buildApp } from '../apps/server/src/app.js';
if (!process.env.DATABASE_URL?.match(/\/acornary_e2e_\d+$/))
  throw new Error('Isolated E2E database required.');
const app = await buildApp(
  { ...(await initialize()), source: 'E2E' },
  'isolated-browser-test-token-only-32-chars',
  true,
  { mode: 'local' },
);
await app.listen({ host: '0.0.0.0', port: 3210 });
