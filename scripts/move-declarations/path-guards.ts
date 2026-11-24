import { isAbsolute, normalize, relative } from 'node:path/posix';
import { isPathKeyedConfig } from '../move-purity/config-paths.js';
import { fileClassOf } from '../move-purity/file-class.js';
import type { MoveOptions } from './arguments.js';
import { refuse } from './refusal.js';
import type { Workspace } from './workspace.js';

export interface MovePaths {
  readonly source: string;
  readonly target: string;
}

function repositoryPath(root: string, path: string): string {
  const slashed = path.replace(/\\/g, '/');
  const inside = isAbsolute(slashed) ? relative(root, slashed) : normalize(slashed);
  return inside.replace(/^\.\//, '');
}

function checkClass(path: string, role: string): void {
  if (!path.endsWith('.ts')) refuse(`the ${role} ${path} is not a .ts file`);
  const kind = fileClassOf(path);
  if (kind !== 'source')
    refuse(`the ${role} ${path} is a ${kind} file; a pure move does not take it`);
}

export function checkPaths(workspace: Workspace, options: MoveOptions): MovePaths {
  const source = repositoryPath(workspace.root, options.from);
  const target = repositoryPath(workspace.root, options.to);
  checkClass(source, 'source');
  checkClass(target, 'target');
  if (source === target) refuse('the source and the target are one file');
  if (source.split('/')[0] !== target.split('/')[0]) {
    refuse(`the source ${source} and the target ${target} are in different top-level directories`);
  }
  const text = workspace.base.get(source);
  if (text === undefined) refuse(`the source ${source} is not tracked at HEAD`);
  if (workspace.readWorking(source) !== text) {
    refuse(`the source ${source} has uncommitted changes; commit or stash them first`);
  }
  if (workspace.base.has(target) || workspace.readWorking(target) !== undefined) {
    refuse(`the target ${target} exists; the tool creates new files only`);
  }
  for (const [name, config] of workspace.base) {
    if (!isPathKeyedConfig(name)) continue;
    for (const path of [source, target]) {
      if (config.includes(path)) refuse(`path is named in ${name}: ${path}`);
    }
  }
  return { source, target };
}
