// The release workflow cannot select another repository, branch, event, or CI file.
export const CI_GATE_POLICY = Object.freeze({
  repository: 'Cabbyte/Acornary',
  branch: 'codex/cloudflare-native',
  event: 'push',
  workflowPath: '.github/workflows/ci.yml',
});

const apiRoot = `https://api.github.com/repos/${CI_GATE_POLICY.repository}`;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const pendingStatuses = new Set(['queued', 'in_progress', 'requested', 'waiting', 'pending']);

export function ciGateOptionsFromEnvironment(env) {
  if (
    env.GITHUB_REPOSITORY !== CI_GATE_POLICY.repository ||
    env.GITHUB_EVENT_NAME !== CI_GATE_POLICY.event ||
    env.GITHUB_REF !== `refs/heads/${CI_GATE_POLICY.branch}`
  )
    throw new Error('Full CI gate requires the trusted repository and CF branch push context');
  if (!/^[1-9][0-9]*$/.test(env.GITHUB_REPOSITORY_ID ?? ''))
    throw new Error('Full CI gate requires the GitHub repository ID');
  const options = {
    sha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
  };
  validateOptions(options);
  return options;
}

function validateOptions({ sha, token, repositoryId }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || typeof token !== 'string' || !token.trim())
    throw new Error('Exact commit and workflow read authorization required');
  if (!positiveInteger(repositoryId)) throw new Error('A valid repository ID is required');
}

function matchesRun(run, { sha, repositoryId, workflowId }) {
  const { repository, branch, event, workflowPath } = CI_GATE_POLICY;
  return (
    run?.repository?.full_name === repository &&
    run.repository.id === repositoryId &&
    run.head_repository?.full_name === repository &&
    run.head_repository.id === repositoryId &&
    run.workflow_id === workflowId &&
    [workflowPath, `${workflowPath}@${branch}`, `${workflowPath}@refs/heads/${branch}`].includes(
      run.path,
    ) &&
    run.head_sha === sha &&
    run.head_branch === branch &&
    run.event === event
  );
}

function validateRun(run) {
  if (![run.id, run.run_number, run.run_attempt].every(positiveInteger))
    throw new Error('Full CI returned an invalid run ID, number, or attempt');
  if (run.status !== 'completed' && !pendingStatuses.has(run.status))
    throw new Error('Full CI returned an unknown run status');
}

// run_number orders separate runs of the same workflow; run_attempt orders its reruns.
function compareRuns(a, b) {
  if (a.run_number === b.run_number && a.id !== b.id)
    throw new Error('Full CI returned conflicting run identities');
  if (a.id === b.id && a.run_number !== b.run_number)
    throw new Error('Full CI changed the number of an existing run');
  return a.run_number - b.run_number || a.run_attempt - b.run_attempt;
}

/**
 * Verify the newest trusted push run and its current attempt. All reads fail closed.
 * A successful observation must repeat after a poll interval, with list and detail
 * endpoints agreeing. Remember the highest observed run/attempt if a later API
 * response is stale. Recheck immediately before deployment after a manual approval;
 * this evidence describes the checked instant, not future reruns or branch changes.
 */
