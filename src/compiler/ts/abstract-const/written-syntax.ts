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
