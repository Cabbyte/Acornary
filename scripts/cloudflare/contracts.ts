import { z } from 'zod';
import { schemas, reads, descriptions } from '../../packages/contracts/src/index.js';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const operations = Object.fromEntries(Object.keys(schemas).sort().map(name => {
  const key = name as keyof typeof schemas;
  return [name, { input: z.toJSONSchema(schemas[key], { io: 'input' }), read: reads.has(key), description: descriptions[key] }];
}));
const content = JSON.stringify({ version: 1, baseline: '18f7e0496ecb4fb960a6619f12f57c68b3898410', operations }, null, 2) + '\n';
const path = 'docs/cloudflare/contracts-baseline.json';
if (process.argv.includes('--capture')) await writeFile(path, content);
else if (await readFile(path, 'utf8') !== content) throw new Error('Public operation contract changed: review explicitly before updating the baseline');
console.log(JSON.stringify({ operations: Object.keys(operations).length, sha256: createHash('sha256').update(content).digest('hex') }));
