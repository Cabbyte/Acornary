import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
const root = resolve('.'),
  seen = new Set();
function walk(file) {
  file = resolve(file);
  if (seen.has(file)) return;
  seen.add(file);
  if (/[/\\](review|\.storybook|fixtures)[/\\]/.test(file))
    throw Error(`Preview reached from production: ${relative(root, file)}`);
  const content = readFileSync(file, 'utf8');
  // Static ESM and literal lazy imports, including stylesheet imports. Production
  // bundle inspection remains a separate check; this is not a general JS parser.
  const imports = content.matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s*)['"]([^'"]+)['"]/g,
  );
  for (const [, name] of imports) {
    if (!name.startsWith('.')) continue;
    const base = resolve(dirname(file), name.replace(/[?#].*$/, ''));
    const found = [
      base,
      ...['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '/index.ts', '/index.tsx'].map(
        (ext) => base + ext,
      ),
    ].find((p) => existsSync(p) && /\.(?:[jt]sx?|css|json)$/.test(p));
    if (found) walk(found);
  }
}
for (const file of [
  'apps/web/src/main.tsx',
  'apps/web/src/plugin.tsx',
  'apps/web/src/candidate.ts',
])
  walk(file);
const preview =
  readFileSync('apps/web/review/vite.config.ts', 'utf8') +
  readFileSync('apps/web/review/trial/vite.config.ts', 'utf8');
if (/proxy|serviceWorker|offline-shell/.test(preview))
  throw Error('Preview config must not use business proxy or SW');
console.log(`Static production graph checked: ${seen.size} files; no review/fixture imports.`);
for (const path of ['output/storybook/sw.js', 'output/ui-preview/sw.js', 'output/ui-trial/sw.js'])
  if (existsSync(path)) throw Error(`Unexpected app service worker: ${path}`);

// Candidate UI must remain pure even before it becomes reachable from main/plugin.
const candidateRoots = [
  'apps/web/src/app-vnext',
  'apps/web/src/ui/components',
  'apps/web/src/ui/patterns',
  'apps/web/src/ui/theme',
  'apps/web/src/features/daily/pages',
  'apps/web/src/features/management/pages',
  'apps/web/src/features/settings/pages',
];
const candidateFiles = [];
function visitDirectory(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) visitDirectory(path);
    else if (/\.[jt]sx?$/.test(path)) candidateFiles.push(path);
  }
}
for (const dir of candidateRoots) if (existsSync(dir)) visitDirectory(dir);
for (const file of candidateFiles) {
  const content = readFileSync(file, 'utf8');
  if (/from\s+['"](?:antd|@ant-design|@radix-ui)/.test(content))
    throw Error(`Disallowed UI dependency: ${file}`);
  if (
    /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(|navigator\.(?:mediaDevices|bluetooth)|\b(?:localStorage|sessionStorage)\./.test(
      content,
    )
  )
    throw Error(`Direct I/O in candidate component: ${file}`);
  if (
    /from\s+['"][^'"]*(?:review|fixtures|features\/(?:api|writes))[/\\]/.test(content) &&
    !file.includes('/src/app-vnext/')
  )
    throw Error(`Preview/business adapter import in component: ${file}`);
  if (file.includes('/src/app-vnext/')) {
    const reusablePureModules = new Set([
      '../features/api/recovery',
      '../features/api/query-params',
      '../features/writes/note-command',
    ]);
    for (const [, name] of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      // Shared management presentation contract: type-only dependency, never a
      // runtime page/controller import. Keep the narrow exception explicit.
      const managementTypes =
        name === '../features/management/pages/models' &&
        /^import type \{[^}]*\} from ['"]\.\.\/features\/management\/pages\/models['"];$/m.test(
          content,
        ) &&
        !/import\s+(?!type\b)[^;]*from ['"]\.\.\/features\/management\/pages\/models['"]/.test(
          content,
        );
      if (name.includes('features/') && !reusablePureModules.has(name) && !managementTypes)
        throw Error(`Unreviewed application dependency: ${file} -> ${name}`);
    }
  }
  walk(file);
}
console.log(
  `Candidate boundary checked: ${candidateFiles.length} UI source files; no direct business/device I/O.`,
);

// Candidate build stays outside deployable Worker assets.
const candidateConfig = readFileSync('apps/web/vite.candidate.config.ts', 'utf8');
if (
  !candidateConfig.includes("outDir: '../../output/ui-candidate'") ||
  /reviewFeedbackServer|proxy|serviceWorker/.test(candidateConfig)
)
  throw Error('Candidate build must remain a source-only isolated artifact');
for (const name of [
  'apps/cloudflare/wrangler.preview.json',
  'apps/cloudflare/wrangler.production.json',
]) {
  if (
    existsSync(name) &&
    /ui-candidate|ui-preview|ui-trial|storybook/.test(readFileSync(name, 'utf8'))
  )
    throw Error(`Development assets referenced by deployment: ${name}`);
}
console.log('CF candidate artifact is separate from Worker deployment assets.');
