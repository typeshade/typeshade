import ts from 'typescript';
import { isStaticMember } from './member-modifiers.js';

export function staticThisMember(node: ts.Node): ts.ClassElement | undefined {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) {
    if (ts.isArrowFunction(at)) continue;
    if (
      ts.isMethodDeclaration(at) ||
      ts.isGetAccessorDeclaration(at) ||
      ts.isSetAccessorDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isClassStaticBlockDeclaration(at)
    ) {
      return ts.isClassStaticBlockDeclaration(at) || isStaticMember(at) ? at : undefined;
    }
    if (ts.isFunctionLike(at) || ts.isClassLike(at)) return undefined;
  }
  return undefined;
}

export function staticThisClass(node: ts.Node): ts.ClassDeclaration | undefined {
  const owner = staticThisMember(node)?.parent;
  return owner !== undefined && ts.isClassDeclaration(owner) ? owner : undefined;
}

export function callerClassForm(
  method: ts.MethodDeclaration | ts.AccessorDeclaration,
): { readonly thisParam: ts.ParameterDeclaration; readonly typeParam: string } | undefined {
  const first = method.parameters[0];
  if (first === undefined || !ts.isIdentifier(first.name) || first.name.text !== 'this') {
    return undefined;
  }
  const t = first.type;
  if (t === undefined || !ts.isTypeLiteralNode(t)) return undefined;
  const ctor = t.members.find(ts.isConstructSignatureDeclaration);
  const built = ctor?.type;
  if (built === undefined || !ts.isTypeReferenceNode(built) || !ts.isIdentifier(built.typeName)) {
    return undefined;
  }
  const name = built.typeName.text;
  const own = (method as ts.MethodDeclaration).typeParameters?.some((p) => p.name.text === name);
  const ret = method.type;
  const returnsIt =
    ret !== undefined &&
    ts.isTypeReferenceNode(ret) &&
    ts.isIdentifier(ret.typeName) &&
    ret.typeName.text === name;
  return own === true && returnsIt ? { thisParam: first, typeParam: name } : undefined;
}

// Why: TypeScript lets `new this()` build whatever class the call names under the `this`
// parameter of 0020, an `abstract` one aside, which the call alone is refused for (TS2684);
// without it `this` is the class that declares the member, and a `new` of it is refused when
// that class is abstract (TS2511).
export function isCallerClassThis(node: ts.Node): boolean {
  const member = staticThisMember(node);
  return (
    member !== undefined && ts.isMethodDeclaration(member) && callerClassForm(member) !== undefined
  );
}

export function buildsCallerClass(member: ts.Node): boolean {
  if (!ts.isMethodDeclaration(member) || !isStaticMember(member) || member.body === undefined) {
    return false;
  }
  if (callerClassForm(member) === undefined) return false;
  let builds = false;
  const walk = (n: ts.Node): void => {
    if (builds) return;
    if (ts.isNewExpression(n)) {
      let target: ts.Expression = n.expression;
      while (ts.isParenthesizedExpression(target)) target = target.expression;
      if (target.kind === ts.SyntaxKind.ThisKeyword) {
        builds = true;
        return;
      }
    }
    if ((ts.isFunctionLike(n) && !ts.isArrowFunction(n)) || ts.isClassLike(n)) return;
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(member.body, walk);
  return builds;
}
