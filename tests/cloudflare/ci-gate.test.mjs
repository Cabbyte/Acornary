import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  CI_GATE_POLICY,
  ciGateOptionsFromEnvironment,
  waitForFullCi,
} from '../../scripts/cloudflare/ci-gate.mjs';

const sha = 'a'.repeat(40);
const repositoryId = 1234;
const workflowId = 5678;
const apiRoot = `https://api.github.com/repos/${CI_GATE_POLICY.repository}`;
const workflow = {
  id: workflowId,
  path: CI_GATE_POLICY.workflowPath,
  state: 'active',
  url: `${apiRoot}/actions/workflows/${workflowId}`,
};
const run = (overrides = {}) => ({
  id: 100,
  run_number: 10,
  run_attempt: 1,
  workflow_id: workflowId,
  name: 'CI',
  repository: { id: repositoryId, full_name: CI_GATE_POLICY.repository },
  head_repository: { id: repositoryId, full_name: CI_GATE_POLICY.repository },
  path: CI_GATE_POLICY.workflowPath,
  head_branch: CI_GATE_POLICY.branch,
  head_sha: sha,
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  ...overrides,
});
const listing = (runs) => ({ total_count: runs.length, workflow_runs: runs });

// Every HTTP response and tick is controlled: a test cannot hit GitHub or mutate it.
function harness({
  snapshots = [[run()]],
  details,
  workflowResponse = workflow,
  fetchResponse,
} = {}) {
  let tick = 0;
  let elapsed = 0;
  const requests = [];
  const messages = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.ok(url.startsWith(apiRoot + '/actions/'));
    if (fetchResponse)
      return fetchResponse({ url, options, tick, advance: (ms) => (elapsed += ms) });
    let body;
    if (parsed.pathname.endsWith('/workflows/ci.yml')) body = workflowResponse;
    else if (parsed.pathname.endsWith(`/workflows/${workflowId}/runs`)) {
      assert.equal(parsed.searchParams.get('head_sha'), sha);
      assert.equal(parsed.searchParams.get('branch'), CI_GATE_POLICY.branch);
      assert.equal(parsed.searchParams.get('event'), 'push');
      const snapshot = snapshots[Math.min(tick, snapshots.length - 1)];
      if (Array.isArray(snapshot)) {
        const offset = (Number(parsed.searchParams.get('page')) - 1) * 100;
        body = {
          total_count: snapshot.length,
          workflow_runs: snapshot.slice(offset, offset + 100),
        };
      } else body = snapshot;
    } else {
      const id = Number(parsed.pathname.split('/').at(-1));
      body = details
        ? details[Math.min(tick, details.length - 1)]
        : snapshots[Math.min(tick, snapshots.length - 1)].find((entry) => entry.id === id);
      assert.ok(body, `Unexpected run detail request: ${url}`);
    }
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  return {
    requests,
    messages,
    get ticks() {
      return tick;
    },
    verify: (overrides = {}) =>
      waitForFullCi({
        sha,
        repositoryId,
        token: 'test-only-token',
        fetchImpl,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
          tick++;
        },
        timeoutMs: 60,
        pollIntervalMs: 10,
        requestTimeoutMs: 20,
        onWaiting: (message) => messages.push(message),
        ...overrides,
      }),
  };
}

test('requires two agreeing observations and reports exact run/attempt evidence', async () => {
  const h = harness();
  const evidence = await h.verify();
  assert.equal(h.ticks, 1);
  assert.equal(h.requests.length, 5);
  assert.deepEqual(evidence, {
    repository: CI_GATE_POLICY.repository,
    repository_id: repositoryId,
    workflow_path: CI_GATE_POLICY.workflowPath,
    workflow_id: workflowId,
    branch: CI_GATE_POLICY.branch,
    event: 'push',
    commit: sha,
    run_id: 100,
    run_number: 10,
    run_attempt: 1,
    run_url: 'https://github.com/Cabbyte/Acornary/actions/runs/100/attempts/1',
    conclusion: 'success',
    verified_at: '1970-01-01T00:00:00.010Z',
  });
  assert.ok(!JSON.stringify(evidence).includes('test-only-token'));
});

