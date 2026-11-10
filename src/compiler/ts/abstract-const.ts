// A constant of no fixed type (Rules 5.1 and 5.2, change 0134 item 2).
//
// `const K = 3` with no annotation, at module scope, in a function or as a static field no code
// writes, is WGSL's abstract constant: each READ of `K` takes the type the written number `3`
// would take in the same place. So `vi * K` is `vi * 3u` and `x * K` is `x * K` (an `f32`) in
// one function, a cast converts the written number (`u32(K)` is `3u`, at the exact value past
// 2^24), and a read beside an `f64` carries the full double. A float-written constant
// (`const C = 0.1`) is one among `f32` and `f64`.
//
// The declaration keeps its emitted form, `const K: f32 = 3.0;`, and a read that takes `f32`
// keeps the name (Amendment A1 of change 0134). Only a read of another type writes the value,
// so the WGSL and the GLSL text never carry an untyped constant whose arithmetic WGSL would do
// its own way: an expression of such constants and written numbers has its ECMAScript value
// (decision Q1).
//
// HOW A READ IS KNOWN. The lowering of a name gives a `constref` or a `varref`, typed `f32`,
// as before. This module remembers that expression object and the node it came from. The
// literal retargets of `lit-coerce.ts` and `numeric.ts` ask it whether an expression is such a
// read, or arithmetic over such reads and written numbers, and get the `f32` literal a written
// number would have lowered to there. They then decide as they decide for a written number.
//
// THE DIVISION RULE (decisions Q10 and Q11, Amendment A1). A `/` whose operands are all
// constants of no fixed type and written numbers has no operand with a declared type. Where
// some read makes one of those constants an integer, the `/` is refused: the author would
// read `k / 2` as an integer division at one place and as 3.5 at another. `x / N` with a
// declared `x` is not such a division. The module's lowering records both facts here, and
// `reportAbstractDivisions` reports after every read is known.
//
// Implements: Rule 5.1, Rule 5.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import { f32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';

/** One constant of no fixed type, shared by its declaration's binding and every read. */
export interface AbstractConst {
  /** The name as the author wrote it (`K`, or `S.K` for a static field). */
  readonly name: string;
  /** The ECMAScript value of the initializer (decision Q1). */
  readonly value: number;
  /** Whether every written number of the initializer is integer-written (Rule 5.1). */
  readonly integerWritten: boolean;
  /** `const` for the remedy line; a static field is written `static`. */
  readonly keyword: 'const' | 'static';
  /** The initializer as the author wrote it, for the remedy line. */
  readonly written: string;
  /** The integer type of each read an integer position typed, `i32` or `u32`. */
  readonly integerReads: ('i32' | 'u32')[];
  /** Each `/` over this constant whose operands all have no declared type. */
  readonly divisions: ts.BinaryExpression[];
}

const readByExpr = new WeakMap<Expr, AbstractConst>();
const readByNode = new WeakMap<ts.Node, AbstractConst>();
/** A module constant's record, for the scope of each function, which is built from the IR
 *  declarations and not from the collector's scope. */
const byDeclName = new WeakMap<ts.SourceFile, Map<string, AbstractConst>>();
const divisionsOf = new WeakMap<ts.SourceFile, Set<AbstractConst>>();

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

const ARITH: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
]);

function integerWrittenLiteral(node: ts.NumericLiteral): boolean {
  const written = node.getText();
  return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
}

/** What an initializer or an operand is when it is written numbers, reads of constants of no
 *  fixed type, and `+ - * /` and a unary minus over those: its ECMAScript value, whether all of
 *  it is integer-written, and the constants it reads. `undefined` for anything else. A read is
 *  known only after its name was lowered, so call this after lowering `node`. */
