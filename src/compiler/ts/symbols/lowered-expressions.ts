import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';

export interface LoweredExpression {
  readonly start: number;
  readonly length: number;
  readonly type: ShaderType;
}

const loweredExpressions = new WeakMap<ts.SourceFile, Map<string, ShaderType | null>>();

export function captureExpressionRecords<T>(
  sourceFile: ts.SourceFile,
  lower: () => T,
): { value: T; commit: () => void } {
  const previous = loweredExpressions.get(sourceFile);
  if (previous === undefined) return { value: lower(), commit: () => {} };
  const trial = new Map<string, ShaderType | null>();
  loweredExpressions.set(sourceFile, trial);
  let value: T;
  try {
    value = lower();
  } finally {
    loweredExpressions.set(sourceFile, previous);
  }
  return {
    value,
    commit: () => {
      for (const [key, type] of trial) {
        const seen = previous.get(key);
        previous.set(
          key,
          seen === undefined || JSON.stringify(seen) === JSON.stringify(type) ? type : null,
        );
      }
    },
  };
}

export function openExpressionTable(sourceFile: ts.SourceFile): void {
  loweredExpressions.set(sourceFile, new Map());
}

export function recordLoweredExpression(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  type: ShaderType,
): void {
  const table = loweredExpressions.get(sourceFile);
  if (table === undefined) return;
  const start = node.getStart(sourceFile);
  const key = `${start}:${node.getEnd() - start}`;
  const seen = table.get(key);
  if (seen === undefined) table.set(key, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) table.set(key, null);
}

export function loweredTypeOf(sourceFile: ts.SourceFile, node: ts.Node): ShaderType | undefined {
  const table = loweredExpressions.get(sourceFile);
  if (table === undefined) return undefined;
  const start = node.getStart(sourceFile);
  return table.get(`${start}:${node.getEnd() - start}`) ?? undefined;
}

export function closeExpressionTable(sourceFile: ts.SourceFile): LoweredExpression[] {
  const table = loweredExpressions.get(sourceFile);
  loweredExpressions.delete(sourceFile);
  if (table === undefined) return [];
  const out: LoweredExpression[] = [];
  for (const [key, type] of table) {
    if (type === null) continue;
    const [start, length] = key.split(':').map(Number) as [number, number];
    out.push({ start, length, type });
  }
  return out.sort((a, b) => a.start - b.start || b.length - a.length);
}
