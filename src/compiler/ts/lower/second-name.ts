// ═══ A second name is the same place (Rule 8.8, change 0142, Amendment A3, rule 1) ═══
//
// Implements: Rule 6.10, Rule 8.8, Rule 8.28 (docs/language-design.md; traced in reqs/).
//
// `const q = ps[i]`, `let q = h.c`, `const q = p` and `let b = f(a)` (where every `return` of `f`
// names one parameter) make `q` a name of an object that already has a name. In JavaScript the
// two names are one object. The lowering therefore emits no declaration for `q`: each use of `q`
// is the place, as each use of a loop's name is the element it names (`lowerForOf`).
//
// A declaration of an object that is none of these (the result of a call that may give back an
// object that has a name, a `?:` over two objects) is a copy, and a copy has JavaScript's result
// only where nothing writes an object around it (rule 4). Everything else is refused, as not
// supported yet, and never compiled to a copy JavaScript would not make (OD-9).

import ts from 'typescript';
import { logicalTypeKey as typeKey, optionalInner } from '../optional.js';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { cloneIr, type LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { bare } from '../object-reference.js';
import { aliasedCall, isNewObject, isObjectType } from '../new-object.js';
import { deferRefusal } from './pending-shares.js';
import { objectWrittenAround, usesOfDeclared, wholeWrite } from '../object-share.js';

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

/** An index in a place that is no literal is read once, into a name of the compiler's own: the
 *  place is then the one the declaration (or the loop) named, whatever the index becomes after.
 *  `undefined` where the statement cannot hold a name for it. */
export function holdIndexesOnce(e: Expr, scope: LoweringScope): Expr | undefined {
  if (e.op === 'member') {
    const base = holdIndexesOnce(e.base, scope);
    return base === undefined ? undefined : { ...e, base };
  }
  if (e.op === 'index') {
    const base = holdIndexesOnce(e.base, scope);
    if (base === undefined) return undefined;
    if (e.idx.op === 'lit') return { ...e, base };
    if (!scope.canHoist()) return undefined;
    return { ...e, base, idx: scope.hoistTemp('_at', e.idx) };
  }
  return e;
}

/** Whether `e` is a name or a chain of fields and elements of one: a place. */
function isPlaceChain(e: Expr): boolean {
  for (let at = e; ; at = at.base) {
    if (at.op === 'varref' || at.op === 'param' || at.op === 'externref') return true;
    if (at.op !== 'member' && at.op !== 'index') return false;
  }
}

/**
 * A name that takes a copy of an object that may already have a name (rule 4): the result of a
 * call, a `?:` over two objects, a name a pattern reads out of an object. A copy has JavaScript's
 * result only where it is a `const` and the function writes no object around it. Returns whether
 * the copy is allowed, having said why when it is not.
 */
export function copyOfObject(
  decl: ts.VariableDeclaration,
  name: ts.Node,
  isConst: boolean,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  /** The lowered type of the object: where no body writes it, the copy stands (rule 6). */
  type: ShaderType,
): boolean {
  if (isConst && !objectWrittenAround(decl, sourceFile)) return true;
  const call = (decl.initializer ?? decl).getText(sourceFile).replace(/\s+/g, ' ');
  deferRefusal(diagnostics, {
    sourceFile,
    node: name,
    type,
    name: name.getText(sourceFile),
    code: TS_CODES.UNSUPPORTED,
    message:
      `"${name.getText(sourceFile)}" would name an object that "${call}" gives back, which may ` +
      `already have a name, and the function writes an object after that. One object under two ` +
      `names is not supported yet (change 0142, stage 2). Read what you need from the call ` +
      `first, or write through the name that holds the object.`,
  });
  // The declaration is a copy; the refusal, if rule 6 keeps it, is the diagnostic.
  return true;
}

let copying = false;

/** Run `f` with every declaration of an object a copy: the one statement of a debugger's watch
 *  reads a value at one moment, where a second name and a copy are the same. */
export function withCopiedObjects<R>(f: () => R): R {
  const was = copying;
  copying = true;
  try {
    return f();
  } finally {
    copying = was;
  }
}

/**
 * `const q = <place>` or `let q = <place>` where the place holds an object: `q` is a name of that
 * place (`'bound'`). A declaration of any other object that is not new is a copy where rule 4
 * allows one (`'none'`), and is refused otherwise (`'refused'`). A new object, and a value, are
 * `'none'` too: the declaration is the ordinary one.
 *
 * A second name that is assigned whole later (`q = r`) names an object the compiler must follow
 * at each write, which is stage 2. So is one that a function inside the body uses.
 */
export function secondNameOf(
  decl: ts.VariableDeclaration,
  init: Expr,
  annotated: ShaderType | undefined,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): 'bound' | 'refused' | 'none' {
  const type = annotated ?? init.type;
  if (!isObjectType(type) && !isObjectType(init.type)) return 'none';
  if (copying || !ts.isIdentifier(decl.name) || decl.initializer === undefined) return 'none';
  if (isNewObject(decl.initializer, sourceFile, init.type)) return 'none';
  const name = decl.name.text;
  const list = decl.parent as ts.VariableDeclarationList;
  const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
  const direct = bare(decl.initializer);
  const from = ts.isIdentifier(direct) ? direct : aliasedCall(decl, sourceFile)?.argument;
  const target = from === undefined ? undefined : scope.resolve(from.text);
  const refuse = (node: ts.Node, message: string): 'refused' => {
    pushDiag(diagnostics, sourceFile, node, message, TS_CODES.UNSUPPORTED);
    return 'refused';
  };
  // A name of the same type that the lowering can name again: a local, a parameter or a binding
  // by its own name, or any place of one (an element, a field, the element a loop names).
  const sameType = typeKey(init.type) === typeKey(type) && optionalInner(init.type) === undefined;
  const plain =
    target !== undefined &&
    from !== undefined &&
    scope.chainAlias(from) === undefined &&
    (target.kind === 'local' || target.kind === 'param' || target.kind === 'binding') &&
    typeKey(target.type) === typeKey(type);
  if (!sameType || !(plain || isPlaceChain(init))) {
    // A base class's view of the object has its own refusal (change 0110).
    if (
      optionalInner(type) === undefined &&
      optionalInner(init.type) === undefined &&
      type.kind === 'struct' &&
      init.type.kind === 'struct' &&
      typeKey(type) !== typeKey(init.type)
    )
      return 'none';
    copyOfObject(decl, decl.name, isConst, sourceFile, diagnostics, init.type);
    return 'none';
  }
  let region: ts.Node = list.parent;
  if (ts.isVariableStatement(region)) region = region.parent;
  const uses = usesOfDeclared(decl, region, sourceFile);
  if (uses.some((u) => functionBetween(u, region))) {
    return refuse(
      decl.name,
      `"${name}" is a second name of an object that already has a name, and a function inside ` +
        `this one uses "${name}". A second name that a local function captures is not ` +
        `supported yet (change 0142, stage 2). Use the first name in that function.`,
    );
  }
  // A compound assignment or an increment of an object is a type error of its own, which the
  // declaration as a copy leaves to the statement that writes it.
  if (uses.some((u) => wholeWrite(u) === 'compound')) return 'none';
  const assigned = uses.some((u) => wholeWrite(u) === 'assign');
  // A name that is assigned again later cannot be the place. It is a copy, which stands where no
  // body writes the object's type (rule 6), and is refused otherwise.
  if (assigned) {
    deferRefusal(diagnostics, {
      sourceFile,
      node: decl.name,
      type,
      code: TS_CODES.UNSUPPORTED,
      message:
        `"${name}" is a second name of an object that already has a name, and "${name}" is ` +
        `assigned again later. Following which object each name then refers to is not ` +
        `supported yet (change 0142, stage 2). Give "${name}" its own variable for the second ` +
        `object.`,
    });
    return 'none';
  }
  const mutable = !isConst;
  try {
    if (plain) scope.defineAlias(name, target!);
    else scope.define({ kind: 'local', name, type, mutable });
  } catch (e) {
    pushDiag(
      diagnostics,
      sourceFile,
      decl.name,
      e instanceof Error ? e.message : String(e),
      TS_CODES.DUPLICATE_SYMBOL,
    );
    return 'refused';
  }
  scope.recordDeclaration(sourceFile, decl.name, {
    name,
    kind: 'local',
    type,
    mutable: plain ? target!.mutable : mutable,
  });
  if (plain) return 'bound';
  // Each use of the name is the place, read once where the name is declared.
  const fixed = holdIndexesOnce(init, scope);
  if (fixed === undefined) {
    return refuse(
      decl.name,
      `"${name}" names "${decl.initializer.getText(sourceFile)}", and an index in it is read ` +
        `once, where "${name}" is declared. This statement cannot hold the index. Declare the ` +
        `index first, const k = …, and name ps[k].`,
    );
  }
  for (const use of uses) scope.setChainAlias(use, (): Expr => cloneIr(fixed));
  return 'bound';
}

/** Whether a function lies between `n` and `region`. */
function functionBetween(n: ts.Node, region: ts.Node): boolean {
  for (let at = n.parent; at !== undefined && at !== region; at = at.parent)
    if (ts.isFunctionLike(at)) return true;
  return false;
}
