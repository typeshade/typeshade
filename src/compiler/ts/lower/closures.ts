// ═══ What a local function captures (Rule 8.17) ═══
//
// A local function is a function of the module (local-functions.ts), and neither target has a
// closure to carry the body around it in. It does not need one. A function is no value here:
// nothing can return one, store one or choose one at run time, so every call of a local
// function is written inside the scope that declares it, where every variable it reads from
// the function around it is in scope too. Each such variable is a parameter the lifted
// function takes and every call passes, and the closure is gone.
//
// This file answers the one question that needs the source: which variables. A name read in
// the function's body is looked up the way TypeScript looks it up, from the innermost block
// out, and it is captured when that lookup lands in a function around this one: its `let`,
// its `const`, a parameter. A name found at the top of the file or of a namespace is the
// module's and is read directly; one found inside the function is its own. An arrow function's
// `this` is the one around it, which makes the object of the method around it a capture too.
//
// Whether a capture is passed by value or by reference is not decided here. It is decided by
// the body, as it is lowered: the parameter starts as a value, and the first write through it
// makes it a reference to the variable (`Binding.capture`, context.ts), which is what a
// closure's write does.

import ts from 'typescript';

/** The functions a local function may be written as. */
export type LocalFunctionLike = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** A name the function reads from a function around it. */
export interface CapturedName {
  /** What declares it: a variable declaration, a destructured element, or a parameter. */
  readonly decl: ts.Node;
  /** The name it is read under. */
  readonly name: string;
}

/** What one local function reads from the functions around it. */
export interface ClosureUse {
  /** The variables, in the order they are first read. */
  readonly captures: readonly CapturedName[];
  /** The local functions declared outside this one that it names, by their declaration. */
  readonly calls: ReadonlySet<ts.Node>;
  /** Whether it reads the `this` of the method around it: it, or an arrow function inside it,
   *  is an arrow function that reads `this`. */
  readonly usesThis: boolean;
}

/** Whether `name` is `pattern`, or one of the names a destructuring `pattern` binds, and the
 *  node that binds it. */
function binderOf(pattern: ts.BindingName, name: string): ts.Node | undefined {
  if (ts.isIdentifier(pattern)) return pattern.text === name ? pattern : undefined;
  for (const el of pattern.elements) {
    if (ts.isOmittedExpression(el)) continue;
    const hit = binderOf(el.name, name);
    if (hit !== undefined) return ts.isIdentifier(el.name) ? el : hit;
  }
  return undefined;
}

/** The node that declares `name` in `decl`, the one {@link declarationOf} answers with: the
 *  declaration itself for a plain name, the element for a name a destructuring pattern binds. */
export function declaringNode(decl: ts.VariableDeclaration, name: string): ts.Node {
  if (ts.isIdentifier(decl.name)) return decl;
  const hit = binderOf(decl.name, name);
  return hit ?? decl;
}

/** The declaration a statement list makes of `name`, block-scoped as `let`, `const`, a class
 *  and a function declaration all are. */
function declaredIn(statements: readonly ts.Statement[], name: string): ts.Node | undefined {
  for (const st of statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const hit = binderOf(d.name, name);
        if (hit !== undefined) return ts.isIdentifier(d.name) ? d : hit;
      }
    } else if (
      (ts.isFunctionDeclaration(st) ||
        ts.isClassDeclaration(st) ||
        ts.isEnumDeclaration(st) ||
        ts.isModuleDeclaration(st)) &&
      st.name !== undefined &&
      ts.isIdentifier(st.name) &&
      st.name.text === name
    ) {
      return st;
    }
  }
  return undefined;
}

/** The declaration `id` names, found the way TypeScript finds it: the innermost block, loop
 *  header, parameter list or catch clause around it that declares the name, and so outward to
 *  the file. Undefined for a name nothing in the file declares (a builtin, an ambient name). */