export function abstractTreeOf(
  node: ts.Expression,
):
  | { readonly value: number; readonly integerWritten: boolean; readonly reads: AbstractConst[] }
  | undefined {
  const inner = stripParens(node);
  if (ts.isNumericLiteral(inner)) {
    return {
      value: Number(inner.text),
      integerWritten: integerWrittenLiteral(inner),
      reads: [],
    };
  }
  const read = readByNode.get(inner);
  if (read !== undefined) {
    return { value: read.value, integerWritten: read.integerWritten, reads: [read] };
  }
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.MinusToken) {
    const a = abstractTreeOf(inner.operand);
    return a === undefined ? undefined : { ...a, value: -a.value };
  }
  if (ts.isBinaryExpression(inner) && ARITH.has(inner.operatorToken.kind)) {
    const a = abstractTreeOf(inner.left);
    const b = abstractTreeOf(inner.right);
    if (a === undefined || b === undefined) return undefined;
    const k = inner.operatorToken.kind;
    if (k === ts.SyntaxKind.SlashToken && b.value === 0) return undefined;
    const value =
      k === ts.SyntaxKind.PlusToken
        ? a.value + b.value
        : k === ts.SyntaxKind.MinusToken
          ? a.value - b.value
          : k === ts.SyntaxKind.AsteriskToken
            ? a.value * b.value
            : a.value / b.value;
    return {
      value,
      integerWritten: a.integerWritten && b.integerWritten,
      reads: [...a.reads, ...b.reads],
    };
  }
  return undefined;
}

/** The record of a new constant of no fixed type, when `initializer` is one's (see
 *  {@link abstractTreeOf}); `undefined` when it is not. */
export function abstractConstFor(
  name: string,
  initializer: ts.Expression,
  keyword: 'const' | 'static' = 'const',
): AbstractConst | undefined {
  const tree = abstractTreeOf(initializer);
  if (tree === undefined || !Number.isFinite(tree.value)) return undefined;
  return {
    name,
    value: tree.value,
    integerWritten: tree.integerWritten,
    keyword,
    written: initializer.getText().replace(/\s+/g, ' '),
    integerReads: [],
    divisions: [],
  };
}

const projectedAnnotations = new WeakMap<ts.SourceFile, ReadonlySet<number>>();

/** Tells the front end which annotations of `sourceFile` the language service wrote into the
 *  text TypeScript reads (`language-service/projection.ts`), by the offset each starts at. The
 *  service writes `: f32` after an unannotated scalar field, so that TypeScript types it. That
 *  annotation is not the author's: a static field of written numbers is still a constant of no
 *  fixed type, in the editor as in `compile()` (Rule 12.7). */
export function markProjectedAnnotations(
  sourceFile: ts.SourceFile,
  starts: readonly number[],
): void {
  projectedAnnotations.set(sourceFile, new Set(starts));
}

/** Whether the declaration named by `name` has no annotation the author wrote. */
export function hasNoWrittenType(
  decl: { readonly type?: ts.TypeNode; readonly name: ts.Node },
  sourceFile: ts.SourceFile,
): boolean {
  return (
    decl.type === undefined ||
    projectedAnnotations.get(sourceFile)?.has(decl.name.getEnd()) === true
  );
}

/** Keeps a module constant's record under its IR name, for the function scopes. */
export function recordModuleAbstractConst(
  sourceFile: ts.SourceFile,
  irName: string,
  info: AbstractConst,
): void {
  let table = byDeclName.get(sourceFile);
  if (table === undefined) byDeclName.set(sourceFile, (table = new Map()));
  table.set(irName, info);
}

/** Forgets the module constants of an earlier lowering of `sourceFile`. */
export function resetAbstractConsts(sourceFile: ts.SourceFile): void {
  byDeclName.delete(sourceFile);
  divisionsOf.delete(sourceFile);
}

export function moduleAbstractConst(
  sourceFile: ts.SourceFile | undefined,
  irName: string,
): AbstractConst | undefined {
  return sourceFile === undefined ? undefined : byDeclName.get(sourceFile)?.get(irName);
}

/** Remembers that `expr`, lowered from `node`, reads `info`. Returns `expr`. */
export function markAbstractRead<E extends Expr>(
  expr: E,
  node: ts.Node,
  info: AbstractConst | undefined,
): E {
  if (info !== undefined) {
    readByExpr.set(expr, info);
    readByNode.set(node, info);
  }
  return expr;
}

/** Whether `node` reads a constant of no fixed type whose written numbers are all
 *  integer-written: the read stands where an integer-written literal could. */
export function isIntegerWrittenRead(node: ts.Expression): boolean {
  return readByNode.get(stripParens(node))?.integerWritten === true;
}

/** Whether `node` reads a constant of no fixed type. */
export function isAbstractRead(node: ts.Expression): boolean {
  return readByNode.has(stripParens(node));
}

/** `expr` with each read of a constant of no fixed type replaced by the `f32` literal a
 *  written number lowers to, through `+ - * /` and a unary minus; `undefined` when `expr`
 *  holds no such read, or holds anything but those and literals. */
