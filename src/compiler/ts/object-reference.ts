// ═══ An object parameter that its function writes (Rule 8.8, change 0142, stage 1) ═══
//
// Implements: Rule 8.8, Rule 8.25 (docs/language-design.md; traced in reqs/).
//
// An object is a struct, an instance of a class, or an array, and it has the identity a JavaScript
// object has: a function that writes its parameter changes the caller's object (OD-5, OD-9). The
// author writes no qualifier. This file finds, on the source, which object parameters a function
// of the file writes, so that the front end passes each as the caller's place, as it passed a
// parameter written `@inout` before change 0142.
//
// A parameter is written when its function's body:
//
//   - assigns to a field or an element of it (`p.x = v`, `p.a[i] += v`, `xs[i]++`);
//   - calls a method that changes the array it is called on (`xs.push(v)`, `xs.fill(v)`);
//   - calls on it, or on a field or an element of it, a method of a class of the file that writes
//     its own object (Rule 8.10);
//   - hands it, or a field or an element of it, to a parameter of a function of the file that is
//     itself written. A function cannot call itself (Rule 8.4), so this reading ends.
//
// A parameter that the body assigns whole (`p = new P()`) names a local from then on (Rule 8.8),
// and is not read as written here. A number, a `bool`, a vector and a matrix are values: a write
// to a component of one never makes its parameter a reference.
//
// What this file reads is the source only, so the compiler and the editor say one thing (Rule
// 12.7).

import ts from 'typescript';
import { aliasedCall } from './object-share.js';

/** The type names that are values, as a JavaScript primitive is (change 0142, decision 1). */
const VALUE_TYPE =
  /^(f16|f32|f64|i32|u32|bool|number|boolean|string|vec[234][fiuh]?|mat[234]x[234][fh]?|mat[234][fh]?|atomic|texture\w*|sampler\w*|builtin|location)$/;

/** Whether `type` is written as an object's type: an array, or a name that is none of the value
 *  types. A type alias of the file is followed to what it names. */
export function writesAnObject(type: ts.TypeNode | undefined, sourceFile: ts.SourceFile): boolean {
  const seen = new Set<string>();
  let at = type;
  while (at !== undefined) {
    while (ts.isParenthesizedTypeNode(at)) at = at.type;
    // `P | undefined`, `P | null`: an object that may be absent is an object.
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
    // A binding is what it holds: `uniform<f32>` reads as a number, `storage<array<P>>` as an
    // array.
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
    // A name the file does not declare is an import: a class or a struct of another module.
    if (alias === undefined) return true;
    at = alias;
  }
  return false;
}

/** `e` without parentheses, a non-null assertion, or a type assertion around it. */
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

/** The identifier at the root of a place, and whether the place is the bare name. */
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

/** The array methods that change the array they are called on. */
export const ARRAY_MUTATORS = new Set(['push', 'fill']);

/** The function of the file a call written `callee(...)` or `N.callee(...)` names. */
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

/** Whether a method named `name` of a class of the file writes its own object (Rule 8.10): an
 *  assignment to `this` or to a part of it, a `push` or a `fill` on a part of it, or a call on
 *  `this`, on a part of it or through `super` of a method that does. The class of the receiver is
 *  not read here, so a method of that name on any class of the file counts. */
