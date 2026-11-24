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

export const isShift = (k: ts.SyntaxKind): boolean =>
  k === ts.SyntaxKind.LessThanLessThanToken || k === ts.SyntaxKind.GreaterThanGreaterThanToken;

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

export function typeScriptBitOp(k: ts.SyntaxKind, x: number, y: number): number {
  switch (k) {
    case ts.SyntaxKind.BarToken:
      return x | y;
    case ts.SyntaxKind.AmpersandToken:
      return x & y;
    case ts.SyntaxKind.CaretToken:
      return x ^ y;
    case ts.SyntaxKind.LessThanLessThanToken:
      return x << (y & 31);
    default:
      return x >> (y & 31);
  }
}

const BIT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
]);

export function bitOperands(n: ts.Node): ts.Expression[] {
  if (ts.isBinaryExpression(n) && BIT_OPERATORS.has(n.operatorToken.kind)) {
    return [skipParenNodes(n.left), skipParenNodes(n.right)];
  }
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.TildeToken) {
    return [skipParenNodes(n.operand)];
  }
  return [];
}

export function isTreeSource(n: ts.Node, typed: (e: ts.Expression) => boolean): boolean {
  if (ts.isNumericLiteral(n)) return isBigNumber(Number(n.text));
  const operands = bitOperands(n);
  return operands.length > 0 && !operands.some(typed);
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

const JOINED_BOTH: ReadonlySet<ts.SyntaxKind> = new Set([
  ...[ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken],
  ...[ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken],
  ...[ts.SyntaxKind.BarToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.CaretToken],
]);

const JOINED_LEFT: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
]);

const STORE_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ...[ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken],
  ...[ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.BarEqualsToken],
  ...[ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.CaretEqualsToken],
]);

function isSelectCall(n: ts.Node): n is ts.CallExpression {
  return (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'select' &&
    n.arguments.length === 3
  );
}

function joinedIdentifiers(e: ts.Expression): ts.Identifier[] {
  const n = skipParenNodes(e);
  if (ts.isIdentifier(n)) return [n];
  if (
    ts.isPrefixUnaryExpression(n) &&
    (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.TildeToken)
  ) {
    return joinedIdentifiers(n.operand);
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (JOINED_LEFT.has(k)) return joinedIdentifiers(n.left);
    return JOINED_BOTH.has(k) ? [...joinedIdentifiers(n.left), ...joinedIdentifiers(n.right)] : [];
  }
  if (ts.isConditionalExpression(n)) {
    return [...joinedIdentifiers(n.whenTrue), ...joinedIdentifiers(n.whenFalse)];
  }
  return isSelectCall(n)
    ? [...joinedIdentifiers(n.arguments[0]!), ...joinedIdentifiers(n.arguments[1]!)]
    : [];
}

export function peerOperands(n: ts.Node): (readonly [ts.Identifier, ts.Expression])[] {
  if (ts.isBinaryExpression(n) && STORE_OPERATORS.has(n.operatorToken.kind)) {
    const target = skipParenNodes(n.left);
    if (!ts.isIdentifier(target)) return [];
    return joinedIdentifiers(n.right)
      .filter((id) => id.text !== target.text)
      .map((id) => [id, target] as const);
  }
  let sides: readonly [ts.Expression, ts.Expression] | undefined;
  if (ts.isBinaryExpression(n) && PEER_OPERATORS.has(n.operatorToken.kind)) {
    sides = [n.left, n.right];
  } else if (ts.isConditionalExpression(n)) {
    sides = [n.whenTrue, n.whenFalse];
  } else if (isSelectCall(n)) {
    sides = [n.arguments[0]!, n.arguments[1]!];
  }
  if (sides === undefined) return [];
  const [l, r] = [skipParenNodes(sides[0]), skipParenNodes(sides[1])];
  return [
    ...(ts.isNumericLiteral(r) ? [] : joinedIdentifiers(l).map((id) => [id, r] as const)),
    ...(ts.isNumericLiteral(l) ? [] : joinedIdentifiers(r).map((id) => [id, l] as const)),
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

export const ONE = ts.factory.createNumericLiteral(1);
export const COUNTING_BUILTINS = new Set([
  'countOneBits',
  'countLeadingZeros',
  'countTrailingZeros',
]);

export function constantValue(
  node: ts.Expression,
  initializerOf: (id: ts.Identifier) => ts.Expression | undefined,
  depth = 0,
): number | undefined {
  const n = skipParenNodes(node);
  if (depth > 32) return undefined;
  const v = writtenNumber(n);
  if (v !== undefined) return v;
  if (ts.isIdentifier(n)) {
    const init = initializerOf(n);
    return init === undefined ? undefined : constantValue(init, initializerOf, depth + 1);
  }
  if (ts.isPrefixUnaryExpression(n)) {
    const x = constantValue(n.operand, initializerOf, depth + 1);
    if (x === undefined) return undefined;
    return n.operator === ts.SyntaxKind.MinusToken
      ? -x
      : n.operator === ts.SyntaxKind.TildeToken
        ? ~x
        : undefined;
  }
  if (!ts.isBinaryExpression(n)) return undefined;
  const a = constantValue(n.left, initializerOf, depth + 1);
  const b = constantValue(n.right, initializerOf, depth + 1);
  if (a === undefined || b === undefined) return undefined;
  switch (n.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return a + b;
    case ts.SyntaxKind.MinusToken:
      return a - b;
    case ts.SyntaxKind.AsteriskToken:
      return a * b;
    case ts.SyntaxKind.BarToken:
      return a | b;
    case ts.SyntaxKind.AmpersandToken:
      return a & b;
    case ts.SyntaxKind.CaretToken:
      return a ^ b;
    case ts.SyntaxKind.LessThanLessThanToken:
      return a << (b & 31);
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return a >> (b & 31);
    default:
      return undefined;
  }
}

export function reachedBy(
  entries: readonly (readonly [ts.Node, readonly ts.Expression[]])[],
  reads: (id: ts.Identifier, reached: ReadonlySet<ts.Node>) => boolean,
): Set<ts.Node> {
  const reached = new Set<ts.Node>();
  const holds = (e: ts.Node): boolean =>
    (ts.isNumericLiteral(e) && isBigNumber(Number(e.text))) ||
    (ts.isIdentifier(e) && reads(e, reached)) ||
    ts.forEachChild(e, (c) => (holds(c) ? true : undefined)) === true;
  for (let more = true; more;) {
    more = false;
    for (const [d, exprs] of entries) {
      if (!reached.has(d) && exprs.some(holds)) more = reached.add(d) !== undefined;
    }
  }
  return reached;
}

export function i32Argument(arg: ts.Expression): ts.Expression | undefined {
  const n = skipParenNodes(arg);
  return ts.isCallExpression(n) && n.expression.getText() === 'i32' ? n.arguments[0] : undefined;
}