test('waits for the exact push run to appear and finish', async () => {
  const pending = run({ status: 'queued', conclusion: null });
  const h = harness({ snapshots: [[], [pending], [run()], [run()]] });
  assert.equal((await h.verify()).run_id, 100);
  assert.equal(h.ticks, 3);
});

test('missing checks time out without a successful result', async () => {
  const h = harness({ snapshots: [[]] });
  await assert.rejects(h.verify(), /timed out: No matching full CI run/);
  assert.equal(h.ticks, 6);
});

for (const [label, override] of Object.entries({
  'foreign repository': { repository: { id: repositoryId, full_name: 'other/Acornary' } },
  'different repository ID': { repository: { id: 9999, full_name: CI_GATE_POLICY.repository } },
  'fork head': { head_repository: { id: 9999, full_name: 'fork/Acornary' } },
  'missing head repository': { head_repository: null },
  'same display name, different workflow ID': { workflow_id: 9999 },
  'same display name, different workflow path': { path: '.github/workflows/fake-ci.yml' },
  'wrong ref in path': { path: '.github/workflows/ci.yml@main' },
  'other branch with same SHA': { head_branch: 'main' },
  'PR event': { event: 'pull_request' },
  'workflow_call event': { event: 'workflow_call' },
  'different SHA': { head_sha: 'b'.repeat(40) },
})) {
  test(`does not accept ${label}`, async () => {
    const h = harness({ snapshots: [[run(override)]] });
    await assert.rejects(h.verify(), /timed out: No matching full CI run/);
    assert.equal(
      h.requests.some((url) => url.endsWith('/runs/100')),
      false,
    );
  });
}

test('workflow identity comes from its canonical ID and path, not its display name', async () => {
  const h = harness({ snapshots: [[run({ name: 'Renamed full CI' })]] });
  assert.equal((await h.verify()).workflow_id, workflowId);
});

for (const path of [
  `${CI_GATE_POLICY.workflowPath}@${CI_GATE_POLICY.branch}`,
  `${CI_GATE_POLICY.workflowPath}@refs/heads/${CI_GATE_POLICY.branch}`,
]) {
  test(`accepts the trusted workflow path representation ${path}`, async () => {
    assert.equal((await harness({ snapshots: [[run({ path })]] }).verify()).run_id, 100);
  });
}

for (const conclusion of [
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'neutral',
  'skipped',
  'stale',
  null,
]) {
  test(`latest ${conclusion ?? 'missing'} conclusion blocks an older successful run`, async () => {
    const latest = run({ id: 101, run_number: 11, conclusion });
    const h = harness({ snapshots: [[run(), latest]] });
    await assert.rejects(h.verify(), /run 101, attempt 1 concluded/);
    assert.equal(h.ticks, 0);
  });
}

test('selects the latest run regardless of API ordering and ignores unrelated newer runs', async () => {
  const current = run({ id: 101, run_number: 11, run_attempt: 2 });
  const unrelated = run({ id: 102, run_number: 12, workflow_id: 9999, conclusion: 'failure' });
  const old = run({ run_attempt: 10 });
  const h = harness({ snapshots: [[current, unrelated, old]] });
  const evidence = await h.verify();
  assert.equal(evidence.run_id, 101);
  assert.equal(evidence.run_attempt, 2);
});

test('a pending newer run prevents use of an older successful run', async () => {
  const pending = run({ id: 101, run_number: 11, status: 'in_progress', conclusion: null });
  const h = harness({ snapshots: [[run(), pending]] });
  await assert.rejects(h.verify(), /timed out: Run 101, attempt 1: in_progress/);
});

