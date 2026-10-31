import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateFixture } from './fixture.js';
import { digest } from './audit-model.js';
const args = process.argv.slice(2);
if (args.length !== 3 || !['small', 'performance'].includes(args[0]) || args[1] !== '--output')
  throw new Error('Usage: generate.ts small|performance --output DIRECTORY');
const fixture = generateFixture(args[0] === 'performance' ? 10000 : 40),
  output = resolve(args[2]);
await mkdir(output, { recursive: true, mode: 0o700 });
const manifest = {
  source_kind: 'synthetic_fixture',
  seed: 20261031,
  mode: args[0],
  sha256: digest(fixture),
  counts: Object.fromEntries(Object.entries(fixture).map(([key, rows]) => [key, rows.length])),
  distribution: {
    households: 2,
    container_items: 20,
    maximum_container_depth: 10,
    events_per_item: 10,
    notes_per_item: 1,
  },
  performance_measured: false,
  production_evidence: false,
};
await writeFile(join(output, 'fixture.json'), JSON.stringify(fixture) + '\n', {
  mode: 0o600,
  flag: 'wx',
});
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {
  mode: 0o600,
  flag: 'wx',
});
console.log(JSON.stringify(manifest));
