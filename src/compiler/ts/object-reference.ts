// Why: Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { aliasedCall } from './new-object.js';
import { Reader } from './source-types.js';
import { takesThePlace, accessorMayWrite } from './object-reference/written.js';

const VALUE_TYPE =
  /^(f16|f32|f64|i32|u32|bool|number|boolean|string|Map|Set|ReadonlyMap|ReadonlySet|vec[234][fiuh]?|mat[234]x[234][fh]?|mat[234][fh]?|atomic|texture\w*|sampler\w*|builtin|location)$/;

export function writesAnObject(type: ts.TypeNode | undefined, sourceFile: ts.SourceFile): boolean {
  const seen = new Set<string>();
  let at = type;
  while (at !== undefined) {
    while (ts.isParenthesizedTypeNode(at)) at = at.type;
    if (ts.isUnionTypeNode(at)) {
      return at.types.some(
        (t) =>
          t.kind !== ts.SyntaxKind.UndefinedKeyword &&
          !(ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword) &&
          writesAnObject(t, sourceFile),
      );
    }
    if (ts.isArrayTypeNode(at) || ts.isTypeLiteralNode(at) || ts.isTupleTypeNode(at)) return true;
    if (!ts.isTypeReferenceNode(at) || !ts.isIdentifier(at.typeName)) return false;
    const name = at.typeName.text;
    if (name === 'array' || name === 'Array') return true;
    if (name === 'uniform' || name === 'storage' || name === 'override' || name === 'workgroup') {
      at = at.typeArguments?.[0];
      continue;
    }
    if (VALUE_TYPE.test(name)) return false;
    if (seen.has(name)) return false;
    seen.add(name);
    let alias: ts.TypeNode | undefined;
    let declared = false;
    for (const st of sourceFile.statements) {
      if (ts.isTypeAliasDeclaration(st) && st.name.text === name) alias = st.type;
      if ((ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name?.text === name)
        declared = true;
    }
    if (declared) return true;
    if (alias === undefined) return true;
    at = alias;
  }
  return false;
}

export function bare(e: ts.Expression): ts.Expression {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isNonNullExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x)
  )
    x = x.expression;
  return x;
}

export function rootOf(place: ts.Expression): { name: ts.Identifier; whole: boolean } | undefined {
  let at = bare(place);
  let whole = true;
  for (;;) {
    if (ts.isIdentifier(at)) return { name: at, whole };
    if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at)) {
      at = bare(at.expression);
      whole = false;
    } else return undefined;
  }
}

export const ARRAY_MUTATORS = new Set(['push', 'fill']);

