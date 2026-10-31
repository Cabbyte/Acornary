// Local Batch 0 verification. Only disposable Docker containers; no SSH or deployment.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const id = randomUUID().slice(0, 8);
const output = resolve(
  'output/repair-batch0',
  `${new Date().toISOString().replaceAll(':', '-')}-${id}`,
);
const stage = mkdtempSync(join(tmpdir(), 'acornary-batch0-'));
const pgName = `acornary-batch0-pg-${id}`,
  worker = `acornary-batch0-node-${id}`;
const nodeImage = process.env.BATCH0_NODE_IMAGE || 'acornary-batch0-dependencies:local';
const pgImage = process.env.BATCH0_POSTGRES_IMAGE || 'postgres:18-bookworm';
mkdirSync(output, { recursive: true, mode: 0o700 });
const steps = [];
let count = 0,
  workerReady = false,
  copied = false;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(label, args, { timeout = 240000, allowFailure = false } = {}) {
  const started = new Date().toISOString();
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  const file = `${String(++count).padStart(2, '0')}-${label}.log`;
  writeFileSync(
    join(output, file),
    (result.stdout || '') + (result.stderr || '') + (result.error ? String(result.error) : ''),
    { mode: 0o600 },
  );
  steps.push({ label, started, exit_code: result.status, log: file });
  if (result.status !== 0 && !allowFailure)
    throw new Error(`${label} failed; see ${join(output, file)}`);
  return (result.stdout || '').trim();
}
const exec = (label, args, env = {}) =>
  run(label, [
    'exec',
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    worker,
    ...args,
  ]);
const url = (db) => `postgres://acornary_test@127.0.0.1:5432/${db}`;
const audit = (db, folder, source) =>
  exec(
    `audit-${folder}`,
    [
      'pnpm',
      'exec',
      'tsx',
      'scripts/batch0/audit.ts',
      '--source',
      source,
      '--output',
      `/app/output/${folder}`,
    ],
    { BATCH0_AUDIT_DATABASE_URL: url(db) },
  );
function copyEvidence() {
  if (!workerReady || copied) return;
  run('copy-evidence', ['cp', `${worker}:/app/output`, join(output, 'artifacts')], {
    allowFailure: true,
  });
  copied = true;
}
let status = 'FAILED',
  failure;
