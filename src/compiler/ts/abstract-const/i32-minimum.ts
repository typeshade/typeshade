import ts from 'typescript';
import { provenI32Minimum, type Reading } from './reading.js';
import { skipParenNodes } from './written-syntax.js';

export interface MinimumReads {
  readonly readingsFrom: (e: ts.Expression) => readonly Reading[];
  readonly constNumber: (e: ts.Expression) => number | undefined;
  readonly declarationOf: (name: string, at: ts.Node) => ts.Node | undefined;
  readonly writtenTypeText: (d: ts.VariableDeclaration, sf: ts.SourceFile) => string | undefined;
  readonly reassignedAnywhere: (d: ts.VariableDeclaration) => boolean;
}

function initializerOf(id: ts.Identifier, reads: MinimumReads): ts.Expression | undefined {
  const d = reads.declarationOf(id.text, id);
  return d !== undefined &&
    ts.isVariableDeclaration(d) &&
    ts.isIdentifier(d.name) &&
    [undefined, 'i32'].includes(reads.writtenTypeText(d, id.getSourceFile())) &&
    !reads.reassignedAnywhere(d)
    ? d.initializer
    : undefined;
}

const MINIMUM = -2147483648;
const DEPTH = 16;

function bitsOf(
  e: ts.Expression,
  reads: MinimumReads,
  depth: number,
  converted: boolean,
): number | undefined {
  const n = skipParenNodes(e);
  if (depth > DEPTH) return undefined;
  if (ts.isIdentifier(n)) {
    const init = initializerOf(n, reads);
    return init === undefined ? undefined : bitsOf(init, reads, depth + 1, converted);
  }
  if (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    (n.expression.text === 'i32' || n.expression.text === 'u32') &&
    n.arguments.length === 1
  ) {
    return bitsOf(n.arguments[0]!, reads, depth + 1, true);
  }
  if (!converted) return undefined;
  const xs = reads.readingsFrom(n);
  if (xs.length > 0) {
    const first = xs[0]!;
    return xs.every((x) => provenI32Minimum(x) && (x.u32 | 0) === (first.u32 | 0))
      ? first.u32 | 0
      : undefined;
  }
  const c = reads.constNumber(n);
  return c === MINIMUM ? MINIMUM : undefined;
}

export const provesI32Minimum = (arg: ts.Expression, reads: MinimumReads): boolean => {
  const n = skipParenNodes(arg);
  const inner =
    ts.isIdentifier(n) ||
    (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'i32')
      ? bitsOf(n, reads, 0, false)
      : undefined;
  return inner === MINIMUM;
};
