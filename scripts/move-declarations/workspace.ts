import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Options } from 'prettier';
import { resolveConfig } from 'prettier';
import { readTexts, trackedPaths } from '../move-purity/git-range.js';

export interface Workspace {
  readonly root: string;
  readonly base: ReadonlyMap<string, string>;
  readWorking(path: string): string | undefined;
  formatOptions(path: string): Promise<Options>;
}

export function gitWorkspace(root: string): Workspace {
  return {
    root,
    base: readTexts(root, 'HEAD', trackedPaths(root, 'HEAD')),
    readWorking: (path) => {
      const full = join(root, path);
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
    },
    formatOptions: async (path) => (await resolveConfig(join(root, path))) ?? {},
  };
}