test('a newer failed run appearing during confirmation blocks the previous success', async () => {
  const failed = run({ id: 101, run_number: 11, conclusion: 'failure' });
  const h = harness({ snapshots: [[run()], [run(), failed]] });
  await assert.rejects(h.verify(), /run 101, attempt 1 concluded failure/);
});

test('a rerun discovered by the detail endpoint prevents stale list success', async () => {
  const rerun = run({ run_attempt: 2, status: 'in_progress', conclusion: null });
  const failed = run({ run_attempt: 2, conclusion: 'failure' });
  const h = harness({ snapshots: [[run()], [run()]], details: [rerun, failed] });
  await assert.rejects(h.verify(), /run 100, attempt 2 concluded failure/);
});

test('waits for the rerun to finish and confirms the new attempt twice', async () => {
  const pending = run({ run_attempt: 2, status: 'queued', conclusion: null });
  const success = run({ run_attempt: 2 });
  const h = harness({
    snapshots: [[run()], [pending], [success], [success]],
    details: [pending, pending, success, success],
  });
  assert.equal((await h.verify()).run_attempt, 2);
  assert.equal(h.ticks, 3);
});

test('never moves back to a previous run when subsequent list results are stale', async () => {
  const pending = run({ id: 101, run_number: 11, status: 'queued', conclusion: null });
  const success = run({ id: 101, run_number: 11 });
  const h = harness({ snapshots: [[run(), pending], [run()]], details: [pending, success] });
  await assert.rejects(h.verify(), /timed out/);
  assert.equal(
    h.requests.some((url) => url.endsWith('/runs/100')),
    false,
  );
});

test('never moves back to an older attempt when both API responses regress', async () => {
  const pending = run({ run_attempt: 2, status: 'queued', conclusion: null });
  const h = harness({ snapshots: [[pending], [run()]], details: [pending, run()] });
  await assert.rejects(h.verify(), /timed out: GitHub returned a stale CI attempt/);
});

test('an absent run interrupts successful confirmation', async () => {
  const h = harness({ snapshots: [[run()], [], [run()], [run()]] });
  assert.equal((await h.verify()).run_id, 100);
  assert.equal(h.ticks, 3);
});

test('a failure in the list cannot be overruled by a stale success detail', async () => {
  const h = harness({ snapshots: [[run({ conclusion: 'failure' })]], details: [run()] });
  await assert.rejects(h.verify(), /timed out/);
});

test('all pages are considered before selecting the latest run', async () => {
  const old = Array.from({ length: 100 }, (_, index) =>
    run({ id: index + 1, run_number: index + 1 }),
  );
  const failed = run({ id: 101, run_number: 101, conclusion: 'failure' });
  const h = harness({ snapshots: [[...old, failed]] });
  await assert.rejects(h.verify(), /run 101, attempt 1 concluded failure/);
  assert.ok(h.requests.some((url) => url.includes('page=2')));
});

for (const body of [
  {},
  { total_count: 1001, workflow_runs: [run()] },
  { total_count: 2, workflow_runs: [run()] },
  { total_count: 1, workflow_runs: [] },
  { total_count: 0, workflow_runs: [run()] },
  listing([run(), run()]),
]) {
  test(`incomplete or malformed run listing fails closed: ${JSON.stringify(body).slice(0, 60)}`, async () => {
    await assert.rejects(harness({ snapshots: [body] }).verify(), /run list/);
  });
}

for (const override of [
  { id: 0 },
  { path: '.github/workflows/fake-ci.yml' },
  { url: 'https://api.github.com/repos/other/Acornary/actions/workflows/5678' },
  { state: 'disabled_manually' },
]) {
  test(`invalid trusted workflow fails closed: ${JSON.stringify(override)}`, async () => {
    await assert.rejects(
      harness({ workflowResponse: { ...workflow, ...override } }).verify(),
      /workflow identity/,
    );
  });
}

