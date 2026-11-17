// ═══ A new object (change 0142, Amendment A3, rule 3) ═══
//
// Rule 8.8 (docs/language-design.md); the `Implements:` tag of this file waits for the reqs/ sync
// that follows the rule text of Amendment A3.
//
// A new object is one the source shows to be new: `new`, an object or an array literal,
// `structuredClone(v)`, `xs.slice()` of values, the arrays `xs.map(f)` builds of values, and a call
// of a function of the file whose every `return` gives an object the function built and stored
// nowhere else. Anything else is not known to be new, and a store of it, or a name for it, follows
// rules 2 and 4 (`object-share.ts`). This file also reads the function that returns its parameter
// (`let b = f(a)`, rule 1).

import ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
import { bare, fileFunction, rootOf, writeTargets, writesAnObject } from './object-reference.js';
import { optionalInner } from './optional.js';
import { Reader, eachOwn, elementType, isPropertyName, membersNamed } from './source-types.js';

// ─── Rule 3: a new object ───

/** Whether `e` is an object the source shows to be new (rule 3): `new`, an object or an array
 *  literal, `structuredClone(v)`, `xs.slice()` of values, and a call of a function of the file
 *  whose `returns` give new objects. Anything else is not known to be new. */
export function isNewObject(
  e: ts.Expression,
  sourceFile: ts.SourceFile,
  /** What the lowering found `e` to be. */
  lowered?: ShaderType,
): boolean {
  return newObject(e, new Reader(sourceFile, (x) => (x === e ? lowered : undefined)));
}

/** A struct or a sized array: what an object is in the IR. An optional is a struct that holds
 *  one, `P | undefined`, and is an object only where what it holds is. */
export function isObjectType(t: ShaderType): boolean {
  const inner = optionalInner(t);
  if (inner !== undefined) return isObjectType(inner);
  return t.kind === 'struct' || (t.kind === 'array' && t.size !== undefined);
}

/** Whether `e` is new, read by `reader`. */
export function newObject(e: ts.Expression, reader: Reader): boolean {
  const x = bare(e);
  const sf = reader.sourceFile;
  if (ts.isNewExpression(x) || ts.isObjectLiteralExpression(x) || ts.isArrayLiteralExpression(x))
    return true;
  // `c ? null : new P()`: every arm is new or absent.
  if (ts.isConditionalExpression(x)) {
    const arm = (a: ts.Expression): boolean => {
      const v = bare(a);
      return (
        v.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(v) && v.text === 'undefined') ||
        newObject(v, reader)
      );
    };
    return arm(x.whenTrue) && arm(x.whenFalse);
  }
  // `Ring.unit`, a static getter of a class of the file that gives back what it built.
  if (ts.isPropertyAccessExpression(x)) return staticFactory(x, 'get', reader);
  if (!ts.isCallExpression(x)) return false;
  const callee = x.expression;
  if (ts.isIdentifier(callee)) {
    const f = fileFunction(x, sf);
    if (f !== undefined) return returnsNew(f, sf);
    // `structuredClone(v)`, `array<T, N>(…)`, `fill<T, N>(v)` and the builtins build a value. A
    // name the file or the editor declares is another function, and `select` gives an argument.
    return (
      callee.text !== 'select' &&
      reader.localFunction(x) === undefined &&
      !reader.declaresName(callee.text, callee)
    );
  }
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (
    callee.name.text === 'slice' &&
    x.arguments.length === 0 &&
    membersNamed('slice', sf).length === 0
  ) {
    const elem = elementType(reader.typeOf(callee.expression));
    return elem !== undefined && !writesAnObject(elem, sf);
  }
  // `xs.map(f)` builds an array, and its elements are what `f` gives: values, or objects.
  if (callee.name.text === 'map') {
    const t = reader.lowered?.(x);
    if (t?.kind === 'array') return !isObjectType(t.elem);
    const f = x.arguments[0] === undefined ? undefined : bare(x.arguments[0]);
    if (f !== undefined && (ts.isArrowFunction(f) || ts.isFunctionExpression(f))) {
      if (f.type !== undefined) return !writesAnObject(f.type, sf);
      return !ts.isBlock(f.body) && !reader.isObject(f.body);
    }
    const g =
      f !== undefined && ts.isIdentifier(f)
        ? sf.statements.find(
            (st): st is ts.FunctionDeclaration =>
              ts.isFunctionDeclaration(st) && st.name?.text === f.text,
          )
        : undefined;
    if (g?.type !== undefined) return !writesAnObject(g.type, sf);
  }
  // `Disc.unit()`, a static method that gives back what it built.
  if (staticFactory(callee, 'method', reader)) return true;
  // `new V().setX(3.).setY(4.)`: each method gives back `this`, which is the new object.
  const methods = membersNamed(callee.name.text, sf).filter(ts.isMethodDeclaration);
  return (
    methods.length > 0 &&
    methods.length === membersNamed(callee.name.text, sf).length &&
    methods.every((m) => m.body !== undefined && returnsThis(m.body)) &&
    newObject(callee.expression, reader)
  );
}

