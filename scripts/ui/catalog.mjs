import { createServer } from 'vite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const server = await createServer({
  configFile: 'apps/web/review/vite.config.ts',
  server: { middlewareMode: true },
  logLevel: 'error',
});
try {
  const { entries, expectedIds } = await server.ssrLoadModule('/registry.ts');
  const components = entries.filter((e) => e.kind !== 'composition');
  const scenes = entries.filter((e) => e.kind === 'composition');
  if (components.length !== 70 || scenes.length !== 5)
    throw Error(
      `Expected 70 components + 5 scenarios, received ${components.length} + ${scenes.length}`,
    );
  const ids = new Set();
  const storyIndex = JSON.parse(readFileSync('output/storybook/index.json', 'utf8')).entries;
  for (const entry of entries) {
    if (ids.has(entry.id)) throw Error(`Duplicate review ID: ${entry.id}`);
    ids.add(entry.id);
    if (entry.kind !== 'composition' && !expectedIds.includes(entry.id))
      throw Error(`Unexpected public component: ${entry.id}`);
    if (typeof entry.component !== 'function' || !entry.scenarios.length)
      throw Error(`Incomplete demo: ${entry.id}`);
    if (!entry.storyId || !storyIndex[entry.storyId])
      throw Error(`Missing Storybook link: ${entry.id} (${entry.storyId})`);
    if (entry.status && entry.status !== '待审阅')
      throw Error(`Unapproved review status: ${entry.id}`);
  }
  for (const id of expectedIds) if (!ids.has(id)) throw Error(`Missing public component: ${id}`);
  const primitiveIds = expectedIds.slice(0, 28);
  const catalog = entries.map(({ component, ...entry }) => ({
    ...entry,
    version: 'RC1',
    status: '待审阅',
    source:
      entry.kind === 'composition'
        ? 'apps/web/review/groups/compositions-demos.tsx'
        : `apps/web/src/ui/${primitiveIds.includes(entry.id) ? 'components/ui' : 'patterns'}/${entry.id}.tsx`,
    preview: `http://127.0.0.1:6007/?component=${entry.id}&preset=sage&mode=daily&viewport=390&scenario=${entry.scenarios[0].id}`,
    storybook: `http://127.0.0.1:6006/?path=/story/${entry.storyId}`,
  }));
  for (const entry of catalog)
    if (!existsSync(entry.source)) throw Error(`Missing source: ${entry.source}`);
  const result =
    JSON.stringify(
      { version: 'Component Library RC1', components: 70, compositions: 5, entries: catalog },
      null,
      2,
    ) + '\n';
  const path = 'docs/ux-vnext/component-catalog.json';
  if (process.argv.includes('--write')) writeFileSync(path, result);
  else if (readFileSync(path, 'utf8') !== result)
    throw Error('Component catalog is stale; run with --write');
  console.log(
    `Catalog verified: 70 public components, 5 compositions, ${entries.reduce((n, e) => n + e.scenarios.length, 0)} states; every Storybook link resolves.`,
  );
} finally {
  await server.close();
}