export function fileFunction(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.FunctionDeclaration | undefined {
  const path: string[] = [];
  let at: ts.Expression = call.expression;
  while (ts.isPropertyAccessExpression(at)) {
    path.unshift(at.name.text);
    at = at.expression;
  }
  if (!ts.isIdentifier(at)) return undefined;
  path.unshift(at.text);
  let statements: readonly ts.Statement[] = sourceFile.statements;
  for (const [i, name] of path.entries()) {
    const last = i === path.length - 1;
    let next: readonly ts.Statement[] | undefined;
    for (const st of statements) {
      if (last && ts.isFunctionDeclaration(st) && st.name?.text === name && st.body) return st;
      if (!last && ts.isModuleDeclaration(st) && st.name.text === name) {
        let b = st.body;
        while (b !== undefined && ts.isModuleDeclaration(b)) b = b.body;
        if (b !== undefined && ts.isModuleBlock(b)) next = b.statements;
      }
    }
    if (next === undefined) return undefined;
    statements = next;
  }
  return undefined;
}

export function ownParts(
  body: ts.Node,
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, { readonly from: ts.Expression; readonly element: boolean }> {
  const parts = new Map<string, { from: ts.Expression; element: boolean }>();
  const reader = new Reader(sourceFile);
  const rooted = (e: ts.Expression): boolean => {
    let at = bare(e);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = bare(at.expression);
    return (
      at.kind === ts.SyntaxKind.ThisKeyword ||
      at.kind === ts.SyntaxKind.SuperKeyword ||
      (ts.isIdentifier(at) && parts.has(at.text))
    );
  };
  for (let grew = true; grew;) {
    grew = false;
    const find = (b: ts.Node): void => {
      let from: ts.Expression | undefined;
      let into: ts.Identifier | undefined;
      let element = false;
      if (ts.isVariableDeclaration(b) && ts.isIdentifier(b.name) && b.initializer) {
        from = b.initializer;
        into = b.name;
      } else if (
        ts.isForOfStatement(b) &&
        ts.isVariableDeclarationList(b.initializer) &&
        ts.isIdentifier(b.initializer.declarations[0]!.name)
      ) {
        from = b.expression;
        into = b.initializer.declarations[0]!.name as ts.Identifier;
        element = true;
      }
      if (from !== undefined && into !== undefined && !parts.has(into.text)) {
        if (rooted(from) && (element || reader.isObject(from))) {
          parts.set(into.text, { from, element });
          grew = true;
        }
      }
      ts.forEachChild(b, find);
    };
    find(body);
  }
  return parts;
}

export function methodWritesThis(name: string, sourceFile: ts.SourceFile): boolean {
  let byName = METHODS.get(sourceFile);
  if (byName === undefined) METHODS.set(sourceFile, (byName = new Map()));
  const cached = byName.get(name);
  if (cached !== undefined) return cached;
  byName.set(name, false);
  let writes = false;
  const visitClass = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) {
      for (const m of n.members) {
        if (!ts.isMethodDeclaration(m) || m.body === undefined) continue;
        if (!ts.isIdentifier(m.name) || m.name.text !== name) continue;
        const parts = ownParts(m.body, sourceFile);
        const ownPart = (e: ts.Expression): boolean => {
          let at = bare(e);
          while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
            at = bare(at.expression);
          return (
            at.kind === ts.SyntaxKind.ThisKeyword ||
            at.kind === ts.SyntaxKind.SuperKeyword ||
            (ts.isIdentifier(at) && parts.has(at.text))
          );
        };
        const scan = (b: ts.Node): void => {
          if (writes || (b !== m.body && ts.isFunctionLike(b) && !ts.isArrowFunction(b))) return;
          if (writeTargets(b).some((target) => ownPart(target))) writes = true;
          if (
            ts.isPropertyAccessExpression(b) &&
            !(ts.isCallExpression(b.parent) && b.parent.expression === b) &&
            ownPart(b.expression) &&
            accessorMayWrite(b.name.text, sourceFile)
          )
            writes = true;
          if (ts.isCallExpression(b) && ts.isPropertyAccessExpression(b.expression)) {
            const method = b.expression.name.text;
            if (
              ownPart(b.expression.expression) &&
              (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile))
            )
              writes = true;
          }
          if (ts.isCallExpression(b)) {
            const callee = fileFunction(b, sourceFile);
            if (callee !== undefined) {
              b.arguments.forEach((a, i) => {
                const q = callee.parameters[i];
                if (q !== undefined && ownPart(a) && takesThePlace(q, sourceFile)) writes = true;
              });
            }
          }
          ts.forEachChild(b, scan);
        };
        scan(m.body);
      }
    }
    ts.forEachChild(n, visitClass);
  };
  visitClass(sourceFile);
  byName.set(name, writes);
  return writes;
}
const METHODS = new WeakMap<ts.SourceFile, Map<string, boolean>>();

export function writeTargets(node: ts.Node): readonly ts.Expression[] {
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    if (k < ts.SyntaxKind.FirstAssignment || k > ts.SyntaxKind.LastAssignment) return [];
    const left = bare(node.left);
    if (k === ts.SyntaxKind.EqualsToken && ts.isArrayLiteralExpression(left)) {
      return left.elements.filter((e) => !ts.isOmittedExpression(e) && !ts.isSpreadElement(e));
    }
    return [node.left];
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const k = node.operator;
    return k === ts.SyntaxKind.PlusPlusToken || k === ts.SyntaxKind.MinusMinusToken
      ? [node.operand]
      : [];
  }
  return [];
}

export function declaresAgain(scope: ts.Node, name: string): boolean {
  const named = (list: ts.VariableDeclarationList): boolean =>
    list.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);
  if (ts.isBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return scope.statements.some((st) => ts.isVariableStatement(st) && named(st.declarationList));
  }
  if (ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) {
    const init = scope.initializer;
    return init !== undefined && ts.isVariableDeclarationList(init) && named(init);
  }
  if (ts.isFunctionLike(scope)) {
    return scope.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === name);
  }
  return false;
}

export function namesOfOneObject(
  name: string,
  body: ts.Node,
  sourceFile: ts.SourceFile,
): Set<string> {
  const names = new Set([name]);
  const reader = new Reader(sourceFile);
  for (let grew = true; grew;) {
    grew = false;
    const join = (a: string, b: string): void => {
      if (names.has(a) === names.has(b)) return;
      names.add(a);
      names.add(b);
      grew = true;
    };
    const find = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
        const init = bare(n.initializer);
        const from = aliasedCall(n, sourceFile)?.argument ?? init;
        const root = rootOf(from);
        if (root !== undefined && (root.whole || reader.isObject(from)))
          join(root.name.text, n.name.text);
      }
      if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
        const d = n.initializer.declarations[0];
        const root = rootOf(n.expression);
        if (d !== undefined && ts.isIdentifier(d.name) && root !== undefined)
          join(root.name.text, d.name.text);
      }
      ts.forEachChild(n, find);
    };
    find(body);
  }
  return names;
}
