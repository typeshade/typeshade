import ts from 'typescript';
import { skipParenNodes, writtenNumber } from './written-syntax.js';

function storesTo(name: string, body: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    const target =
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ? n.left
        : (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
            (n.operator === ts.SyntaxKind.PlusPlusToken ||
              n.operator === ts.SyntaxKind.MinusMinusToken)
          ? n.operand
          : undefined;
    if (target !== undefined && ts.isIdentifier(skipParenNodes(target as ts.Expression))) {
      if ((skipParenNodes(target as ts.Expression) as ts.Identifier).text === name) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return found;
}

function stepsByOne(name: string, step: ts.Expression | undefined): boolean {
  if (step === undefined) return false;
  const n = skipParenNodes(step);
  if (
    (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
    n.operator === ts.SyntaxKind.PlusPlusToken
  ) {
    return ts.isIdentifier(n.operand) && n.operand.text === name;
  }
  return (
    ts.isBinaryExpression(n) &&
    n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
    ts.isIdentifier(n.left) &&
    n.left.text === name &&
    writtenNumber(n.right) === 1
  );
}

export function constantTripCount(loop: ts.ForStatement): number | undefined {
  const init = loop.initializer;
  if (init === undefined || !ts.isVariableDeclarationList(init)) return undefined;
  if (init.declarations.length !== 1) return undefined;
  const counter = init.declarations[0]!;
  if (!ts.isIdentifier(counter.name) || counter.initializer === undefined) return undefined;
  const name = counter.name.text;
  const start = writtenNumber(counter.initializer);
  const condition = loop.condition === undefined ? undefined : skipParenNodes(loop.condition);
  if (start === undefined || condition === undefined || !ts.isBinaryExpression(condition)) {
    return undefined;
  }
  const k = condition.operatorToken.kind;
  const inclusive = k === ts.SyntaxKind.LessThanEqualsToken;
  if (k !== ts.SyntaxKind.LessThanToken && !inclusive) return undefined;
  const left = skipParenNodes(condition.left);
  const end = writtenNumber(condition.right);
  if (!ts.isIdentifier(left) || left.text !== name || end === undefined) return undefined;
  if (!stepsByOne(name, loop.incrementor) || storesTo(name, loop.statement)) return undefined;
  const count = Math.ceil(end - start) + (inclusive && Number.isInteger(end - start) ? 1 : 0);
  return Math.max(0, count);
}

export function storeExecutions(store: ts.Node, declaration: ts.Node): number {
  let container: ts.Node | undefined = declaration.parent;
  while (container !== undefined && !ts.isFunctionLike(container) && !ts.isSourceFile(container)) {
    container = container.parent;
  }
  let times = 1;
  for (let n: ts.Node | undefined = store.parent; n !== undefined; n = n.parent) {
    if (n === container) return times;
    if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return Infinity;
    if (ts.isForStatement(n)) {
      const inBody = store.pos >= n.statement.pos && store.end <= n.statement.end;
      const inInitializer =
        n.initializer !== undefined &&
        store.pos >= n.initializer.pos &&
        store.end <= n.initializer.end;
      if (inInitializer) continue;
      const count = inBody ? constantTripCount(n) : undefined;
      if (count === undefined) return Infinity;
      times *= count;
    } else if (
      ts.isWhileStatement(n) ||
      ts.isDoStatement(n) ||
      ts.isForOfStatement(n) ||
      ts.isForInStatement(n)
    ) {
      return Infinity;
    }
  }
  return Infinity;
}

interface StoreAt {
  readonly kind: 'value' | 'compound' | 'opaque';
  readonly id?: ts.Identifier;
  readonly expr?: ts.Expression;
}

function insideLoop(store: ts.Node, declaration: ts.Node): boolean {
  for (let n: ts.Node | undefined = store.parent; n !== undefined; n = n.parent) {
    if (n.pos <= declaration.pos && declaration.end <= n.end) return false;
    if (ts.isIterationStatement(n, false)) return true;
  }
  return false;
}

export function storedInLoop(
  group: readonly ts.VariableDeclaration[],
  storesOf: (v: ts.VariableDeclaration) => readonly StoreAt[],
): boolean {
  return group.some((v) =>
    storesOf(v).some((s) => {
      const at = s.kind === 'compound' ? s.id : s.expr;
      return at !== undefined && insideLoop(at, v);
    }),
  );
}

export function groupExecutions(
  group: readonly ts.VariableDeclaration[],
  storesOf: (v: ts.VariableDeclaration) => readonly StoreAt[],
): number {
  let executions = 0;
  for (const v of group) {
    for (const s of storesOf(v)) {
      const at = s.kind === 'compound' ? s.id : s.expr;
      executions += s.kind === 'opaque' || at === undefined ? 1 : storeExecutions(at, v);
    }
  }
  return executions;
}
