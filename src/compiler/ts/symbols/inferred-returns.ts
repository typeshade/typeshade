import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';

const inferredReturns = new WeakMap<ts.SourceFile, Map<number, ShaderType | null>>();

export function recordInferredReturn(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  type: ShaderType,
): void {
  let table = inferredReturns.get(sourceFile);
  if (table === undefined) {
    table = new Map();
    inferredReturns.set(sourceFile, table);
  }
  const at = node.getStart(sourceFile);
  const seen = table.get(at);
  if (seen === undefined) table.set(at, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) table.set(at, null);
}

export function inferredReturnAt(
  sourceFile: ts.SourceFile,
  offset: number,
): ShaderType | undefined {
  return inferredReturns.get(sourceFile)?.get(offset) ?? undefined;
}
