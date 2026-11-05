const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha, GITHUB_TOKEN: token } = process.env;
if (!repo || !/^[a-f0-9]{40}$/.test(sha ?? '') || !token)
  throw new Error('Exact commit and workflow read authorization required');
const start = Date.now();
for (;;) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
    {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!r.ok) throw new Error('Cannot inspect commit CI: HTTP ' + r.status);
  const runs = (await r.json()).workflow_runs.filter(
    (v) => v.name === 'CI' && v.head_sha === sha && v.event === 'push',
  );
  if (runs.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
    console.log('Exact-commit full CI passed');
    break;
  }
  if (
    runs.some((r) => r.status === 'completed' && !['success', 'cancelled'].includes(r.conclusion))
  )
    throw new Error('Full CI failed; preview release blocked');
  if (Date.now() - start > 35 * 60 * 1000) throw new Error('Full CI did not complete in time');
  console.log('Waiting for full CI for ' + sha.slice(0, 12));
  await new Promise((r) => setTimeout(r, 15000));
}
