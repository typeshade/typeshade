import ts from 'typescript';

const identifiersOf = new WeakMap<ts.SourceFile, Map<string, ts.Identifier[]>>();

export function nodeSpanning(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (found !== undefined || n.getStart(sourceFile) > start || n.getEnd() < end) return;
    if (n.getStart(sourceFile) === start && n.getEnd() === end) found = n;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export function floatPositionOperands(at: ts.Node): ts.Expression[] {
  if (ts.isReturnStatement(at)) return at.expression === undefined ? [] : [at.expression];
  if (ts.isVariableDeclaration(at)) return at.initializer === undefined ? [] : [at.initializer];
  if (ts.isBinaryExpression(at)) return [at.left, at.right];
  if (ts.isCallExpression(at) || ts.isNewExpression(at)) return [...(at.arguments ?? [])];
  if (ts.isExpression(at) && ts.isCallExpression(at.parent)) return [...at.parent.arguments];
  return [];
}

export function nodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (n.getStart(sourceFile) <= offset && offset < n.getEnd()) {
      if (n.getStart(sourceFile) === offset) found = n;
      ts.forEachChild(n, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export function isTypedConstructor(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isIdentifier(callee)) return false;
  if (/^(vec[234]|mat[234]x[234])[uifh]$/.test(callee.text)) return true;
  return /^(vec[234]|mat[234]x[234])$/.test(callee.text) && (call.typeArguments?.length ?? 0) > 0;
}

export function identifiersNamed(
  sourceFile: ts.SourceFile,
  name: string,
): readonly ts.Identifier[] {
  let index = identifiersOf.get(sourceFile);
  if (index === undefined) {
    const found = new Map<string, ts.Identifier[]>();
    const visit = (k: ts.Node): void => {
      if (ts.isIdentifier(k)) {
        const list = found.get(k.text);
        if (list === undefined) found.set(k.text, [k]);
        else list.push(k);
      }
      ts.forEachChild(k, visit);
    };
    visit(sourceFile);
    identifiersOf.set(sourceFile, (index = found));
  }
  return index.get(name) ?? [];
}

export function skipParenUp(n: ts.Node): ts.Node {
  let u = n;
  while (ts.isParenthesizedExpression(u.parent)) u = u.parent;
  return u;
}

export function regionOf(node: ts.Node, sourceFile: ts.SourceFile): readonly [number, number] {
  let n: ts.Node = node;
  while (
    n.parent !== undefined &&
    !ts.isSourceFile(n.parent) &&
    !(ts.isStatement(n) && !ts.isBlock(n)) &&
    !ts.isClassElement(n)
  ) {
    n = n.parent;
  }
  return [n.getStart(sourceFile), n.getEnd()];
}

export function inIntegerSlot(leaf: ts.Node, within: ts.Node): boolean {
  for (let n: ts.Node = leaf; n !== within && n.parent !== undefined; n = n.parent) {
    const up = n.parent;
    if (ts.isElementAccessExpression(up) && up.argumentExpression === n) return true;
    if (
      ts.isBinaryExpression(up) &&
      up.right === n &&
      (up.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken ||
        up.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanToken ||
        up.operatorToken.kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken)
    )
      return true;
    if (up === within) break;
  }
  return false;
}
