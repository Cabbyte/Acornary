import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
function bytes(path) {
  const b = readFileSync(path);
  return { raw: b.length, gzip: gzipSync(b).length, brotli: brotliCompressSync(b).length };
}
function entry(root) {
  const html = readFileSync(`${root}/index.html`, 'utf8');
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.js)"/g)].map((m) => m[1]);
  const list = [...new Set(paths)].map((p) => ({ file: p, ...bytes(root + p) }));
  return {
    files: list,
    total: list.reduce(
      (sum, x) => ({
        raw: sum.raw + x.raw,
        gzip: sum.gzip + x.gzip,
        brotli: sum.brotli + x.brotli,
      }),
      { raw: 0, gzip: 0, brotli: 0 },
    ),
  };
}
const result = {
  recordedAt: new Date().toISOString(),
  node: process.version,
  baseline: '18f7e0496ecb4fb960a6619f12f57c68b3898410',
  condition:
    'Same local Node 24 and installed lockfile; initial HTML JS references, not all lazy routes. No runtime latency measurement.',
  baselineWeb: entry('.local/b00-baseline/apps/web/dist'),
  candidateWeb: entry('apps/web/dist'),
  baselinePlugin: bytes('.local/b00-baseline/apps/web/dist/plugin/index.html'),
  candidatePlugin: bytes('apps/web/dist/plugin/index.html'),
  tokenPreview: entry('output/ui-preview'),
  pending: [
    '11/500/5000 inventory task latency',
    '30 warm / 10 cold samples',
    'real MCP host',
    'physical phone',
  ],
};
writeFileSync('docs/ux-vnext/b00-bundle-baseline.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    baselineWeb: result.baselineWeb.total,
    candidateWeb: result.candidateWeb.total,
    plugin: result.candidatePlugin,
  }),
);
