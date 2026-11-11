import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const { values } = parseArgs({
  options: { environment: { type: 'string' }, ui: { type: 'string', default: 'legacy' } },
});
if (!['preview', 'production'].includes(values.environment))
  throw new Error('Explicit --environment preview|production required');
if (!['legacy', 'candidate'].includes(values.ui)) throw new Error('Expected --ui legacy|candidate');
const run = promisify(execFile);
if (values.ui === 'candidate') {
  // Build-only artifact, outside Worker ASSETS. Existing release path stays legacy.
  const child = run(
    'pnpm',
    ['exec', 'vite', 'build', '--config', 'apps/web/vite.candidate.config.ts'],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  child.child.stdout.pipe(process.stdout);
  child.child.stderr.pipe(process.stderr);
  await child;
  console.log('Candidate library built in output/ui-candidate; deployment assets unchanged.');
  process.exit(0);
}
for (const config of ['apps/web/vite.config.ts', 'apps/web/vite.plugin.config.ts']) {
  const child = run('pnpm', ['exec', 'vite', 'build', '--config', config], {
    env: { ...process.env, VITE_ACORNARY_ENV: values.environment },
    maxBuffer: 8 * 1024 * 1024,
  });
  child.child.stdout.pipe(process.stdout);
  child.child.stderr.pipe(process.stderr);
  await child;
}
if (values.environment === 'preview') {
  const path = 'apps/web/dist/manifest.webmanifest',
    manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.name = '松仓 · Cloudflare 测试版';
  manifest.short_name = '松仓 CF 测试';
  await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  const index = 'apps/web/dist/index.html';
  let html = await readFile(index, 'utf8');
  html = html
    .replace('<title>Acornary · 松仓</title>', '<title>松仓 · Cloudflare 测试版</title>')
    .replace(
      'name="apple-mobile-web-app-title" content="松仓"',
      'name="apple-mobile-web-app-title" content="松仓 CF 测试"',
    );
  await writeFile(index, html);
}