try {
  // Reusable default image contains dependencies only. An existing local image may be supplied;
  // its lockfile must match, and all source roots below replace its potentially stale sources.
  if (!process.env.BATCH0_NODE_IMAGE)
    run('build-dependencies', ['build', '--target', 'dependencies', '-t', nodeImage, '.'], {
      timeout: 600000,
    });
  const imageLock = run('dependency-lock', [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'cat',
    nodeImage,
    '/app/pnpm-lock.yaml',
  ]);
  if (imageLock !== readFileSync('pnpm-lock.yaml', 'utf8').trim())
    throw new Error('Dependency image lockfile differs from workspace.');
  const versions = run('node-version', [
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'node',
    nodeImage,
    '--version',
  ]);
  if (!versions.startsWith('v24.')) throw new Error('Batch 0 requires Node 24.');
  run('postgres-start', [
    'run',
    '-d',
    '--name',
    pgName,
    '--network',
    'none',
    '-e',
    'POSTGRES_USER=acornary_test',
    '-e',
    'POSTGRES_DB=acornary_audit_fixture',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    pgImage,
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      spawnSync('docker', ['exec', pgName, 'pg_isready', '-U', 'acornary_test'], {
        timeout: 5000,
        stdio: 'ignore',
      }).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Disposable PostgreSQL failed readiness.');
  const pgVersion = run('postgres-version', ['exec', pgName, 'postgres', '--version']);
  if (!pgVersion.includes('18.')) throw new Error('Batch 0 reference tests require PostgreSQL 18.');
  run('worker-start', [
    'run',
    '-d',
    '--name',
    worker,
    '--network',
    `container:${pgName}`,
    '--entrypoint',
    'node',
    nodeImage,
    '-e',
    'setInterval(()=>{},1000)',
  ]);
  workerReady = true;
  const roots = [
    'apps/server',
    'apps/web',
    'packages',
    'tests',
    'scripts',
    'migrations',
    'docs',
    'deploy',
    'assets',
    'plugin',
  ];
  for (const path of roots)
    cpSync(resolve(path), join(stage, path), {
      recursive: true,
      filter: (path) => !['node_modules', 'dist', '.DS_Store'].includes(basename(path)),
    });
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'tsconfig.build.json',
    'vitest.config.ts',
  ])
    cpSync(file, join(stage, file));
  const sources = {};
  function inventory(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix + entry.name,
        path = join(dir, entry.name);
      if (entry.isDirectory()) inventory(path, relative + '/');
      else if (entry.isFile()) sources[relative] = hash(readFileSync(path));
    }
  }
  inventory(stage);
  writeFileSync(join(output, 'source-manifest.json'), JSON.stringify(sources, null, 2) + '\n', {
    mode: 0o600,
  });
  exec('clear-image-sources', ['rm', '-rf', ...roots, 'output']);
  run('copy-current-sources', ['cp', `${stage}/.`, `${worker}:/app`]);
  exec('typecheck', ['pnpm', 'run', 'typecheck']);
  exec('unit-tests', [
    'pnpm',
    'exec',
    'vitest',
    'run',
    'tests/repair-batch0.test.ts',
    'tests/terminal-label-history.test.ts',
  ]);
  run('create-regression-db', ['exec', pgName, 'createdb', '-U', 'acornary_test', 'acornary_test']);
  exec('build-current-ui', ['pnpm', 'build']);
  exec('regression-tests', ['pnpm', 'test'], {
    DATABASE_URL: url('acornary_test'),
    ACORNARY_MODE: 'local',
  });
  exec('seed-small', ['pnpm', 'exec', 'tsx', 'scripts/batch0/seed.ts', 'small'], {
    BATCH0_TEST_DATABASE_URL: url('acornary_audit_fixture'),
  });
  exec(
    'postgres-reference-tests',
    ['pnpm', 'exec', 'vitest', 'run', '--config', 'tests/batch0/vitest.config.ts'],
    { BATCH0_TEST_DATABASE_URL: url('acornary_audit_fixture') },
  );
  audit('acornary_audit_fixture', 'small', 'synthetic_fixture');
  exec('generate-performance', [
    'pnpm',
    'exec',
    'tsx',
    'scripts/batch0/generate.ts',
    'performance',
    '--output',
    '/app/output/generated',
  ]);
  run('create-performance-db', [
    'exec',
    pgName,
    'createdb',
    '-U',
    'acornary_test',
    'acornary_audit_performance',
  ]);
  exec('seed-performance', ['pnpm', 'exec', 'tsx', 'scripts/batch0/seed.ts', 'performance'], {
    BATCH0_TEST_DATABASE_URL: url('acornary_audit_performance'),
  });
  audit('acornary_audit_performance', 'performance', 'synthetic_fixture');
  run('dump-synthetic', [
    'exec',
    pgName,
    'pg_dump',
    '-U',
    'acornary_test',
    '-Fc',
    '-f',
    '/tmp/batch0.dump',
    'acornary_audit_performance',
  ]);
  run('create-restore-db', [
    'exec',
    pgName,
    'createdb',
    '-U',
    'acornary_test',
    'acornary_audit_restored',
  ]);
  run('restore-synthetic', [
    'exec',
    pgName,
    'pg_restore',
    '-U',
    'acornary_test',
    '--exit-on-error',
    '-d',
    'acornary_audit_restored',
    '/tmp/batch0.dump',
  ]);
  audit('acornary_audit_restored', 'restored', 'restored_copy');
  copyEvidence();
  const original = JSON.parse(readFileSync(join(output, 'artifacts/performance/audit.json')));
  const restored = JSON.parse(readFileSync(join(output, 'artifacts/restored/audit.json')));
  if (
    original.audited_projection_sha256 !== restored.audited_projection_sha256 ||
    original.label_oracle.sha256 !== restored.label_oracle.sha256
  )
    throw new Error(
      'Synthetic restore differs from pre-backup audited projection or label baseline.',
    );
  writeFileSync(
    join(output, 'restore-comparison.json'),
    JSON.stringify(
      {
        status: 'PASS',
        source: 'synthetic_fixture',
        audited_projection_sha256: original.audited_projection_sha256,
        label_baseline_sha256: original.label_oracle.sha256,
        full_database_comparison: 'NOT_RUN',
        attachments_and_restic: 'NOT_RUN',
        production_evidence: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  status = 'PASS';
} catch (error) {
  failure = String(error);
  console.error(failure);
  process.exitCode = 1;
} finally {
  copyEvidence();
  run('cleanup-worker', ['rm', '-f', '-v', worker], { allowFailure: true });
  run('cleanup-postgres', ['rm', '-f', '-v', pgName], { allowFailure: true });
  rmSync(stage, { recursive: true, force: true });
  writeFileSync(
    join(output, 'run.json'),
    JSON.stringify(
      {
        status,
        failure,
        source_commit: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
        lockfile_sha256: hash(readFileSync('pnpm-lock.yaml')),
        node_image: nodeImage,
        postgres_image: pgImage,
        production_audit: 'DEFERRED_BY_USER',
        repair_acceptance: 'NOT_RUN',
        performance_benchmark: 'NOT_RUN',
        steps,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  chmodSync(output, 0o700);
  console.log(JSON.stringify({ status, output }));
}
