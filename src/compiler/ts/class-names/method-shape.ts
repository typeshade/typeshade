import ts from 'typescript';

export function returnsThis(body: ts.Block | undefined): boolean {
  if (body === undefined) return false;
  let found = 0;
  let other = false;
  const walk = (n: ts.Node): void => {
    if (other) return;
    if (ts.isFunctionLike(n) && n !== body.parent) return;
    if (ts.isReturnStatement(n)) {
      let e = n.expression;
      while (e !== undefined && ts.isParenthesizedExpression(e)) e = e.expression;
      if (e !== undefined && e.kind === ts.SyntaxKind.ThisKeyword) found++;
      else other = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  return found > 0 && !other;
}

export const holdsFunction = (member: ts.PropertyDeclaration): boolean =>
  member.initializer !== undefined &&
  (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer));
