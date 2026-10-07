import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
const root = 'apps/web/dist';
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.(js|css|html)$/.test(name) ? [path] : [];
  });
}
const current = files(root)
  .sort()
  .map((file) => {
    const data = readFileSync(file);
    return { file, bytes: data.length, gzip: gzipSync(data).length };
  });
const summarize = (rows) => ({
  web: rows
    .filter((r) => !r.file.includes('/plugin/'))
    .reduce((t, r) => ({ bytes: t.bytes + r.bytes, gzip: t.gzip + r.gzip }), { bytes: 0, gzip: 0 }),
  mcp: rows.find((r) => r.file.endsWith('/plugin/index.html')),
});
console.log(
  JSON.stringify(
    {
      measurement:
        'raw UTF-8 bytes and Node gzip default; web sums emitted JS/CSS/HTML, MCP counts its self-contained HTML once',
      ...(process.argv[2]
        ? { baseline: summarize(JSON.parse(readFileSync(process.argv[2], 'utf8'))) }
        : {}),
      candidate: summarize(current),
      files: current.map((r) => ({ ...r, file: relative('.', r.file) })),
    },
    null,
    2,
  ),
);