export async function waitForFullCi({
  sha,
  token,
  repositoryId,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 35 * 60 * 1000,
  pollIntervalMs = 15000,
  requestTimeoutMs = 30000,
  onWaiting = () => {},
}) {
  validateOptions({ sha, token, repositoryId });
  if (![timeoutMs, pollIntervalMs, requestTimeoutMs].every(positiveInteger))
    throw new Error('CI gate timeouts and polling interval must be positive integers');
  const deadline = now() + timeoutMs;
  let lastState = 'No matching full CI run was found';
  const checkDeadline = () => {
    if (now() >= deadline) throw new Error(`Full CI gate timed out: ${lastState}; release blocked`);
  };
  const get = async (path) => {
    checkDeadline();
    let response;
    try {
      response = await fetchImpl(`${apiRoot}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - now()))),
      });
    } catch {
      throw new Error('Cannot inspect full CI: API request failed or timed out; release blocked');
    }
    if (!response.ok)
      throw new Error(`Cannot inspect full CI: HTTP ${response.status}; release blocked`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('Cannot inspect full CI: invalid API response; release blocked');
    }
    checkDeadline();
    return body;
  };
  const workflow = await get('/actions/workflows/ci.yml');
  if (
    !positiveInteger(workflow?.id) ||
    workflow.path !== CI_GATE_POLICY.workflowPath ||
    workflow.url !== `${apiRoot}/actions/workflows/${workflow.id}` ||
    workflow.state !== 'active'
  )
    throw new Error('Trusted full CI workflow identity is missing or inactive; release blocked');
  const identity = { sha, repositoryId, workflowId: workflow.id };
  const listRuns = async () => {
    const all = [];
    let count;
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        head_sha: sha,
        branch: CI_GATE_POLICY.branch,
        event: CI_GATE_POLICY.event,
        per_page: '100',
        page: String(page),
      });
      const body = await get(`/actions/workflows/${workflow.id}/runs?${query}`);
      if (
        !Number.isSafeInteger(body?.total_count) ||
        body.total_count < 0 ||
        body.total_count > 1000 ||
        !Array.isArray(body.workflow_runs) ||
        body.workflow_runs.length > 100 ||
        (count !== undefined && count !== body.total_count)
      )
        throw new Error('Cannot establish a complete full CI run list; release blocked');
      count = body.total_count;
      all.push(...body.workflow_runs);
      if (all.length >= count) break;
      if (body.workflow_runs.length !== 100)
        throw new Error('Full CI run list is incomplete; release blocked');
    }
    if (all.length !== count || new Set(all.map((run) => run?.id)).size !== count)
      throw new Error('Full CI run list is incomplete or changed while paging; release blocked');
    return all.filter((run) => matchesRun(run, identity));
  };
  let highestObserved;
  let successfulObservation;
  for (;;) {
    checkDeadline();
    const runs = await listRuns();
    for (const run of runs) validateRun(run);
    const latest = runs.reduce(
      (best, run) => (!best || compareRuns(run, best) > 0 ? run : best),
      null,
    );
    let successful;
    if (latest) {
      if (!highestObserved || compareRuns(latest, highestObserved) > 0) highestObserved = latest;
      const current = await get(`/actions/runs/${highestObserved.id}`);
      if (!matchesRun(current, identity) || current.id !== highestObserved.id)
        throw new Error('Full CI run identity changed during verification; release blocked');
      validateRun(current);
      const comparison = compareRuns(current, highestObserved);
      if (comparison >= 0) {
        highestObserved = current;
        lastState = `Run ${current.id}, attempt ${current.run_attempt}: ${current.status}`;
        if (current.status === 'completed' && current.conclusion !== 'success')
          throw new Error(
            `Full CI run ${current.id}, attempt ${current.run_attempt} concluded ${current.conclusion ?? 'without a result'}; release blocked`,
          );
        if (
          current.status === 'completed' &&
          compareRuns(latest, current) === 0 &&
          latest.status === 'completed' &&
          latest.conclusion === 'success'
        )
          successful = `${current.id}:${current.run_attempt}`;
      } else lastState = 'GitHub returned a stale CI attempt';
      if (successful && successful === successfulObservation) {
        checkDeadline();
        return {
          repository: CI_GATE_POLICY.repository,
          repository_id: repositoryId,
          workflow_path: CI_GATE_POLICY.workflowPath,
          workflow_id: workflow.id,
          branch: CI_GATE_POLICY.branch,
          event: CI_GATE_POLICY.event,
          commit: sha,
          run_id: current.id,
          run_number: current.run_number,
          run_attempt: current.run_attempt,
          run_url: `https://github.com/${CI_GATE_POLICY.repository}/actions/runs/${current.id}/attempts/${current.run_attempt}`,
          conclusion: 'success',
          verified_at: new Date(now()).toISOString(),
        };
      }
    } else lastState = 'No matching full CI run was found';
    successfulObservation = successful;
    onWaiting(`${lastState}; waiting for full CI for ${sha.slice(0, 12)}`);
    checkDeadline();
    await sleep(Math.min(pollIntervalMs, deadline - now()));
  }
}