/** Whether `C.name` names a static member of a class of the file, every `return` of which gives a
 *  new object. */
function staticFactory(
  x: ts.PropertyAccessExpression,
  kind: 'get' | 'method',
  reader: Reader,
): boolean {
  const sf = reader.sourceFile;
  const owner = bare(x.expression);
  if (!ts.isIdentifier(owner)) return false;
  const members = membersNamed(x.name.text, sf);
  const classes = sf.statements.filter(
    (st): st is ts.ClassDeclaration => ts.isClassDeclaration(st) && st.name?.text === owner.text,
  );
  return (
    classes.length > 0 &&
    members.length > 0 &&
    members.every(
      (m) =>
        (kind === 'get' ? ts.isGetAccessorDeclaration(m) : ts.isMethodDeclaration(m)) &&
        ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Static &&
        returnsNew(m as ts.FunctionLikeDeclaration, sf),
    )
  );
}

/** Whether every `return` of the body gives `this`. */
function returnsThis(body: ts.Node): boolean {
  let returns = 0;
  let every = true;
  eachOwn(body, (n) => {
    if (!ts.isReturnStatement(n)) return;
    returns++;
    every &&= n.expression !== undefined && bare(n.expression).kind === ts.SyntaxKind.ThisKeyword;
  });
  return every && returns > 0;
}

const NEW = new WeakMap<ts.FunctionLikeDeclaration, boolean>();

/** Whether every `return` of `fn` gives an object the function built and stored nowhere else:
 *  a new object, a call of such a function, or a local declared from one that is only read, written
 *  through, and returned. A function that calls itself is not known to be new. */
function returnsNew(fn: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): boolean {
  const known = NEW.get(fn);
  if (known !== undefined) return known;
  NEW.set(fn, false);
  if (fn.body === undefined) return false;
  const reader = new Reader(sourceFile);
  let returns = 0;
  let every = true;
  eachOwn(fn.body, (n) => {
    if (!ts.isReturnStatement(n) || n.expression === undefined) return;
    returns++;
    const v = bare(n.expression);
    every &&= newObject(v, reader) || (ts.isIdentifier(v) && builtLocal(v, fn, reader));
  });
  NEW.set(fn, every && returns > 0);
  return every && returns > 0;
}

/** Whether `id` names a local of `fn` declared from a new object, which the body never stores,
 *  passes to a call or assigns whole. */
function builtLocal(id: ts.Identifier, fn: ts.FunctionLikeDeclaration, reader: Reader): boolean {
  const d = reader.declOf(id.text, id);
  if (
    d === undefined ||
    !ts.isVariableDeclaration(d) ||
    d.initializer === undefined ||
    !newObject(d.initializer, reader)
  )
    return false;
  let kept = true;
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === id.text && n.parent !== d && !isPropertyName(n)) {
      let p = n.parent;
      while (ts.isParenthesizedExpression(p)) p = p.parent;
      const through =
        ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) &&
          bare(p.expression) === n) ||
        ts.isReturnStatement(p);
      if (!through && reader.declOf(n.text, n) === d) kept = false;
    }
    ts.forEachChild(n, walk);
  };
  walk(fn.body!);
  return kept;
}

// ─── Rule 1: a function that returns its parameter ───

/** The parameter every `return` of `callee` names, where `callee` never assigns it whole. */
export function returnsItsParameter(callee: ts.FunctionDeclaration): number | undefined {
  if (callee.body === undefined) return undefined;
  const params = callee.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
  let at: number | undefined;
  let ok = true;
  eachOwn(callee.body, (n) => {
    if (!ts.isReturnStatement(n)) return;
    const v = n.expression === undefined ? undefined : bare(n.expression);
    const i = v !== undefined && ts.isIdentifier(v) ? params.indexOf(v.text) : -1;
    if (i < 0 || (at !== undefined && at !== i)) ok = false;
    else at = i;
  });
  if (!ok || at === undefined) return undefined;
  const name = params[at]!;
  eachOwn(callee.body, (n) => {
    for (const t of writeTargets(n)) {
      const root = rootOf(t);
      if (root !== undefined && root.whole && root.name.text === name) ok = false;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) ok = false;
  });
  return ok ? at : undefined;
}

/** `let b = f(a)` where `f` returns its parameter and `a` is a name: the argument `b` is a second
 *  name of, and the call. */
export function aliasedCall(
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): { readonly argument: ts.Identifier; readonly call: ts.CallExpression } | undefined {
  if (decl.initializer === undefined) return undefined;
  const call = bare(decl.initializer);
  if (!ts.isCallExpression(call)) return undefined;
  const callee = fileFunction(call, sourceFile);
  const exact = callee === undefined ? undefined : returnsItsParameter(callee);
  const a = exact === undefined ? undefined : call.arguments[exact];
  if (a === undefined) return undefined;
  const argument = bare(a);
  return ts.isIdentifier(argument) ? { argument, call } : undefined;
}