test('run detail identity changes fail closed', async () => {
  await assert.rejects(
    harness({ details: [run({ head_branch: 'main' })] }).verify(),
    /identity changed/,
  );
});

test('invalid attempts and unknown status fail closed', async () => {
  for (const override of [{ run_attempt: 0 }, { run_number: undefined }, { status: 'unexpected' }])
    await assert.rejects(
      harness({ snapshots: [[run(override)]] }).verify(),
      /invalid run|unknown run status/,
    );
});

test('conflicting run numbers cannot silently choose a success', async () => {
  await assert.rejects(
    harness({ snapshots: [[run(), run({ id: 101 })]] }).verify(),
    /conflicting run identities/,
  );
});

test('HTTP errors, transport errors and invalid JSON fail closed without leaking credentials', async () => {
  for (const status of [403, 404, 429, 500]) {
    const h = harness({ fetchResponse: async () => ({ ok: false, status }) });
    await assert.rejects(h.verify(), new RegExp(`HTTP ${status}`));
  }
  const h = harness({
    fetchResponse: async () => {
      throw new Error('test-only-token');
    },
  });
  await assert.rejects(
    h.verify(),
    (error) => /request failed/.test(error.message) && !error.message.includes('test-only-token'),
  );
  await assert.rejects(
    harness({
      fetchResponse: async () => ({
        ok: true,
        json: async () => {
          throw new Error('invalid');
        },
      }),
    }).verify(),
    /invalid API response/,
  );
});

test('a success arriving after the deadline is not accepted', async () => {
  const h = harness({
    fetchResponse: async ({ advance }) => {
      advance(61);
      return { ok: true, json: async () => workflow };
    },
  });
  await assert.rejects(h.verify(), /timed out/);
});

const trustedEnv = {
  GITHUB_REPOSITORY: CI_GATE_POLICY.repository,
  GITHUB_REPOSITORY_ID: String(repositoryId),
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: `refs/heads/${CI_GATE_POLICY.branch}`,
  GITHUB_SHA: sha,
  GITHUB_TOKEN: 'test-only-token',
};
test('entry point rejects untrusted environment and incomplete commit identity', () => {
  assert.deepEqual(ciGateOptionsFromEnvironment(trustedEnv), {
    sha,
    token: 'test-only-token',
    repositoryId,
  });
  for (const override of [
    { GITHUB_REPOSITORY: 'fork/Acornary' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_SHA: 'abcdef1' },
    { GITHUB_TOKEN: '' },
    { GITHUB_REPOSITORY_ID: '' },
    { GITHUB_REPOSITORY_ID: '9007199254740993' },
  ])
    assert.throws(() => ciGateOptionsFromEnvironment({ ...trustedEnv, ...override }));
});

test('invalid gate options are rejected before any API request', async () => {
  const h = harness();
  for (const override of [
    { sha: 'abc' },
    { repositoryId: 0 },
    { token: ' ' },
    { timeoutMs: 0 },
    { pollIntervalMs: -1 },
    { requestTimeoutMs: 0 },
  ])
    await assert.rejects(h.verify(override));
  assert.equal(h.requests.length, 0);
});

test('a rejected CLI recheck removes stale success evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'acornary-ci-gate-'));
  const evidence = join(directory, 'output/cloudflare-release/ci-gate.json');
  try {
    await mkdir(join(directory, 'output/cloudflare-release'), { recursive: true });
    await writeFile(evidence, JSON.stringify({ conclusion: 'success' }));
    await assert.rejects(
      promisify(execFile)(process.execPath, [resolve('scripts/cloudflare/wait-ci.mjs')], {
        cwd: directory,
        env: { ...process.env, ...trustedEnv, GITHUB_EVENT_NAME: 'pull_request' },
      }),
      /trusted repository and CF branch push context/,
    );
    await assert.rejects(readFile(evidence), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
