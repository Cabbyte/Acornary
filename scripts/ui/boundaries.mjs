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
for (const file of ['apps/web/src/main.tsx', 'apps/web/src/plugin.tsx']) walk(file);
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
  if (/from\s+['"][^'"]*(?:review|fixtures|features\/(?:api|writes))[/\\]/.test(content))
    throw Error(`Preview/business adapter import in component: ${file}`);
  walk(file);
}
console.log(
  `Candidate boundary checked: ${candidateFiles.length} UI source files; no direct business/device I/O.`,
);
