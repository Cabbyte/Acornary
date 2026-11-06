import { readFileSync, existsSync } from 'node:fs';
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
const preview = readFileSync('apps/web/review/vite.config.ts', 'utf8');
if (/proxy|serviceWorker|offline-shell/.test(preview))
  throw Error('Preview config must not use business proxy or SW');
console.log(`Static production graph checked: ${seen.size} files; no review/fixture imports.`);
for (const path of ['output/storybook/sw.js', 'output/ui-preview/sw.js'])
  if (existsSync(path)) throw Error(`Unexpected app service worker: ${path}`);