export function abstractLiteralOf(expr: Expr): Expr | undefined {
  let found = false;
  const walk = (e: Expr): Expr | undefined => {
    const read = readByExpr.get(e);
    if (read !== undefined) {
      found = true;
      return { op: 'lit', type: f32T, value: read.value };
    }
    if (e.op === 'lit') return typeof e.value === 'number' ? e : undefined;
    if (e.op === 'unop') {
      const a = walk(e.a);
      return a === undefined ? undefined : { ...e, a };
    }
    if (e.op === 'binop' && (e.bop === '+' || e.bop === '-' || e.bop === '*' || e.bop === '/')) {
      const a = walk(e.a);
      const b = walk(e.b);
      return a === undefined || b === undefined ? undefined : { ...e, a, b };
    }
    return undefined;
  };
  const out = walk(expr);
  return found ? out : undefined;
}

/** The constants `expr` reads, as {@link abstractLiteralOf} walks it. */
function readsOf(expr: Expr, into: AbstractConst[] = []): AbstractConst[] {
  const read = readByExpr.get(expr);
  if (read !== undefined) into.push(read);
  else if (expr.op === 'unop') readsOf(expr.a, into);
  else if (expr.op === 'binop') {
    readsOf(expr.a, into);
    readsOf(expr.b, into);
  }
  return into;
}

/** Records that the read `expr` was typed `type`, an integer. */
export function noteIntegerRead(expr: Expr, type: 'i32' | 'u32'): void {
  for (const info of readsOf(expr)) info.integerReads.push(type);
}

/** Records a `/` whose operands are all written numbers and constants of no fixed type. Call
 *  it after both operands were lowered. */
export function noteAbstractDivision(node: ts.BinaryExpression, sourceFile: ts.SourceFile): void {
  if (node.operatorToken.kind !== ts.SyntaxKind.SlashToken) return;
  const tree = abstractTreeOf(node);
  if (tree === undefined || tree.reads.length === 0) return;
  let set = divisionsOf.get(sourceFile);
  if (set === undefined) divisionsOf.set(sourceFile, (set = new Set()));
  for (const info of tree.reads) {
    if (!info.divisions.includes(node)) info.divisions.push(node);
    set.add(info);
  }
}

/** The sentence of a refused `/` (decisions Q6, Q10 and Q11): what is wrong, and the two
 *  edits that say which division the author means. */
export function abstractDivisionMessage(
  info: AbstractConst,
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
): string {
  const left = node.left.getText(sourceFile);
  const right = node.right.getText(sourceFile);
  const cast = (text: string, operand: ts.Expression): string =>
    abstractTreeOf(operand)?.reads.includes(info) === true && isAbstractRead(operand)
      ? `f32(${text})`
      : text;
  const short = info.name.includes('.')
    ? info.name.slice(info.name.lastIndexOf('.') + 1)
    : info.name;
  const quotient = abstractTreeOf(node)?.value;
  return (
    `"${info.name}" is ${info.integerReads[0] === 'u32' ? 'a u32' : 'an i32'} where another ` +
    `line reads it, and no operand of "${left} / ${right}" has a declared type, so the "/" ` +
    `does not say which division it is. Write "${info.keyword} ${short}: ` +
    `${info.integerReads[0] ?? 'i32'} = ${info.written}" for the integer division, or ` +
    `"${cast(left, node.left)} / ${cast(right, node.right)}" for ` +
    `${quotient === undefined ? 'the float one' : String(quotient)}.`
  );
}

/** Reports each `/` recorded by {@link noteAbstractDivision} over a constant that some read
 *  made an integer, once for the `/`. Call it after the whole module was lowered. */
export function reportAbstractDivisions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const said = new Set<ts.BinaryExpression>();
  for (const info of divisionsOf.get(sourceFile) ?? []) {
    if (info.integerReads.length === 0) continue;
    for (const node of info.divisions) {
      if (said.has(node)) continue;
      said.add(node);
      // A mismatch the same `/` already raised (its quotient beside an integer) is this
      // mistake said a second time (Rule 12.4): the refusal of the `/` replaces it.
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      for (let i = diagnostics.length - 1; i >= 0; i--) {
        const d = diagnostics[i]!;
        if (
          d.code === TS_CODES.TYPE_MISMATCH &&
          d.category === 'error' &&
          d.start <= start &&
          d.start + d.length >= end
        )
          diagnostics.splice(i, 1);
      }
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          node,
          abstractDivisionMessage(info, node, sourceFile),
          TS_CODES.TYPE_MISMATCH,
        ),
      );
    }
  }
}
