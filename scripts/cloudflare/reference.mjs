// Immutable, disposable PostgreSQL reference. Never part of a Worker build or deployment.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const referenceCommit = '18f7e0496ecb4fb960a6619f12f57c68b3898410';
const exec = promisify(execFile);
export async function prepareReference() {
  const parent = resolve('output/cloudflare-reference'),
    directory = join(parent, referenceCommit);
  await mkdir(parent, { recursive: true });
  try {
    if ((await readFile(join(directory, '.reference-commit'), 'utf8')) !== referenceCommit)
      throw new Error('Reference marker differs');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temp = await mkdtemp(join(parent, 'extract-'));
    try {
      const archive = join(temp, 'source.tar'),
        tree = join(temp, 'tree');
      await mkdir(tree);
      await exec('git', ['archive', '--format=tar', '--output=' + archive, referenceCommit]);
      await exec('tar', ['-xf', archive, '-C', tree]);
      await writeFile(join(tree, '.reference-commit'), referenceCommit);
      await rename(tree, directory);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  try {
    await access(join(directory, 'node_modules/.bin/tsx'));
  } catch {
    const child = exec('pnpm', ['install', '--frozen-lockfile'], {
      cwd: directory,
      env: { ...process.env, CI: 'true' },
      maxBuffer: 8 * 1024 * 1024,
    });
    child.child.stdout.pipe(process.stdout);
    child.child.stderr.pipe(process.stderr);
    await child;
  }
  return directory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(await prepareReference());
