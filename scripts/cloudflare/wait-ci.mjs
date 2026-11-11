import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { ciGateOptionsFromEnvironment, waitForFullCi } from './ci-gate.mjs';

const evidenceFile = 'output/cloudflare-release/ci-gate.json';
// An unsuccessful recheck must not leave a previous success in the uploaded artifact.
await rm(evidenceFile, { force: true });
const evidence = await waitForFullCi({
  ...ciGateOptionsFromEnvironment(process.env),
  onWaiting: (message) => console.log(message),
});
await mkdir('output/cloudflare-release', { recursive: true });
await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    [
      `ci_run_id=${evidence.run_id}`,
      `ci_run_attempt=${evidence.run_attempt}`,
      `ci_workflow_id=${evidence.workflow_id}`,
      `ci_sha=${evidence.commit}`,
      `ci_evidence_file=${evidenceFile}`,
      '',
    ].join('\n'),
  );
console.log(
  `Full CI passed for ${evidence.commit}: run ${evidence.run_id}, attempt ${evidence.run_attempt} (${evidence.run_url})`,
);
