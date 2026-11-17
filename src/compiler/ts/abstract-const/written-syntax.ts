import ts from 'typescript';

type Scalar = 'f32' | 'i32' | 'u32';

export function scalarOfTypeText(text: string): Scalar | undefined {
  const t = text.replace(/\s+/g, '');
  if (t === 'f32' || t === 'i32' || t === 'u32') return t;
  const m = /^vec[234]([fiu])$|^vec[234]<([fiu])32>$/.exec(t);
  if (m !== null) return `${(m[1] ?? m[2])!}32` as Scalar;
  if (/^vec[234]$/.test(t)) return 'f32';
  return undefined;
}

export function skipParenNodes(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? skipParenNodes(node.expression) : node;
}

export function writtenNumber(node: ts.Expression): number | undefined {
  const n = skipParenNodes(node);
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) {
    const v = writtenNumber(n.operand);
    return v === undefined ? undefined : -v;
  }
  return undefined;
}

export const isBigNumber = (v: number): boolean => v > 2147483647 && v <= 4294967295;

export function constantTree(node: ts.Expression): boolean {
  const n = skipParenNodes(node);
  if (writtenNumber(n) !== undefined) return true;
  if (ts.isPrefixUnaryExpression(n)) return constantTree(n.operand);
  return ts.isBinaryExpression(n) && constantTree(n.left) && constantTree(n.right);
}

export function writtenBitTree(node: ts.Expression): boolean {
  const n = skipParenNodes(node);
  const leaf = (e: ts.Expression): boolean => writtenNumber(e) !== undefined || writtenBitTree(e);
  if (ts.isPrefixUnaryExpression(n)) {
    return (
      (n.operator === ts.SyntaxKind.TildeToken && leaf(n.operand)) ||
      (n.operator === ts.SyntaxKind.MinusToken && writtenBitTree(n.operand))
    );
  }
  if (!ts.isBinaryExpression(n)) return false;
  const k = n.operatorToken.kind;
  const bit =
    k === ts.SyntaxKind.BarToken ||
    k === ts.SyntaxKind.AmpersandToken ||
    k === ts.SyntaxKind.CaretToken ||
    k === ts.SyntaxKind.LessThanLessThanToken ||
    k === ts.SyntaxKind.GreaterThanGreaterThanToken;
  return bit && leaf(n.left) && leaf(n.right);
}

export function returnsOf(body: ts.Block): ts.Expression[] {
  const returns: ts.Expression[] = [];
  const walk = (x: ts.Node): void => {
    if (ts.isReturnStatement(x) && x.expression !== undefined) returns.push(x.expression);
    else if (!ts.isFunctionLike(x)) ts.forEachChild(x, walk);
  };
  ts.forEachChild(body, walk);
  return returns;
}

export const COMPOUND_BASE = new Map<ts.SyntaxKind, ts.BinaryOperator>([
  [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
  [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
  [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
  [ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.BarToken],
  [ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.AmpersandToken],
  [ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.CaretToken],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.LessThanLessThanToken],
]);

export const ARITH: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

export const BITWISE: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
]);

export function integerWrittenLiteral(node: ts.NumericLiteral): boolean {
  const written = node.getText();
  return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
}

const PATTERN_PARTS = (n: ts.Node): boolean =>
  ts.isArrayLiteralExpression(n) ||
  ts.isObjectLiteralExpression(n) ||
  ts.isPropertyAssignment(n) ||
  ts.isShorthandPropertyAssignment(n) ||
  ts.isSpreadElement(n) ||
  ts.isParenthesizedExpression(n);

export function destructuringSource(target: ts.Node): ts.Expression | undefined {
  let n = target;
  while (PATTERN_PARTS(n.parent)) n = n.parent;
  if (n === target) return undefined;
  const p = n.parent;
  if (ts.isBinaryExpression(p) && p.left === n) {
    return p.operatorToken.kind === ts.SyntaxKind.EqualsToken ? p.right : undefined;
  }
  return (ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === n
    ? p.expression
    : undefined;
}

export function containsPart(e: ts.Node, part: (e: ts.Expression) => boolean): boolean {
  if (ts.isExpression(e) && part(e)) return true;
  return ts.forEachChild(e, (c) => (containsPart(c, part) ? true : undefined)) === true;
}

const PEER_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ...[ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken],
  ...[ts.SyntaxKind.BarToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.CaretToken],
  ...[ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken],
  ...[ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken],
  ...[ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken],
]);

export function peerOperands(n: ts.Node): (readonly [ts.Identifier, ts.Expression])[] {
  if (!ts.isBinaryExpression(n) || !PEER_OPERATORS.has(n.operatorToken.kind)) return [];
  const [l, r] = [skipParenNodes(n.left), skipParenNodes(n.right)];
  return [
    ...(ts.isIdentifier(l) ? [[l, r] as const] : []),
    ...(ts.isIdentifier(r) ? [[r, l] as const] : []),
  ];
}

export function isBitwise(node: ts.Node): boolean {
  return (
    (ts.isBinaryExpression(node) && BITWISE.has(node.operatorToken.kind)) ||
    (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken)
  );
}

export function wrapList(subjects: readonly string[]): string {
  const quoted = [...new Set(subjects)].map((s) => `"${s}"`);
  if (quoted.length <= 1) return quoted[0] ?? 'an operand';
  return `each of ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]!}`;
}

export function maskValue(
  node: ts.Expression,
  constantOf: (id: ts.Identifier) => readonly [ts.Expression, boolean] | undefined,
  declared = false,
): number | undefined {
  const n = skipParenNodes(node);
  const constant = ts.isIdentifier(n) ? constantOf(n) : undefined;
  if (constant !== undefined) return maskValue(constant[0], constantOf, constant[1]);
  const call = ts.isCallExpression(n) && /^[iu]32$/.test(n.expression.getText()) ? n : undefined;
  const v = declared ? writtenNumber(n) : call && writtenNumber(call.arguments[0]!);
  return v !== undefined && Number.isInteger(v) && v >= 0 && v <= 0x7fffffff ? v : undefined;
}