export function declarationOf(id: ts.Identifier): ts.Node | undefined {
  const name = id.text;
  for (let at: ts.Node | undefined = id.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) {
      for (const p of at.parameters) {
        const hit = binderOf(p.name, name);
        if (hit !== undefined) return ts.isIdentifier(p.name) ? p : hit;
      }
      if (ts.isFunctionExpression(at) && at.name?.text === name) return at;
    }
    if (ts.isBlock(at) || ts.isSourceFile(at) || ts.isModuleBlock(at)) {
      const hit = declaredIn(at.statements, name);
      if (hit !== undefined) return hit;
    }
    if (ts.isCaseBlock(at)) {
      for (const clause of at.clauses) {
        const hit = declaredIn(clause.statements, name);
        if (hit !== undefined) return hit;
      }
    }
    if (
      (ts.isForStatement(at) || ts.isForOfStatement(at) || ts.isForInStatement(at)) &&
      at.initializer !== undefined &&
      ts.isVariableDeclarationList(at.initializer)
    ) {
      for (const d of at.initializer.declarations) {
        const hit = binderOf(d.name, name);
        if (hit !== undefined) return ts.isIdentifier(d.name) ? d : hit;
      }
    }
    if (ts.isCatchClause(at) && at.variableDeclaration !== undefined) {
      const hit = binderOf(at.variableDeclaration.name, name);
      if (hit !== undefined) return at.variableDeclaration;
    }
  }
  return undefined;
}

/** The function whose own body or parameter list `node` is in: the nearest function around
 *  it, or undefined at the top of the file or of a namespace. */
export function functionAround(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) return at;
    if (ts.isSourceFile(at) || ts.isModuleBlock(at) || ts.isClassLike(at)) return undefined;
  }
  return undefined;
}

const within = (outer: ts.Node, inner: ts.Node): boolean =>
  inner.pos >= outer.pos && inner.end <= outer.end;

/** Whether `id` is a name read as a value where it stands, rather than a property name, a
 *  declaration's own name, a label, or a part of a type. */
function isValueRead(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isQualifiedName(p)) return false;
  if (
    (ts.isVariableDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isBindingElement(p) ||
      ts.isPropertyAssignment(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodSignature(p)) &&
    p.name === id
  ) {
    return false;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  return true;
}

/** What `fn` reads from the functions around it: the variables, the local functions it names
 *  (`isLocalFunction` tells a declaration of one from a variable), and `this`. */
export function closureUse(
  fn: LocalFunctionLike,
  isLocalFunction: (decl: ts.Node) => boolean,
): ClosureUse {
  const captures: CapturedName[] = [];
  const seen = new Set<ts.Node>();
  const calls = new Set<ts.Node>();
  let usesThis = false;
  const walk = (n: ts.Node, thisIsOurs: boolean): void => {
    if (ts.isTypeNode(n)) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      if (thisIsOurs) usesThis = true;
      return;
    }
    if (ts.isIdentifier(n)) {
      if (!isValueRead(n)) return;
      const decl = declarationOf(n);
      if (decl === undefined || within(fn, decl)) return;
      // Read where the file or a namespace declares it: the module's, read directly.
      if (functionAround(decl) === undefined) return;
      if (isLocalFunction(decl)) {
        calls.add(decl);
        return;
      }
      if (!seen.has(decl)) {
        seen.add(decl);
        captures.push({ decl, name: n.text });
      }
      return;
    }
    // A function inside this one: its own `this` unless it is an arrow, whose `this` is ours.
    const ours =
      ts.isFunctionLike(n) && n !== fn ? thisIsOurs && ts.isArrowFunction(n) : thisIsOurs;
    ts.forEachChild(n, (c) => walk(c, ours));
  };
  // An arrow function's `this` is the one around it; any other function's is its own.
  const own = ts.isArrowFunction(fn);
  for (const p of fn.parameters) walk(p, own);
  if (fn.body !== undefined) walk(fn.body, own);
  return { captures, calls, usesThis };
}
