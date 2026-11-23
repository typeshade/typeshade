import ts from 'typescript';
import { provenI32Minimum, type Reading } from './reading.js';
import { identifiersNamed } from './syntax-lookup.js';
import { skipParenNodes } from './written-syntax.js';

export interface MinimumReads {
  readonly readingsFrom: (e: ts.Expression) => readonly Reading[];
  readonly constNumber: (e: ts.Expression) => number | undefined;
  readonly declarationOf: (name: string, at: ts.Node) => ts.Node | undefined;
  readonly writtenTypeText: (d: ts.VariableDeclaration, sf: ts.SourceFile) => string | undefined;
  readonly reassignedAnywhere: (d: ts.VariableDeclaration) => boolean;
}

const isTarget = (n: ts.Node, p: ts.Node): boolean =>
  (ts.isBinaryExpression(p) &&
    p.left === n &&
    p.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
  ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === n);

const writtenByPattern = (id: ts.Identifier): boolean => {
  let n: ts.Node = id;
  for (let p = n.parent; p !== undefined; n = p, p = n.parent) {
    if (n !== id && isTarget(n, p)) return true;
    const passes =
      ts.isParenthesizedExpression(p) ||
      ts.isSpreadElement(p) ||
      ts.isArrayLiteralExpression(p) ||
      ts.isObjectLiteralExpression(p) ||
      ts.isShorthandPropertyAssignment(p) ||
      (ts.isPropertyAssignment(p) && p.initializer === n);
    if (!passes) return n !== id && isTarget(n, p);
  }
  return false;
};

const patternAssigned = (d: ts.VariableDeclaration, reads: MinimumReads): boolean =>
  ts.isIdentifier(d.name) &&
  identifiersNamed(d.getSourceFile(), d.name.text).some(
    (id) => id !== d.name && writtenByPattern(id) && reads.declarationOf(id.text, id) === d,
  );

function initializerOf(id: ts.Identifier, reads: MinimumReads): ts.Expression | undefined {
  const d = reads.declarationOf(id.text, id);
  return d !== undefined &&
    ts.isVariableDeclaration(d) &&
    ts.isIdentifier(d.name) &&
    [undefined, 'i32'].includes(reads.writtenTypeText(d, id.getSourceFile())) &&
    !reads.reassignedAnywhere(d) &&
    !patternAssigned(d, reads)
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
    return xs.every(provenI32Minimum) ? MINIMUM : undefined;
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

const referencesOf = (d: ts.VariableDeclaration, reads: MinimumReads): readonly ts.Identifier[] =>
  ts.isIdentifier(d.name)
    ? identifiersNamed(d.getSourceFile(), d.name.text).filter(
        (id) => id !== d.name && reads.declarationOf(id.text, id) === d,
      )
    : [];

const outer = (n: ts.Node): ts.Node | undefined => {
  let up = n.parent;
  while (up !== undefined && ts.isParenthesizedExpression(up)) up = up.parent;
  return up;
};

const isCall = (n: ts.Node | undefined, name: string): n is ts.CallExpression =>
  n !== undefined &&
  ts.isCallExpression(n) &&
  ts.isIdentifier(n.expression) &&
  n.expression.text === name;

export const reachesAbsOfI32 = (
  n: ts.Node,
  reads: MinimumReads,
  converted = false,
  depth = 0,
): boolean => {
  const up = outer(n);
  if (up === undefined || depth > DEPTH) return false;
  if (isCall(up, 'i32')) return reachesAbsOfI32(up, reads, true, depth + 1);
  if (isCall(up, 'abs')) return converted;
  if (
    ts.isVariableDeclaration(up) &&
    ts.isIdentifier(up.name) &&
    !reads.reassignedAnywhere(up) &&
    !patternAssigned(up, reads)
  ) {
    return referencesOf(up, reads).some((id) => reachesAbsOfI32(id, reads, converted, depth + 1));
  }
  return false;
};
