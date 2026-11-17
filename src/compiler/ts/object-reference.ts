// ═══ An object parameter that its function writes (Rule 8.8, change 0142, stage 1) ═══
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
    if (ts.isArrayTypeNode(at) || ts.isTypeLiteralNode(at) || ts.isTupleTypeNode(at)) return true;
    if (!ts.isTypeReferenceNode(at) || !ts.isIdentifier(at.typeName)) return false;
    const name = at.typeName.text;
    if (name === 'array' || name === 'Array') return true;
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
          const target = writeTarget(b);
          if (target !== undefined && ownPart(target)) writes = true;
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

/** The place an assignment, an increment or a decrement writes, if `node` is one. */
export function writeTarget(node: ts.Node): ts.Expression | undefined {
  if (ts.isBinaryExpression(node)) {
    const k = node.operatorToken.kind;
    return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment
      ? node.left
      : undefined;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    const k = node.operator;
    return k === ts.SyntaxKind.PlusPlusToken || k === ts.SyntaxKind.MinusMinusToken
      ? node.operand
      : undefined;
  }
  return undefined;
}

/** What `body` does to the object `name` names: whether it writes a field or an element of it
 *  (itself, through a method or a function that writes, or through a second name declared from
 *  it), and whether it assigns `name` whole or declares the name again. `body` is the body of the
 *  function that holds the name. */
export function objectWrites(
  name: string,
  body: ts.Node,
  sourceFile: ts.SourceFile,
): { readonly member: boolean; readonly whole: boolean; readonly shadowed: boolean } {
  // The second names of the object: `const q = p`, `let r = q` (change 0142, Table 1).
  const names = new Set([name]);
  for (let grew = true; grew;) {
    grew = false;
    const find = (n: ts.Node): void => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.initializer !== undefined &&
        !names.has(n.name.text)
      ) {
        const init = bare(n.initializer);
        if (ts.isIdentifier(init) && names.has(init.text)) {
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
          names.has(root.name.text) &&
          !names.has(d.name.text)
        ) {
          names.add(d.name.text);
          grew = true;
        }
      }
      ts.forEachChild(n, find);
    };
    find(body);
  }
  let member = false;
  let whole = false;
  let shadowed = false;
  const scan = (n: ts.Node): void => {
    if (n !== body && ts.isFunctionLike(n)) {
      // A local function that declares the name again hides it.
      if (n.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === name)) return;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name)
      shadowed = true;
    const target = writeTarget(n);
    if (target !== undefined) {
      const root = rootOf(target);
      if (root !== undefined && names.has(root.name.text)) {
        if (!root.whole) member = true;
        else if (root.name.text === name) whole = true;
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
          member = true;
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
            member = true;
        });
      }
    }
    ts.forEachChild(n, scan);
  };
  scan(body);
  return { member, whole, shadowed };
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
