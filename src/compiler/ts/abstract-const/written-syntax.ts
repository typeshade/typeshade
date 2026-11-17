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
