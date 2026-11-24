import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type ts from 'typescript';
import { topLevel } from './declarations.js';
import { isTestPath } from './grammar.js';

export interface ModuleHit {
  readonly file: string;
  readonly source: ts.SourceFile;
  readonly nodes: readonly ts.Node[];
}

export function moduleDirectoryOf(root: string, file: string): string | undefined {
  const directory = file.replace(/\.ts$/, '');
  const full = join(root, directory);
  return existsSync(full) && statSync(full).isDirectory() ? directory : undefined;
}

function partFiles(root: string, directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) out.push(...partFiles(root, path));
    else if (entry.isFile() && path.endsWith('.ts') && !isTestPath(path)) out.push(path);
  }
  return out.sort();
}

export function declaredInModuleDirectory(
  root: string,
  file: string,
  symbol: string,
  load: (path: string) => ts.SourceFile | undefined,
): readonly ModuleHit[] {
  const directory = moduleDirectoryOf(root, file);
  if (directory === undefined) return [];
  const hits: ModuleHit[] = [];
  for (const part of partFiles(root, directory)) {
    const source = load(part);
    const nodes = source === undefined ? undefined : topLevel(source).get(symbol);
    if (source !== undefined && nodes !== undefined) hits.push({ file: part, source, nodes });
  }
  return hits;
}
