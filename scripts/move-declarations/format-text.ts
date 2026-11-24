import ts from 'typescript';
import { format } from 'prettier';
import { analyzeSource } from '../move-purity/units.js';
import type { Workspace } from './workspace.js';

export interface Formatted {
  readonly text: string;
  readonly formatted: boolean;
  readonly reflowed: readonly number[];
}

const hashesOf = (path: string, text: string): string[] =>
  analyzeSource(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), path).units.map(
    (unit) => unit.hash,
  );

export async function formatKeepingUnits(
  workspace: Workspace,
  path: string,
  text: string,
): Promise<Formatted> {
  const options = await workspace.formatOptions(path);
  const result = await format(text, { ...options, filepath: path });
  const before = hashesOf(path, text);
  const after = hashesOf(path, result);
  const reflowed = before.flatMap((hash, index) => (after[index] === hash ? [] : [index]));
  const same = before.length === after.length && reflowed.length === 0;
  return same ? { text: result, formatted: true, reflowed } : { text, formatted: false, reflowed };
}