export function methodWritesThis(name: string, sourceFile: ts.SourceFile): boolean {
  let byName = METHODS.get(sourceFile);
  if (byName === undefined) METHODS.set(sourceFile, (byName = new Map()));
  const cached = byName.get(name);
  if (cached !== undefined) return cached;
  // A method that calls itself through another is read as not writing while it is being read.
  byName.set(name, false);
  let writes = false;
  /** Whether `e` is `this`, `super`, or a field or an element of one. */
  const ownPart = (e: ts.Expression): boolean => {
    let at = bare(e);
    while (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = bare(at.expression);
    return at.kind === ts.SyntaxKind.ThisKeyword || at.kind === ts.SyntaxKind.SuperKeyword;
  };
  const visitClass = (n: ts.Node): void => {
    if (ts.isClassDeclaration(n)) {
      for (const m of n.members) {
        if (!ts.isMethodDeclaration(m) || m.body === undefined) continue;
        if (!ts.isIdentifier(m.name) || m.name.text !== name) continue;
        const scan = (b: ts.Node): void => {
          if (writes || (b !== m.body && ts.isFunctionLike(b) && !ts.isArrowFunction(b))) return;
          if (writeTargets(b).some((target) => ownPart(target))) writes = true;
          if (ts.isCallExpression(b) && ts.isPropertyAccessExpression(b.expression)) {
            const method = b.expression.name.text;
            if (
              ownPart(b.expression.expression) &&
              (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile))
            )
              writes = true;
          }
          // An argument a function of the file writes through (Rule 8.10).
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

/** The places an assignment, an increment or a decrement writes, if `node` is one. A list
 *  assignment, `[a, o.b] = list`, writes each place of its list. */
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

/** Whether `scope`, a block, a loop or a function inside a body, declares `name` again, so that
 *  the name inside it is another variable. */
function declaresAgain(scope: ts.Node, name: string): boolean {
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

/** The names of one object in `body`, from `name`: `const q = p`, `let r = q`, `for (const q of
 *  ps)` and `let b = f(a)` where `f` returns its parameter, read in both directions, so that a
 *  second name of a second name is one of them (change 0142, Table 1). */
function namesOfOneObject(name: string, body: ts.Node, sourceFile: ts.SourceFile): Set<string> {
  const names = new Set([name]);
  for (let grew = true; grew;) {
    grew = false;
    const find = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined) {
        const init = bare(n.initializer);
        const from = ts.isIdentifier(init) ? init : aliasedCall(n, sourceFile)?.argument;
        if (from !== undefined && names.has(from.text) !== names.has(n.name.text)) {
          names.add(from.text);
          names.add(n.name.text);
          grew = true;
        }
      }
      // `for (const q of ps)`: `q` names each element of `ps` in turn.
      if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
        const d = n.initializer.declarations[0];
        const root = rootOf(n.expression);
        if (
          d !== undefined &&
          ts.isIdentifier(d.name) &&
          root !== undefined &&
          names.has(root.name.text) !== names.has(d.name.text)
        ) {
          names.add(d.name.text);
          names.add(root.name.text);
          grew = true;
        }
      }
      ts.forEachChild(n, find);
    };
    find(body);
  }
  return names;
}

/** What `body` does to the object `name` names: whether it writes a field or an element of it
 *  (itself, through a method or a function that writes, or through a second name declared from
 *  it), and whether it assigns `name` whole or declares the name again. `body` is the body of the
 *  function that holds the name. */
export function objectWrites(
  name: string,
  body: ts.Node,
  sourceFile: ts.SourceFile,
): {
  readonly member: boolean;
  readonly whole: boolean;
  readonly shadowed: boolean;
  /** Each write of a field or an element through a name of the object, and each assignment of
   *  `name` whole. */
  readonly memberAt: readonly ts.Node[];
  readonly wholeAt: readonly ts.Node[];
  /** Whether a function inside the body reads or writes `name`. */
  readonly captured: boolean;
} {
  const names = namesOfOneObject(name, body, sourceFile);
  const memberAt: ts.Node[] = [];
  const wholeAt: ts.Node[] = [];
  let captured = false;
  // The scope that declares the name: the body itself for a parameter, or the first block, loop
  // or function that declares it. A scope inside that declares the name again holds another
  // variable.
  let home: ts.Node | undefined =
    ts.isFunctionLike(body) && declaresAgain(body, name) ? body : undefined;
  const findHome = (n: ts.Node): void => {
    if (home !== undefined) return;
    if (declaresAgain(n, name)) {
      home = n;
      return;
    }
    ts.forEachChild(n, findHome);
  };
  findHome(body);
  const scan = (n: ts.Node, inner: boolean): void => {
    if (n !== body && n !== home && declaresAgain(n, name)) return;
    const within = inner || (n !== body && ts.isFunctionLike(n));
    if (within && ts.isIdentifier(n) && n.text === name) captured = true;
    for (const target of writeTargets(n)) {
      const root = rootOf(target);
      if (root !== undefined && names.has(root.name.text)) {
        if (!root.whole) memberAt.push(n);
        else if (root.name.text === name) wholeAt.push(n);
      }
    }
    if (ts.isCallExpression(n)) {
      // `xs.push(v)`, `xs.fill(v)`, and a method that writes its own object (Rule 8.10).
      if (ts.isPropertyAccessExpression(n.expression)) {
        const root = rootOf(n.expression.expression);
        const method = n.expression.name.text;
        if (
          root !== undefined &&
          names.has(root.name.text) &&
          (ARRAY_MUTATORS.has(method) || methodWritesThis(method, sourceFile))
        )
          memberAt.push(n);
      }
      // An argument a function of the file writes through.
      const callee = fileFunction(n, sourceFile);
      if (callee !== undefined) {
        n.arguments.forEach((a, i) => {
          const root = rootOf(a);
          const q = callee.parameters[i];
          if (
            root !== undefined &&
            names.has(root.name.text) &&
            q !== undefined &&
            takesThePlace(q, sourceFile)
          )
            memberAt.push(n);
        });
      }
    }
    ts.forEachChild(n, (c) => scan(c, within));
  };
  scan(body, false);
  return {
    member: memberAt.length > 0,
    whole: wholeAt.length > 0,
    shadowed: false,
    memberAt,
    wholeAt,
    captured,
  };
}

/** Whether `q` names its caller's place: an object parameter its function writes, or a parameter
 *  that still carries a written `@inout` or `@out`. */
export function takesThePlace(q: ts.ParameterDeclaration, sourceFile: ts.SourceFile): boolean {
  const qualified = (ts.canHaveDecorators(q) ? (ts.getDecorators(q) ?? []) : []).some(
    (d) =>
      ts.isIdentifier(d.expression) &&
      (d.expression.text === 'inout' || d.expression.text === 'out'),
  );
  return qualified || isWrittenObjectParameter(q, sourceFile);
}

const WRITTEN = new WeakMap<ts.ParameterDeclaration, boolean>();
const READING = new Set<ts.ParameterDeclaration>();

/**
 * Whether `p` is an object parameter that its function writes, so that it names the caller's
 * object (change 0142, stage 1). `p` is a parameter of a function declaration of the file or of a
 * namespace; every other kind of function takes values until stage 2.
 */
export function isWrittenObjectParameter(
  p: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  const known = WRITTEN.get(p);
  if (known !== undefined) return known;
  const fn = p.parent;
  if (
    !ts.isFunctionDeclaration(fn) ||
    fn.body === undefined ||
    fn.typeParameters !== undefined ||
    !ts.isIdentifier(p.name) ||
    !writesAnObject(p.type, sourceFile) ||
    READING.has(p)
  )
    return false;
  READING.add(p);
  const w = objectWrites(p.name.text, fn.body, sourceFile);
  READING.delete(p);
  // A parameter the body assigns whole names a local (Rule 8.8); a shadowed name is not read.
  const written = w.member && !w.whole && !w.shadowed;
  WRITTEN.set(p, written);
  return written;
}
