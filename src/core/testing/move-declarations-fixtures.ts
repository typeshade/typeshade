import { parseArguments, type MoveOptions } from '../../../scripts/move-declarations/arguments.js';
import { planMove, type MovePlan } from '../../../scripts/move-declarations/plan.js';
import { Refusal } from '../../../scripts/move-declarations/refusal.js';
import type { Workspace } from '../../../scripts/move-declarations/workspace.js';

export const FIXTURE_ROOT = '/move-purity-fixture';

export const memoryWorkspace = (files: Record<string, string>): Workspace => {
  const texts = new Map(Object.entries(files));
  return {
    root: FIXTURE_ROOT,
    base: texts,
    readWorking: (path) => texts.get(path),
    formatOptions: async () => ({
      semi: true,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 100,
      tabWidth: 2,
      arrowParens: 'always',
    }),
  };
};

export const moveOptions = (
  from: string,
  to: string,
  names: string,
  ...flags: string[]
): MoveOptions => {
  const parsed = parseArguments(['--from', from, '--to', to, '--move', names, ...flags]);
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
};

export const plan = (
  files: Record<string, string>,
  from: string,
  to: string,
  names: string,
  ...flags: string[]
): Promise<MovePlan> => planMove(memoryWorkspace(files), moveOptions(from, to, names, ...flags));

export const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
  throw new Error('the tool did not refuse');
};

export const applied = (files: Record<string, string>, result: MovePlan): Map<string, string> => {
  const head = new Map(Object.entries(files));
  head.set(result.source, result.texts.source);
  head.set(result.target, result.texts.target);
  return head;
};
