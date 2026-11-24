import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArguments, USAGE } from './arguments.js';
import { COMMIT_HINT, formatPlan, planJson } from './format-plan.js';
import { planMove, type MovePlan } from './plan.js';
import { Refusal } from './refusal.js';
import { gitWorkspace } from './workspace.js';

function write(root: string, plan: MovePlan): void {
  mkdirSync(dirname(join(root, plan.target)), { recursive: true });
  writeFileSync(join(root, plan.target), plan.texts.target);
  writeFileSync(join(root, plan.source), plan.texts.source);
}

function bake(root: string, plan: MovePlan): boolean {
  const scripts = [
    ...(plan.surfaceNames.length > 0 ? ['bake:api-surface'] : []),
    'bake:file-size-baseline',
  ];
  return scripts.every(
    (script) => spawnSync('bun', ['run', script], { cwd: root, stdio: 'inherit' }).status === 0,
  );
}

export async function runMove(args: readonly string[], cwd: string): Promise<number> {
  const options = parseArguments(args);
  if (typeof options === 'string') {
    console.error(`${options}\n${USAGE}`);
    return 2;
  }
  const root =
    options.repo ??
    execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  try {
    const plan = await planMove(gitWorkspace(root), options);
    console.log(options.json ? planJson(plan) : formatPlan(plan));
    const pure = plan.report.pure;
    if (options.dryRun) return pure ? 0 : 1;
    if (!pure && !options.keep) {
      console.log(
        'The result is not a pure move. Nothing was written. Use --keep to write it for inspection.',
      );
      return 1;
    }
    write(root, plan);
    if (options.bake && !bake(root, plan)) return 1;
    if (!options.json) console.log(COMMIT_HINT);
    return pure ? 0 : 1;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`Refused: ${error.reasons.join('\n')}`);
    return 1;
  }
}
