// Dedicated synthetic databases for suites with explicit isolation contracts.
import pg from 'pg';
import { spawnSync } from 'node:child_process';
const base = new URL(process.env.DATABASE_URL ?? '');
if (base.pathname !== '/acornary_test') throw new Error('Requires isolated acornary_test source');
const admin = new pg.Pool({ connectionString: base.toString(), max: 1 });
const groups = [
  ['acornary_test_model_v2', 'tests/batch{1,2,3,5}/**/*.test.ts'],
  ['acornary_test_w2_registry', 'tests/batch4/**/*.test.ts'],
  ['acornary_test_w3_semantics', 'tests/batch6/**/*.test.ts'],
  ['acornary_test_w2_files', 'tests/batch7/notes-attachments.test.ts'],
  ['acornary_test_w5_export', 'tests/batch7/export.test.ts'],
  ['acornary_test_w4_hardening', 'tests/batch8/**/*.test.ts'],
];
function run(command, args, env) {
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0)
    throw new Error(`${command} failed; retained isolated databases for diagnosis`);
}
try {
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='acornary_app'")).rowCount)
    await admin.query('CREATE ROLE acornary_app NOLOGIN');
  // Never drop or reuse a database from another invocation.
  for (const [name] of groups) {
    if ((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
      throw new Error(`Isolated database already exists: ${name}; use a fresh test PostgreSQL`);
  }
  for (const [name, glob] of groups) {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = '/' + name;
    const env = { ...process.env, DATABASE_URL: url.toString(), ACORNARY_MODEL_TEST_GLOB: glob };
    run('./node_modules/.bin/tsx', ['apps/server/src/migrate.ts', '--grants'], env);
    run(
      './node_modules/.bin/vitest',
      ['run', '--config', 'vitest.model-v2.config.ts', '--reporter=dot', '--silent'],
      env,
    );
  }
} finally {
  await admin.end();
}
