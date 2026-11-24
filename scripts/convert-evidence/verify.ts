import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export type Verify = (root: string) => string[];

const CHECK_SCRIPT = 'scripts/convert-evidence/check-evidence-cli.ts';

export const verifyWithCheckEvidence: Verify = (root) => {
  const run = spawnSync('bun', [join(root, CHECK_SCRIPT), root], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) return [`checkEvidence did not run: ${run.stderr || run.error}`];
  return JSON.parse(run.stdout) as string[];
};
