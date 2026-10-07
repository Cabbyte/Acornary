// Disposable demonstration data only. Never reads .env or attaches an existing database.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
process.chdir(resolve(import.meta.dirname, '..'));
const directory = resolve('.local/ui-preview');
const stateFile = resolve(directory, 'state.json');
const action = process.argv[2] ?? 'start';
const run = (command, args, env = process.env) => {
  const r = spawnSync(command, args, {
    env,
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`${command} ${args[0]}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
};
const docker = (args, env) => run('docker', args, env);
const existing = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
if (action === 'stop') {
  if (existing) {
    for (const name of [existing.worker, existing.postgres]) docker(['rm', '-f', name]);
    docker(['network', 'rm', existing.network]);
    rmSync(directory, { recursive: true, force: true });
  }
  console.log('Preview containers and demonstration database removed.');
} else if (action === 'status') {
  console.log(
    existing ? docker(['ps', '-a', '--filter', `network=${existing.network}`]) : 'No UI preview.',
  );
} else if (action === 'start') {
  if (existing) {
    for (const name of [existing.postgres, existing.worker]) docker(['start', name]);
    const probe = spawnSync(
      'docker',
      [
        'exec',
        existing.worker,
        'node',
        '-e',
        "require('node:https').get('https://localhost:3210/health',{rejectUnauthorized:false},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))",
      ],
      { stdio: 'ignore' },
    );
    if (probe.status !== 0) {
      docker([
        'exec',
        '-d',
        existing.worker,
        'sh',
        '-c',
        'pnpm exec tsx tests/cloud-browser-server.ts > /tmp/preview-web.log 2>&1',
      ]);
      docker([
        'exec',
        '-d',
        existing.worker,
        'sh',
        '-c',
        'pnpm exec tsx tests/plugin-browser-server.ts > /tmp/preview-mcp.log 2>&1',
      ]);
    }
    console.log('Preview already exists: https://localhost:3210');
    process.exit(0);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const suffix = Date.now(),
    network = `acornary-preview-${suffix}`,
    postgres = `${network}-pg`,
    worker = `${network}-app`,
    database = `acornary_e2e_${suffix}`;
  const image = process.env.ACORNARY_PREVIEW_IMAGE ?? 'acornary-ui-preview';
  if (!process.env.ACORNARY_PREVIEW_IMAGE) {
    console.log('Building preview runtime…');
    docker(['build', '--target', 'base', '-t', image, '.']);
  }
  const env = { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString('hex') };
  env.DATABASE_URL = `postgres://acornary:${env.POSTGRES_PASSWORD}@${postgres}:5432/${database}`;
  writeFileSync(stateFile, JSON.stringify({ network, postgres, worker }), { mode: 0o600 });
  try {
    docker(['network', 'create', network]);
    docker(
      [
        'run',
        '-d',
        '--name',
        postgres,
        '--network',
        network,
        '-e',
        'POSTGRES_PASSWORD',
        '-e',
        'POSTGRES_USER=acornary',
        '-e',
        `POSTGRES_DB=${database}`,
        'postgres:18-bookworm',
      ],
      env,
    );
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (
        spawnSync('docker', ['exec', postgres, 'pg_isready', '-U', 'acornary'], { stdio: 'ignore' })
          .status === 0
      ) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Preview PostgreSQL did not start');
    run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${directory}/key.pem`,
      '-out',
      `${directory}/cert.pem`,
      '-days',
      '7',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ]);
    docker(
      [
        'run',
        '-d',
        '--name',
        worker,
        '--network',
        network,
        '-p',
        '127.0.0.1:3210:3210',
        '-p',
        '127.0.0.1:3212:3212',
        '-e',
        'DATABASE_URL',
        '-e',
        'ACORNARY_TEST_TLS_DIR=/tmp',
        image,
        'node',
        '-e',
        'setInterval(()=>{},10000)',
      ],
      env,
    );
    docker(['cp', `${directory}/cert.pem`, `${worker}:/tmp/cert.pem`]);
    docker(['cp', `${directory}/key.pem`, `${worker}:/tmp/key.pem`]);
    console.log('Building Web and MCP, then seeding demonstration inventory…');
    docker(['exec', worker, 'pnpm', 'build']);
    docker(['exec', worker, 'pnpm', 'exec', 'tsx', 'tests/seed-browser.ts']);
    docker([
      'exec',
      '-d',
      worker,
      'sh',
      '-c',
      'pnpm exec tsx tests/cloud-browser-server.ts > /tmp/preview-web.log 2>&1',
    ]);
    // The test host is loopback-only by default. Expose it only inside this disposable container;
    // Docker still publishes its port on the host loopback interface exclusively.
    docker([
      'exec',
      worker,
      'node',
      '-e',
      `const fs=require('node:fs');const p='tests/plugin-browser-server.ts';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(".listen(3212, '127.0.0.1')", ".listen(3212, '0.0.0.0')"))`,
    ]);
    docker([
      'exec',
      '-d',
      worker,
      'sh',
      '-c',
      'pnpm exec tsx tests/plugin-browser-server.ts > /tmp/preview-mcp.log 2>&1',
    ]);
    docker([
      'exec',
      worker,
      'node',
      '-e',
      `const https=require('node:https');let n=0;function probe(){https.get('https://localhost:3210/health',{rejectUnauthorized:false},r=>{r.resume();if(r.statusCode===200)process.exit(0);retry()}).on('error',retry)}function retry(){if(++n>60)process.exit(1);setTimeout(probe,500)}probe()`,
    ]);
    console.log(
      'Web: https://localhost:3210\nMCP sandbox: http://localhost:3212\nDemo sign-in: browser@example.test / Browser-test-password-123!\nSelf-signed certificate for local preview only. Stop: node scripts/ui-preview.mjs stop',
    );
  } catch (error) {
    for (const name of [worker, postgres])
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
} else throw new Error('Usage: node scripts/ui-preview.mjs start|status|stop');
