import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const suffix = Date.now();
const network = `intake-bench-${suffix}`,
  pg = `${network}-pg`;
const env = { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString('hex') };
const run = (args) => {
  const r = spawnSync('docker', args, { env, encoding: 'utf8' });
  if (r.status) throw new Error(r.stderr || r.stdout);
  return r.stdout;
};
try {
  run(['network', 'create', network]);
  run([
    'run',
    '-d',
    '--name',
    pg,
    '--network',
    network,
    '-e',
    'POSTGRES_PASSWORD',
    '-e',
    'POSTGRES_USER=acornary',
    '-e',
    'POSTGRES_DB=acornary_test',
    'postgres:18-bookworm',
  ]);
  for (let n = 0; n < 60; n++) {
    if (
      spawnSync('docker', ['exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'acornary'])
        .status === 0
    )
      break;
    await new Promise((r) => setTimeout(r, 500));
  }
  mkdirSync('output/intake-benchmark', { recursive: true });
  for (const variant of ['baseline', 'candidate']) {
    const db = `acornary_test_${variant}`;
    run(['exec', pg, 'createdb', '-U', 'acornary', db]);
    env.DATABASE_URL = `postgres://acornary:${env.POSTGRES_PASSWORD}@${pg}:5432/${db}`;
    const output = run([
      'run',
      '--rm',
      '--network',
      network,
      '-e',
      'DATABASE_URL',
      '-v',
      `${resolve('scripts/intake-benchmark.ts')}:/app/scripts/intake-benchmark.ts:ro`,
      `acornary-intake-${variant}`,
      'pnpm',
      'exec',
      'tsx',
      'scripts/intake-benchmark.ts',
      variant,
    ]);
    const result = JSON.parse(output);
    writeFileSync(
      `output/intake-benchmark/${variant}.json`,
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify({ variant, summary: result.summary }));
  }
} finally {
  spawnSync('docker', ['rm', '-f', pg]);
  spawnSync('docker', ['network', 'rm', network]);
}
