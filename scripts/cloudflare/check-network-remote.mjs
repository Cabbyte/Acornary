import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { getPlatformProxy } from 'wrangler';
const root = resolve('.local/cf-native-acceptance'),
  state = JSON.parse(await readFile(resolve(root, 'state.json'), 'utf8'));
if (!/^acornary-cf-accept-[a-f0-9]{8}$/.test(state.name))
  throw new Error('Explicit disposable network probe required');
const origin = `https://${state.name}-network.litang0617.workers.dev`,
  proxy = await getPlatformProxy({
    configPath: resolve(root, 'network-operator.json'),
    envFiles: [],
    remoteBindings: true,
    persist: false,
  });
const report = [];
try {
  const check = async (url) => {
    const r = await proxy.env.NETWORK.fetch('https://operator.internal/', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    assert.equal(r.status, 200);
    const value = await r.json();
    report.push({ url, ...value });
    console.log(JSON.stringify({ url, ...value }));
    return value;
  };
  const front = await check(origin + '/small');
  assert.equal(front.status, 200);
  assert.deepEqual(JSON.parse(front.body), {
    marker: 'public-worker-front-door',
    authorization: null,
    cookie: null,
  });
  for (const path of ['/redirect', '/large', '/slow'])
    assert.equal((await check(origin + path)).rejected, true);
  for (const url of [
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://169.254.169.254/',
    'https://10.0.0.1/',
    'http://example.com/',
  ])
    assert.equal((await check(url)).rejected, true);
  await check('https://127.0.0.1.sslip.io/');
  await check('https://10.0.0.1.sslip.io/');
  await check('https://169.254.169.254.sslip.io/');
  await writeFile(
    resolve(root, 'network-report.json'),
    JSON.stringify({ time: new Date().toISOString(), report }, null, 2),
  );
} finally {
  await proxy.dispose();
}
