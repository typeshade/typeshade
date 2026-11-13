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
// THE DIVISION RULE (decisions Q10 and Q11, Amendment A1, the owner's decisions of 2026-11-10).
// A `/` whose operands have no declared type reaches a constant of no fixed type directly, or
// through arithmetic, a bitwise operator, a builtin, a conditional or a constant derived from
// it. Where ANOTHER read makes that constant an integer (an argument, a typed declaration, a
// bound, an index, a conversion to `i32` or `u32`, in this file or in one that imports it),
// the `/` is refused: the author would read `k / 2` as an integer division at one place and as
// 3.5 at another. The quotient's own read is not another read (`let j: u32 = K / 2` is `4u`,
// as the written `8 / 2` is), and `x / N` with a declared `x` is no such division. The
// module's lowering records both facts here, and `reportAbstractDivisions` reports after
// every read is known, with the one edit that compiles where the quotient stands.
//
// Implements: Rule 5.1, Rule 5.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f32T, f64T, i32T, u32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic, noteUse } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { programFileOf, sameFile, writtenRange, writtenText } from './context.js';
import type { AbstractConstDecl, AbstractConstRead } from './symbols.js';
import { loweredTypeOf } from './symbols.js';

/** One read of a constant that an integer position typed. */
interface IntegerRead {
  readonly type: 'i32' | 'u32';
  /** The expression that was read as the integer: the name, or arithmetic that holds it. */
  readonly node: ts.Node;
}

/** One constant of no fixed type, shared by its declaration's binding and every read. */
export interface AbstractConst {
  /** The name as the author wrote it (`K`, or `S.K` for a static field). */
  readonly name: string;
  /** The ECMAScript value of the initializer (decision Q1). */
  readonly value: number;
  /** Whether every written number of the initializer is integer-written (Rule 5.1). */
  readonly integerWritten: boolean;
  /** `const` for the remedy line; a static field is written `static`. A value its uses decide
   *  (change 0134 item 1) is a `let`, a static field, a field (no keyword, `''`), or the result
   *  of a function its callers decide (`function`), whose declaration no edit names. */
  readonly keyword: 'const' | 'static' | 'let' | '' | 'function';
  /** The constant's name in its declaration, to name the declaration in a remedy, which is
   *  given only in the file that declares it (`sameFile`). */
  readonly nameNode: ts.Node;
  /** The initializer as the author wrote it, for the remedy line. */
  readonly written: string;
  /** The constants of no fixed type the initializer reads (`const M = K * 2` reads `K`). A
   *  read of `M` as an integer reads `K` as one, and a `/` over `M` reaches `K`. */
  readonly sources: readonly AbstractConst[];
  /** Each read of this constant, or of one derived from it, that an integer position typed. */
  readonly integerReads: IntegerRead[];
  /** Set for the counter of a `for` that is not counted and whose uses give it no type: it
   *  reads as an `f32`, and was an `i32` on `main` (the owner's decision of 2026-11-11, "A2
   *  우선: 거부"). */
  readonly openCounter?: true;
}

/** A `/` whose operands have no declared type, and the constants it reaches. */
interface Division {
  /** The `/`, or the `/=` of a variable that carries a constant. */
  readonly node: ts.BinaryExpression;
  readonly reads: readonly AbstractConst[];
  /** The integer type a position asked of the quotient (`xs[k / 2]`, `r + k / 2`), if one did. */
  asked?: 'i32' | 'u32';
  /** Whether that position takes either integer type: an index. */
  anyInteger?: boolean;
}

const readByExpr = new WeakMap<Expr, AbstractConst>();
/** The marks one compile of a source file puts on its nodes. A source file can be compiled
 *  again (the language service's projected annotations, a second analysis), and a mark of the
 *  first compile must not decide the second, so each compile starts its own table. */
interface NodeMarks {
  readonly read: Map<ts.Node, AbstractConst>;
  readonly carried: Map<ts.Node, Carried>;
  /** Each lowering of a read, with the type the read took there (`readTypeAt`). */
  readonly lowerings: Map<ts.Node, ReadLowering[]>;
  /** Each constant of no fixed type this compile declared, by its declared name. */
  readonly decls: Map<ts.Node, AbstractConst>;
}
/** One lowering of a read of a constant of no fixed type: the type it took, or `null` for a read
 *  inside the initializer of another such constant, which takes no type of its own there. */
interface ReadLowering {
  type: ShaderType | null;
}
const nodeMarks = new WeakMap<ts.SourceFile, NodeMarks>();
function marksOf(node: ts.Node): NodeMarks {
  const sf = node.getSourceFile();
  let marks = nodeMarks.get(sf);
  if (marks === undefined)
    nodeMarks.set(
      sf,
      (marks = { read: new Map(), carried: new Map(), lowerings: new Map(), decls: new Map() }),
    );
  return marks;
}
const readByNode = {
  get: (node: ts.Node): AbstractConst | undefined => marksOf(node).read.get(node),
  has: (node: ts.Node): boolean => marksOf(node).read.has(node),
  set: (node: ts.Node, info: AbstractConst): void => void marksOf(node).read.set(node, info),
};
/** A module constant's record, for the scope of each function, which is built from the IR
 *  declarations and not from the collector's scope. */
const byDeclName = new WeakMap<ts.SourceFile, Map<string, AbstractConst>>();
const divisionsOf = new WeakMap<ts.SourceFile, Map<ts.Node, Division>>();
const divisionByNode = new WeakMap<ts.Node, Division>();

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

const ARITH: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

const BITWISE: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
]);

function integerWrittenLiteral(node: ts.NumericLiteral): boolean {
  const written = node.getText();
  return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
}

/** What an initializer or an operand is when it is written numbers, reads of constants of no
 *  fixed type, and `+ - * / %` and a unary minus over those: its ECMAScript value, whether all
 *  of it is integer-written, and the constants it reads. `undefined` for anything else. A read
 *  is known only after its name was lowered, so call this after lowering `node`. */
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
    // A divisor of zero is refused where the `/` is lowered (`divisorIsZero`), before this reads it.
    const k = inner.operatorToken.kind;
    const value =
      k === ts.SyntaxKind.PlusToken
        ? a.value + b.value
        : k === ts.SyntaxKind.MinusToken
          ? a.value - b.value
          : k === ts.SyntaxKind.AsteriskToken
            ? a.value * b.value
            : k === ts.SyntaxKind.SlashToken
              ? a.value / b.value
              : a.value % b.value;
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
  nameNode: ts.Node,
  initializer: ts.Expression,
  keyword: 'const' | 'static' = 'const',
): AbstractConst | undefined {
  // A value outside the range of f32 is refused where its literals are lowered, so the value is
  // finite here.
  const tree = abstractTreeOf(initializer);
  if (tree === undefined) return undefined;
  const info: AbstractConst = {
    name,
    value: tree.value,
    integerWritten: tree.integerWritten,
    keyword,
    nameNode,
    written: writtenText(initializer).replace(/\s+/g, ' '),
    sources: tree.reads,
    integerReads: [],
  };
  // The editor's hover names the declaration in the language's words, and a read inside the
  // initializer takes no type of its own: it is part of this constant's value (change 0134
  // item 4, decision Q3).
  marksOf(nameNode).decls.set(nameNode, info);
  for (const leaf of readLeaves(initializer)) settleRead(leaf, null);
  return info;
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
  lengths?: readonly number[],
): void {
  projectedAnnotations.set(sourceFile, new Set(starts));
  if (lengths === undefined) projectedSpans.delete(sourceFile);
  else
    projectedSpans.set(
      sourceFile,
      starts.map((at, i) => ({ at, length: lengths[i] ?? 0 })),
    );
}
/** Each insertion of the projection, `[at, at + length)` in the projected text: what a named
 *  edit is checked without, so the check compiles the author's text as `compile()` does. */
const projectedSpans = new WeakMap<
  ts.SourceFile,
  readonly { readonly at: number; readonly length: number }[]
>();

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

/** Whether the function `fn` has no result type the author wrote: none at all, or the one the
 *  language service wrote into the text it analyses (`: f32` after the parameter list). */
export function hasNoWrittenResult(
  fn: ts.SignatureDeclaration,
  sourceFile: ts.SourceFile,
): boolean {
  if (fn.type === undefined) return true;
  const starts = projectedAnnotations.get(sourceFile);
  if (starts === undefined) return false;
  // The inserted text is `: T`; its colon stands where the insertion starts.
  const colon = sourceFile.text.lastIndexOf(':', fn.type.getStart(sourceFile));
  return starts.has(colon);
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
  writtenDivisionsOf.delete(sourceFile);
  readingsRefusalsOf.delete(sourceFile);
  quotientReadsOf.delete(sourceFile);
  checkedRefusalsOf.delete(sourceFile);
  nodeMarks.delete(sourceFile);
  carriedByFunction.delete(sourceFile);
}

export function moduleAbstractConst(
  sourceFile: ts.SourceFile | undefined,
  irName: string,
): AbstractConst | undefined {
  return sourceFile === undefined ? undefined : byDeclName.get(sourceFile)?.get(irName);
}

/** The type each read of a constant takes while a loop counter's start is lowered again at the
 *  type it has on `main` (`withReadTypes`). Empty otherwise. */
const readTypes = new Map<AbstractConst, ShaderType>();

/** The type a read of `info` takes while `withReadTypes` runs, if it names one. */
export function readTypeFor(info: AbstractConst | undefined): ShaderType | undefined {
  return info === undefined ? undefined : readTypes.get(info);
}

/** Runs `lower` with each read of a constant in `types` taking that type, as a function-local
 *  constant's read did on `main` (changes 0036 and 0037). A loop counter whose start carries
 *  such a constant keeps the type it has on `main` (Amendment A3 of change 0134, and the
 *  owner's decision of 2026-11-10, "`main`과 같이 u32 유지"). */
export function withReadTypes<T>(types: ReadonlyMap<AbstractConst, ShaderType>, lower: () => T): T {
  for (const [info, type] of types) readTypes.set(info, type);
  try {
    return lower();
  } finally {
    readTypes.clear();
  }
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
    lowerRead(node, expr.type);
  }
  return expr;
}

// ─── the type each read took, for the editor's hover (change 0134 item 4) ────────────────────
//
// A read lowers as the constant's emitted `f32` declaration, and a retarget then gives it the
// type the written number takes in its place: an integer (`noteIntegerRead`), or an `f64`
// (`noteF64Read`). Each lowering of a read is kept with its type, and the hover shows a read's
// type where every lowering of it agrees: a generic function's body, lowered once per instance,
// or a counter's start lowered again (`withReadTypes`), can give one read two types, and the
// hover then names the declaration in the language's words.

/** Set while a lowering only looks ahead (`peekingReads`). */
let peeking = 0;

/** Runs `lower`, a lowering that only looks ahead at a type and whose result the program does
 *  not keep (a loop's bound read before its counter is typed, a receiver read before its
 *  member), with no lowering of a read recorded for the hover: the lowering the program keeps
 *  records it. */
export function peekingReads<T>(lower: () => T): T {
  peeking++;
  try {
    return lower();
  } finally {
    peeking--;
  }
}

/** Runs `lower`, a lowering the program keeps even where a lookahead reached it (a function's
 *  body, a generic instance cached at its first call), with its reads recorded. */
export function unpeekedReads<T>(lower: () => T): T {
  const outer = peeking;
  peeking = 0;
  try {
    return lower();
  } finally {
    peeking = outer;
  }
}

/** Records that the reads in `node` were folded to a value of `type` where they stand (a loop's
 *  step folded to its counter's type, a `switch` label to its selector's), as the written number
 *  would be. Only the hover reads it: the fold is no integer read for the division rule. A
 *  float-written constant folded to an integer is read as the written number (`j += C` with
 *  `const C = 2.0`), which no one type names, as in `noteCastRead`. */
export function noteFoldedRead(node: ts.Expression, type: ShaderType): void {
  const tree = abstractTreeOf(node);
  if (tree === undefined) return;
  const integer = type.kind === 'scalar' && (type.scalar === 'i32' || type.scalar === 'u32');
  const read = integer && !tree.integerWritten ? null : type;
  for (const leaf of readLeaves(node)) settleRead(leaf, read);
}

/** Starts one lowering of the read `node`, at the type `type` it lowered to. */
function lowerRead(node: ts.Node, type: ShaderType): void {
  if (peeking > 0) return;
  const { lowerings } = marksOf(node);
  const seen = lowerings.get(node);
  if (seen === undefined) lowerings.set(node, [{ type }]);
  else seen.push({ type });
}

/** Gives the latest lowering of the read `node` the type `type`. */
function settleRead(node: ts.Node, type: ShaderType | null): void {
  if (peeking > 0) return;
  const latest = marksOf(node).lowerings.get(node)?.at(-1);
  if (latest !== undefined) latest.type = type;
}

/** Records that a loop counter's start read `info` at `type`, as on `main` (`withReadTypes`):
 *  one lowering of the read `node` that took `type`. */
export function noteForcedRead(
  node: ts.Node,
  info: AbstractConst | undefined,
  type: ShaderType,
): void {
  if (info !== undefined) lowerRead(node, type);
}

/** The reads of constants of no fixed type that `node` holds as written numbers: the node itself,
 *  or the operands of `+ - * / %` and a unary minus over such reads (`abstractTreeOf`). */
function readLeaves(node: ts.Expression): ts.Node[] {
  const inner = stripParens(node);
  if (readByNode.has(inner)) return [inner];
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.MinusToken)
    return readLeaves(inner.operand);
  if (ts.isBinaryExpression(inner) && ARITH.has(inner.operatorToken.kind))
    return [...readLeaves(inner.left), ...readLeaves(inner.right)];
  return [];
}

/** Records that `node`, a read or arithmetic over reads, was lifted to an `f64` literal
 *  carrying the full double (Rule 5.2): each read in it took `f64` there. */
export function noteF64Read(node: ts.Expression, type: ShaderType): void {
  for (const leaf of readLeaves(node)) settleRead(leaf, type);
}

/** Records the type the reads in `node`, the argument of the conversion `name` of a constant of
 *  no fixed type, took: `f64(K)` reads the double, and `i32(K)` and `u32(K)` read an
 *  integer-written constant as that integer. A float-written constant converted to an integer
 *  is read as the written number (`u32(C)` with `const C = 7.5` converts 7.5), which no one
 *  type names. */
export function noteCastRead(node: ts.Expression, name: string): void {
  const tree = abstractTreeOf(node);
  if (tree === undefined) return;
  const type =
    name === 'f64'
      ? f64T
      : (name === 'i32' || name === 'u32') && tree.integerWritten
        ? name === 'u32'
          ? u32T
          : i32T
        : null;
  for (const leaf of readLeaves(node)) settleRead(leaf, type);
}

/** What one compile of `sourceFile` knows of its constants of no fixed type, in its offsets:
 *  each declaration and each read. Call it after the lowering, before the next one resets the
 *  marks (`resetAbstractConsts`). */
export function abstractConstFacts(sourceFile: ts.SourceFile): {
  readonly decls: AbstractConstDecl[];
  readonly reads: AbstractConstRead[];
} {
  const marks = nodeMarks.get(sourceFile);
  if (marks === undefined) return { decls: [], reads: [] };
  const decls: AbstractConstDecl[] = [];
  for (const [node, info] of marks.decls) {
    if (info.keyword !== 'const' && info.keyword !== 'static') continue;
    const start = node.getStart(sourceFile);
    decls.push({
      fileName: sourceFile.fileName,
      start,
      length: node.getEnd() - start,
      keyword: info.keyword,
      written: info.written,
      integerWritten: info.integerWritten,
    });
  }
  const reads: AbstractConstRead[] = [];
  for (const [node, lowerings] of marks.lowerings) {
    const first = lowerings[0]?.type ?? null;
    const one =
      first !== null &&
      lowerings.every((l) => l.type !== null && JSON.stringify(l.type) === JSON.stringify(first));
    const start = node.getStart(sourceFile);
    reads.push({ start, length: node.getEnd() - start, type: one ? first : null });
  }
  return { decls, reads };
}

/** Where a value comes from, when it comes from constants of no fixed type with no declared
 *  type between (Amendment A3 of change 0134, "보수적 추적 규칙"): the constants it reaches, and
 *  whether a float-written literal or a float-written constant takes part, which makes a `/`
 *  over it a float division (A3, "실수 나눗셈으로 허용"). */
export interface Origin {
  readonly reaches: readonly AbstractConst[];
  readonly float: boolean;
}

/** A binding, a function result or a loop counter that carries an origin. */
export interface Carried extends Origin {
  /** For a variable: `let` or `const`, its name, its initializer as written and whether the
   *  initializer's type is an integer, for the remedy of a `/=` (`let y: f32 = f32(k << 1)`). */
  readonly variable?: {
    readonly keyword: 'let' | 'const' | 'static' | '';
    readonly name: string;
    readonly init: string;
    /** The variable's scalar type: `i32`, `u32` or `f32`. */
    readonly type: string;
  };
}

const carriedByNode = {
  get: (node: ts.Node): Carried | undefined => marksOf(node).carried.get(node),
  has: (node: ts.Node): boolean => marksOf(node).carried.has(node),
  set: (node: ts.Node, carried: Carried): void => void marksOf(node).carried.set(node, carried),
};
/** The origin each function of the module returns, by its IR name, when it writes no result
 *  type: a call of it carries that origin (A3: "the result of a function, a method, a getter or
 *  a closure that returns such a value"). */
const carriedByFunction = new WeakMap<ts.SourceFile, Map<string, Carried>>();

/** Remembers that `node` reads what `carried` describes. Returns `expr`. */
export function markCarriedRead<E extends Expr>(
  expr: E,
  node: ts.Node,
  carried: Carried | undefined,
): E {
  if (carried !== undefined) carriedByNode.set(node, carried);
  return expr;
}

/** What a new variable carries: the origin of its initializer, with the variable's own text for
 *  a remedy; `undefined` when the initializer passes a declared type. An initializer of written
 *  numbers alone carries an origin that reaches no constant. */
export function carriedBy(
  keyword: 'let' | 'const',
  name: string,
  initializer: ts.Expression,
  initType: ShaderType,
  isBuiltin: (name: string) => boolean,
): Carried | undefined {
  const origin = originOf(initializer, isBuiltin);
  // A variable of written numbers alone reaches no constant, and it declares no type either:
  // beside a value that does reach one, it adds nothing (`let w = 3;` then `(k + w) / 2`). One
  // that its declared uses make an integer (`let n = 2; h(n);`, changes 0036 and 0037) is a
  // typed value.
  if (origin === undefined) return undefined;
  if (origin.reaches.length === 0 && !(initType.kind === 'scalar' && initType.scalar === 'f32')) {
    return undefined;
  }
  return {
    ...origin,
    variable: {
      keyword,
      name,
      init: writtenText(initializer).replace(/\s+/g, ' '),
      type: initType.kind === 'scalar' ? initType.scalar : 'f32',
    },
  };
}

/** Records that the function named `irName` in the IR returns `value`, when the function writes
 *  no result type. A call of the function then carries the origin of every such `return`. */
export function noteCarriedReturn(
  sourceFile: ts.SourceFile,
  irName: string,
  value: ts.Expression,
  isBuiltin: (name: string) => boolean,
): void {
  const origin = originOf(value, isBuiltin);
  if (origin === undefined || origin.reaches.length === 0) return;
  let table = carriedByFunction.get(sourceFile);
  if (table === undefined) carriedByFunction.set(sourceFile, (table = new Map()));
  const before = table.get(irName);
  table.set(irName, {
    reaches: [...new Set([...(before?.reaches ?? []), ...origin.reaches])],
    float: (before?.float ?? false) || origin.float,
  });
}

/** What a call of the IR function `irName` carries, if it returns a carried value. */
export function carriedByCall(sourceFile: ts.SourceFile, irName: string): Carried | undefined {
  return carriedByFunction.get(sourceFile)?.get(irName);
}

/** Whether `node` reads a constant of no fixed type whose written numbers are all
 *  integer-written: the read stands where an integer-written literal could. */
export function isIntegerWrittenRead(node: ts.Expression): boolean {
  const info = readByNode.get(stripParens(node));
  return info?.integerWritten === true && !readTypes.has(info);
}

/** Whether `node` reads a constant of no fixed type. A read that `withReadTypes` types is a
 *  typed value, as on `main`. */
export function isAbstractRead(node: ts.Expression): boolean {
  const info = readByNode.get(stripParens(node));
  return info !== undefined && !readTypes.has(info);
}

/** The `f32` literal a written number lowers to, for `expr` when it is a read of a constant of
 *  no fixed type or `+ - * / %` and a unary minus over such reads and literals: its ECMAScript
 *  value. `undefined` when `expr` holds no such read, or anything but those and literals. */
export function abstractLiteralOf(expr: Expr): Expr | undefined {
  let found = false;
  const walk = (e: Expr): number | undefined => {
    const read = readByExpr.get(e);
    if (read !== undefined) {
      found = true;
      return read.value;
    }
    if (e.op === 'lit') return typeof e.value === 'number' ? e.value : undefined;
    if (e.op === 'unop') {
      const a = walk(e.a);
      return a === undefined ? undefined : -a;
    }
    if (e.op === 'binop' && ['+', '-', '*', '/', '%'].includes(e.bop)) {
      const a = walk(e.a);
      const b = walk(e.b);
      if (a === undefined || b === undefined) return undefined;
      if ((e.bop === '/' || e.bop === '%') && b === 0) return undefined;
      return e.bop === '+'
        ? a + b
        : e.bop === '-'
          ? a - b
          : e.bop === '*'
            ? a * b
            : e.bop === '/'
              ? a / b
              : a % b;
    }
    return undefined;
  };
  const value = walk(expr);
  return found && value !== undefined ? { op: 'lit', type: f32T, value } : undefined;
}

/** `info` and every constant its initializer reaches. */
function withSources(info: AbstractConst, into = new Set<AbstractConst>()): Set<AbstractConst> {
  if (into.has(info)) return into;
  into.add(info);
  for (const source of info.sources) withSources(source, into);
  return into;
}

/** Records that `node`, an integer-written read or arithmetic over such reads, was typed
 *  `type`: each constant it reads, and each constant those are derived from, is read as an
 *  integer. A float-written constant is never one (`u32(C)` with `const C = 7.5` converts). */
export function noteIntegerRead(node: ts.Expression, type: 'i32' | 'u32'): void {
  const tree = abstractTreeOf(node);
  if (tree === undefined || !tree.integerWritten) return;
  for (const read of tree.reads) {
    for (const info of withSources(read)) info.integerReads.push({ type, node });
  }
  for (const leaf of readLeaves(node)) settleRead(leaf, type === 'u32' ? u32T : i32T);
}

/** Whether `node` is `inner`, or holds it. */
function holds(node: ts.Node, inner: ts.Node): boolean {
  for (let at: ts.Node | undefined = inner; at !== undefined; at = at.parent) {
    if (at === node) return true;
  }
  return false;
}

/** Records that an integer position of type `type` read the expression `node`: a `/` inside
 *  it was asked for an integer quotient. */
export function noteIntegerContext(
  node: ts.Expression,
  type: 'i32' | 'u32',
  anyInteger = false,
): void {
  const visit = (n: ts.Node): void => {
    const division = divisionByNode.get(n);
    if (division !== undefined && division.asked === undefined) {
      division.asked = type;
      division.anyInteger = anyInteger;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
}

const CASTS: ReadonlySet<string> = new Set(['f32', 'f64', 'i32', 'u32', 'bool']);

/** Whether `call` constructs a vector or a matrix of a written component type: `vec3u(…)`,
 *  `vec2f(…)`, `mat2x2f(…)`, or a type argument `vec2<u32>(…)`. */
function isTypedConstructor(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isIdentifier(callee)) return false;
  if (/^(vec[234]|mat[234]x[234])[uifh]$/.test(callee.text)) return true;
  return /^(vec[234]|mat[234]x[234])$/.test(callee.text) && (call.typeArguments?.length ?? 0) > 0;
}

/** The origin of `node` (Amendment A3, "보수적 추적 규칙"): the constants of no fixed type it
 *  comes from, through every expression and binding with no declared type between. A written
 *  number has an empty origin. A read of such a constant, a variable, a loop counter or a call
 *  that carries one, an operator, a builtin (`Math.*` and `select` included), `as`, `!`, a
 *  conditional, a member or an element of such a value: the origin of their parts. `undefined`
 *  where the value passes a declared type: an annotation, a declared parameter, field or result,
 *  a conversion, or any read of a value that carries no origin. */
export function originOf(
  node: ts.Expression,
  isBuiltin: (name: string) => boolean,
): Origin | undefined {
  const inner = stripParens(node);
  if (ts.isNumericLiteral(inner)) return { reaches: [], float: !integerWrittenLiteral(inner) };
  const read = readByNode.get(inner);
  if (read !== undefined) return { reaches: [read], float: !read.integerWritten };
  const carried = carriedByNode.get(inner);
  if (carried !== undefined) return { reaches: carried.reaches, float: carried.float };
  if (
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isTypeAssertionExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    return originOf(inner.expression, isBuiltin);
  }
  if (
    ts.isPrefixUnaryExpression(inner) &&
    (inner.operator === ts.SyntaxKind.MinusToken || inner.operator === ts.SyntaxKind.PlusToken)
  ) {
    return originOf(inner.operand, isBuiltin);
  }
  const all = (parts: readonly ts.Expression[]): Origin | undefined => {
    const reaches: AbstractConst[] = [];
    let float = false;
    for (const part of parts) {
      const one = originOf(part, isBuiltin);
      if (one === undefined) return undefined;
      reaches.push(...one.reaches);
      float ||= one.float;
    }
    return { reaches, float };
  };
  if (
    ts.isBinaryExpression(inner) &&
    (ARITH.has(inner.operatorToken.kind) ||
      BITWISE.has(inner.operatorToken.kind) ||
      inner.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken)
  ) {
    return all([inner.left, inner.right]);
  }
  if (ts.isConditionalExpression(inner)) return all([inner.whenTrue, inner.whenFalse]);
  if (ts.isPropertyAccessExpression(inner)) {
    // `Math.PI` is a written constant of its own; a swizzle or a member of a value with an
    // origin keeps it.
    return ts.isIdentifier(inner.expression) && inner.expression.text === 'Math'
      ? undefined
      : originOf(inner.expression, isBuiltin);
  }
  if (ts.isElementAccessExpression(inner)) return originOf(inner.expression, isBuiltin);
  // A typed constructor (`vec3u(k, 1, 2)`, `vec2<u32>(k, 1)`) declares its type, as a cast
  // does, and ends the origin (Amendment A4 of change 0134, PR #1224, "선언된 타입으로 보기").
  if (ts.isCallExpression(inner) && isTypedConstructor(inner)) return undefined;
  if (ts.isCallExpression(inner) && inner.arguments.length > 0) {
    const callee = inner.expression;
    const builtin =
      (ts.isIdentifier(callee) && !CASTS.has(callee.text) && isBuiltin(callee.text)) ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'Math');
    // `select(f, t, c)` takes its value from its first two arguments; the condition is a `bool`.
    if (builtin) {
      const select = ts.isIdentifier(callee) && callee.text === 'select';
      return all(select ? inner.arguments.slice(0, 2) : [...inner.arguments]);
    }
  }
  return undefined;
}

/** Whether `node` reaches a constant of no fixed type with no declared type between. */
export function hasOrigin(node: ts.Expression, isBuiltin: (name: string) => boolean): boolean {
  return (originOf(node, isBuiltin)?.reaches.length ?? 0) > 0;
}

/** Records a `/` whose operands have no declared type and reach a constant of no fixed type.
 *  Call it after both operands were lowered. `isBuiltin` says whether a called name is a
 *  builtin, whose result has the type of its arguments, and not a declared function. */
export function noteAbstractDivision(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  isBuiltin: (name: string) => boolean,
): void {
  const k = node.operatorToken.kind;
  if (k !== ts.SyntaxKind.SlashToken && k !== ts.SyntaxKind.SlashEqualsToken) return;
  const left = originOf(node.left, isBuiltin);
  const right = originOf(node.right, isBuiltin);
  if (left === undefined || right === undefined) return;
  // A float-written literal or a float-written constant in either operand makes a float
  // division, which is accepted (Amendment A3, "실수 나눗셈으로 허용").
  if (left.float || right.float) return;
  const reads = [...left.reaches, ...right.reaches];
  let table = divisionsOf.get(sourceFile);
  if (table === undefined) divisionsOf.set(sourceFile, (table = new Map()));
  const division: Division = { node, reads };
  table.set(node, division);
  divisionByNode.set(node, division);
}

/** Whether `node` is a bitwise or shift operation, whose value is an integer's. */
function isBitwise(node: ts.Node): boolean {
  return (
    (ts.isBinaryExpression(node) && BITWISE.has(node.operatorToken.kind)) ||
    (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.TildeToken)
  );
}

/** The parts of `node` that carry an origin as a whole: a read of a constant of no fixed type,
 *  and a variable, a counter or a call that carries one. */
function originLeaves(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (readByNode.has(n) || (carriedByNode.get(n)?.reaches.length ?? 0) > 0) out.push(n);
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** Whether `leaf`, inside `within`, is read as an index or a shift amount. */
function inIntegerSlot(leaf: ts.Node, within: ts.Node): boolean {
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

/** `node` as written, with each part that carries an origin converted to `type`: `f32(k) / 2`,
 *  `xs[i32(k) / 2]`. A float conversion of a value under a bitwise or shift operator converts
 *  the outermost such operation instead, which has an integer's value: `f32(k | 1) / 2`. */
function withOriginsConverted(
  node: ts.Node,
  type: string,
  sourceFile: ts.SourceFile,
  /** The text of the source compiled, not as the author's files write it: the change a check
   *  makes to a linked source (Rule 3.9), whose names the linker may have renamed. */
  raw = false,
): string {
  const range = (a: number, b: number) =>
    raw ? sourceFile.text.slice(a, b) : writtenRange(sourceFile, a, b);
  const text = (n: ts.Node) => (raw ? n.getText(sourceFile) : writtenText(n));
  const start = node.getStart(sourceFile);
  let out = '';
  let at = start;
  for (const n of originUnits(node, type)) {
    out += range(at, n.getStart(sourceFile));
    out += `${type}(${text(ts.isParenthesizedExpression(n) ? n.expression : n)})`;
    at = n.getEnd();
  }
  return (out + range(at, node.getEnd())).replace(/\s+/g, ' ');
}

/** The parts of `node` that {@link withOriginsConverted} wraps in `type`, in source order. */
function originUnits(node: ts.Node, type: string): ts.Node[] {
  const wrapped = new Set<ts.Node>();
  const float = type === 'f32' || type === 'f64';
  for (const leaf of originLeaves(node)) {
    // An index and a shift amount stay integers: `vec2(k, 5)[k] / 2` converts the element, not
    // the index (the fourth review of #1184, finding 3).
    if (float && inIntegerSlot(leaf, node)) continue;
    let at: ts.Node = leaf;
    if (type === 'f32' || type === 'f64') {
      for (
        let up: ts.Node | undefined = leaf.parent;
        up !== undefined && up !== node.parent;
        up = up.parent
      ) {
        if (isBitwise(up)) at = up;
        if (up === node) break;
      }
    }
    // `(k | 1)` converted is `f32(k | 1)`, not `(f32(k | 1))`.
    const paren = at.parent;
    wrapped.add(
      paren !== undefined &&
        ts.isParenthesizedExpression(paren) &&
        paren !== node &&
        holds(node, paren)
        ? paren
        : at,
    );
  }
  // An outer wrap holds an inner one: keep the outer.
  const outer = [...wrapped].filter(
    (n) => ![...wrapped].some((other) => other !== n && holds(other, n)),
  );
  return outer.sort((x, y) => x.pos - y.pos);
}

const ANOTHER_READ = 'where another line reads it, and no operand of';
/** The clause every refusal of a `/` holds, whatever its subject clause says. */
const NO_DIVISION = 'does not say which division it is';

/** Whether `d` is the refusal of {@link reportAbstractDivisions}. It depends on the whole
 *  program: the `/` may stand in one file and the integer read in another, which imports it.
 *  The language service asks, so that the file of the `/` shows what `compile()` of the
 *  importing file reports (Rule 12.7). */
export function isAbstractDivisionRefusal(d: {
  readonly code?: string | undefined;
  readonly message: string;
}): boolean {
  return d.code === TS_CODES.TYPE_MISMATCH && d.message.includes(NO_DIVISION);
}

/** The sentence of a refused `/` or `/=` (decisions Q6, Q10 and Q11; Amendments A2 and A3):
 *  what is wrong, and the one edit that compiles where the quotient stands. The subject is the
 *  constant as the `/` reads it (`L.K`, `KK`), or by its name when the `/` reaches it through
 *  another value.
 *
 *  - Where an integer position reads the quotient (`xs[k / 2]`, `r + k / 2`, `let j: u32 = …`),
 *    the edit is the constant declared with the type that position asks, when every other read
 *    agrees with it and the constant is declared in this file; otherwise the `/` with each value
 *    converted to that type (`xs[i32(k) / 2]`).
 *  - Anywhere else, the `/` with each value converted to `f32`, a bitwise operation converted as
 *    a whole (`f32(k | 1) / 2`).
 *  - A `/=` names the variable declared with the type it has: an integer keeps the integer
 *    division, an `f32` the float one. */
/** One edit a refusal can name: the text to write, the division it makes, and how it changes
 *  the source, to check that it compiles where the quotient stands (Rule 5.1). */
interface DivisionEdit {
  readonly text: string;
  readonly kind: 'integer' | 'float';
  /** `[start, end)` of the source and the text that replaces it; `undefined` for a `/=`, whose
   *  edit declares its variable (`declarationChange` makes that change). */
  readonly change?: { readonly start: number; readonly end: number; readonly text: string };
}

/** The edits a refusal of `division` can name, the preferred one first. An integer position
 *  asks the constant declared with its type, or each value with the origin converted to it; a
 *  float position asks the conversion to `f32`; each other form follows as a fallback. */
function divisionEdits(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32' },
  division: {
    readonly node: ts.BinaryExpression;
    readonly asked?: 'i32' | 'u32';
    readonly anyInteger?: boolean;
  },
  sourceFile: ts.SourceFile,
): DivisionEdit[] {
  const { node } = division;
  if (node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken) {
    const variable = carriedByNode.get(stripParens(node.left))?.variable;
    const integer = variable?.type === 'i32' || variable?.type === 'u32';
    return [
      {
        kind: integer ? 'integer' : 'float',
        text:
          variable === undefined
            ? `${node.left.getText(sourceFile)} = f32(${node.left.getText(sourceFile)}) / ${node.right.getText(sourceFile)}`
            : `${variable.keyword === '' ? '' : `${variable.keyword} `}${variable.name}: ` +
              `${variable.type} = ${variable.init}`,
      },
    ];
  }
  const short = writtenText(info.nameNode).replace(/^#/, '');
  const replace = (text: string) => ({
    start: node.getStart(sourceFile),
    end: node.getEnd(),
    text,
  });
  const converted = (type: string): DivisionEdit => {
    const text = withOriginsConverted(node, type, sourceFile);
    const change = replace(withOriginsConverted(node, type, sourceFile, true));
    return { kind: type === 'f32' ? 'float' : 'integer', text, change };
  };
  const declared = (type: 'i32' | 'u32'): DivisionEdit | undefined => {
    if (info.keyword === 'function') return undefined;
    if (!sameFile(info.nameNode, node) || !info.integerReads.every((r) => r.type === type)) {
      return undefined;
    }
    const decl = info.nameNode.parent as ts.VariableDeclaration | ts.PropertyDeclaration;
    // After the name, in place of a type the projection wrote there.
    const at = info.nameNode.getEnd();
    const change = { start: at, end: decl.type?.getEnd() ?? at, text: `: ${type}` };
    const head = info.keyword === '' ? short : `${info.keyword} ${short}`;
    return { kind: 'integer', text: `${head}: ${type} = ${info.written}`, change };
  };
  const other: 'i32' | 'u32' = read.type === 'u32' ? 'i32' : 'u32';
  const out: (DivisionEdit | undefined)[] = [];
  if (division.asked !== undefined) {
    // An index takes either integer type: the other reads' type, when they agree, keeps them.
    const type =
      division.anyInteger === true && info.integerReads.every((r) => r.type === read.type)
        ? read.type
        : division.asked;
    out.push(declared(type), converted(type), converted(type === 'u32' ? 'i32' : 'u32'));
    out.push(converted('f32'));
  } else {
    out.push(converted('f32'), declared(read.type), converted(read.type), converted(other));
  }
  const seen = new Set<string>();
  return out.filter((e): e is DivisionEdit => {
    if (e === undefined || seen.has(e.text)) return false;
    seen.add(e.text);
    return true;
  });
}

/** The operation inside `division` that reads `read` as an integer (a bitwise operator, a
 *  shift, a `~`), when the read stands inside the `/`; `undefined` otherwise. */
function readerWithin(read: ts.Node, division: ts.Node): ts.Node | undefined {
  if (!holds(division, read) || read === division) return undefined;
  for (let at = read.parent; at !== undefined && at !== division; at = at.parent) {
    if (ts.isBinaryExpression(at) || ts.isPrefixUnaryExpression(at)) return at;
  }
  return undefined;
}

/** The refusal's sentence, naming `edit`, or no edit (`null`): what to write around which
 *  operands, or which variable to declare with a type. */
function divisionSentence(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32'; readonly node?: ts.Node },
  node: ts.BinaryExpression,
  edit: DivisionEdit | null,
  sourceFile: ts.SourceFile,
  /** The types the quotient's positions take, which a remedy that names no edit lists. */
  allowed?: readonly string[],
): string {
  // Where the read that makes the constant an integer stands inside the `/` (`(K | 1) / 2`,
  // `(K << 1) / 4`), the sentence names the expression that reads it, not another line.
  const reader = read.node === undefined ? undefined : readerWithin(read.node, node);
  const where =
    reader === undefined
      ? ANOTHER_READ
      : `where "${writtenText(reader).replace(/\s+/g, ' ')}" reads it, and no operand of`;
  const written = writtenText(node).replace(/\s+/g, ' ');
  const direct = originLeaves(node).find((leaf) => readByNode.get(leaf as ts.Expression) === info);
  const subject = direct !== undefined ? writtenText(direct) : info.name;
  const operator = node.operatorToken.getText(sourceFile);
  const what =
    info.openCounter === true
      ? `"${subject}" is the counter of a "for" that is not counted, and no use gives it a ` +
        `type. No operand of`
      : `"${subject}" is ${read.type === 'u32' ? 'a u32' : 'an i32'} ${where}`;
  let remedy: string;
  if (edit !== null) remedy = `Write "${edit.text}" for the ${edit.kind} division.`;
  else if (node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken) {
    const name =
      carriedByNode.get(stripParens(node.left))?.variable?.name ?? writtenText(node.left);
    const types = [...(allowed ?? ['i32', 'u32', 'f32'])];
    const list =
      types.length <= 1 ? (types[0] ?? '') : `${types.slice(0, -1).join(', ')} or ${types.at(-1)!}`;
    remedy = `Declare "${name}" with ${list} to choose the division.`;
  } else {
    remedy = genericDivisionRemedy(
      originUnits(node, 'f32').map((n) =>
        writtenText(ts.isParenthesizedExpression(n) ? n.expression : n).replace(/\s+/g, ' '),
      ),
      allowed,
      { node, constant: true },
    );
  }
  return `${what} "${written}" has a declared type, so the "${operator}" ${NO_DIVISION}. ${remedy}`;
}

/** The edit that converts each part of `node` that carries an origin to `type`. */
function convertedEdit(
  node: ts.BinaryExpression,
  type: string,
  sourceFile: ts.SourceFile,
): DivisionEdit {
  return {
    kind: type === 'f32' ? 'float' : 'integer',
    text: withOriginsConverted(node, type, sourceFile),
    change: {
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      text: withOriginsConverted(node, type, sourceFile, true),
    },
  };
}

/** The refusal of `division` with its preferred edit, unchecked. */
export function abstractDivisionMessage(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32' },
  division: {
    readonly node: ts.BinaryExpression;
    readonly asked?: 'i32' | 'u32';
    readonly anyInteger?: boolean;
  },
  sourceFile: ts.SourceFile,
): string {
  const edit = divisionEdits(info, read, division, sourceFile)[0]!;
  return divisionSentence(info, read, division.node, edit, sourceFile);
}

/** Compiles `text`, a whole source with one edit made, and returns its errors. `starts` are the
 *  editor projection's insertions in `text`, moved past the edit. */
export type DivisionEditCheck = (
  text: string,
  starts: readonly number[] | undefined,
) => readonly { readonly code?: string; readonly message: string; readonly start?: number }[];

/** True while a named edit is being compiled: the refusals of that compile name their preferred
 *  edit unchecked, so a check never starts another. */
let checkingEdit = false;

/** The `/` and `/=` over a bitwise expression of written integers, by file (the owner's decision
 *  of 2026-11-11 on #1272, D-b, "A2대로 거부"): such a value is an integer by its bit operator,
 *  and no operand has a declared type, so the division is refused as Amendment A2 refuses one
 *  over a constant, unless an integer position reads the quotient (Amendment A4). */
const writtenDivisionsOf = new WeakMap<ts.SourceFile, WrittenDivision[]>();

/** One `/` or `/=` over a binding that holds a tree of written integers (D-b). */
interface WrittenDivision {
  readonly node: ts.BinaryExpression;
  readonly subject: string;
  /** Each operand that carries a tree, as written: what a remedy that names no edit wraps. */
  readonly subjects: readonly string[];
  readonly edit: string;
  readonly kind: 'float' | 'integer';
  /** The edit for an integer peer that states no type, by its type. */
  readonly peerEdit?: (type: 'i32' | 'u32') => string;
  /** A position that states an integer type, or a comparison, read the quotient (A4). */
  read: boolean;
  /** The type of an integer peer that states no type and read the quotient. */
  peer?: 'i32' | 'u32';
  /** Whether an operand holds two readings (D2): its float is `f32(i32(…))`. */
  readonly readings?: boolean;
}

/** Records a `/` or `/=` over a binding that holds a tree of written integers: `subject` is the
 *  operand that carries it, as written, and `edit` the text that compiles in its place. */
export function noteWrittenDivision(
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  subject: string,
  edit: string,
  kind: 'float' | 'integer',
  peerEdit?: (type: 'i32' | 'u32') => string,
  subjects: readonly string[] = [subject],
  readings = false,
): void {
  // A `/` over a constant of no fixed type is refused by its own sentence (Amendment A2).
  if (divisionByNode.get(node)?.reads.length) return;
  let list = writtenDivisionsOf.get(sourceFile);
  if (list === undefined) writtenDivisionsOf.set(sourceFile, (list = []));
  if (list.some((d) => d.node === node)) return;
  list.push({
    node,
    subject,
    subjects,
    edit,
    kind,
    read: false,
    ...(peerEdit !== undefined ? { peerEdit } : {}),
    ...(readings ? { readings } : {}),
  });
}

/** Records how a position read the quotient of the `/` at `node`: a position that states an
 *  integer type, or a comparison (`'read'`), takes it and the `/` stands; an integer peer that
 *  states none names its type for the edit. */
export function noteWrittenDivisionRead(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  how: 'read' | 'i32' | 'u32',
): void {
  const record = writtenDivisionsOf.get(sourceFile)?.find((d) => d.node === node);
  if (record === undefined) return;
  if (how === 'read') record.read = true;
  else record.peer ??= how;
}

/** The reads of each binding that holds a refused quotient (`q` in `let q = (1 | 2) / 2`), by
 *  file: a mismatch that a read's `f32` raises where it flows is that refusal said again. */
const quotientReadsOf = new WeakMap<ts.SourceFile, ts.Node[]>();

/** Records `node`, a read of a binding that holds a refused quotient. */
export function noteQuotientRead(node: ts.Node): void {
  const sourceFile = node.getSourceFile();
  let reads = quotientReadsOf.get(sourceFile);
  if (reads === undefined) quotientReadsOf.set(sourceFile, (reads = []));
  reads.push(node);
}

/** A refusal whose named edit the checked-edit path confirms: a quotient of a tree of written
 *  integers (D-b, `lit-coerce.ts` THE RULE). */
export interface CheckedRefusal {
  /** The tree the edit replaces. */
  readonly node: ts.Node;
  /** The integer type of a peer that states no type, which the edit takes; else `undefined`. */
  readonly peer: () => string | undefined;
  /** The edit that makes the tree divide in `type`. */
  readonly edit: (type: 'f32' | 'i32' | 'u32') => string;
  /** The refusal as it stands, if it stands. */
  readonly current: () => TsCompilerDiagnostic | undefined;
  /** Names `edit` in the refusal, or no edit (`null`), listing the types `allowed` (the types
   *  the quotient's positions take) in the remedy that names none. */
  readonly restate: (edit: string | null, allowed?: readonly string[]) => void;
}

const checkedRefusalsOf = new WeakMap<ts.SourceFile, CheckedRefusal[]>();

/** Records `refusal`, whose edit {@link reportAbstractDivisions} confirms. */
export function noteCheckedRefusal(sourceFile: ts.SourceFile, refusal: CheckedRefusal): void {
  let list = checkedRefusalsOf.get(sourceFile);
  if (list === undefined) checkedRefusalsOf.set(sourceFile, (list = []));
  list.push(refusal);
}

/** The `/` and `/=` refused for a divisor proven zero: that refusal is their one mistake, so no
 *  refusal of the division (Amendment A2, D-b) is said beside it (Rule 12.4). */
const zeroDivisions = new WeakSet<ts.Node>();

/** Records that the division at `node` was refused for a divisor proven zero. */
export function noteZeroDivision(node: ts.Node): void {
  zeroDivisions.add(node);
}

/** Reports each `/` recorded by {@link noteAbstractDivision} that reaches a constant another
 *  read made an integer, once for the outermost such `/`. The quotient's own read
 *  (`let j: u32 = K / 2`) is not another read: the written `8 / 2` is `4u` there, and so is
 *  the constant's. It also reports each refused `/` of a binding that holds a tree of written
 *  integers, and checks the edits of every refused `/` of the module together
 *  ({@link checkModuleEdits}). Call it after the whole module was lowered. */
export function reportAbstractDivisions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  check?: DivisionEditCheck,
): void {
  const refused: { division: Division; info: AbstractConst; read: IntegerRead }[] = [];
  for (const division of divisionsOf.get(sourceFile)?.values() ?? []) {
    if (zeroDivisions.has(division.node)) continue;
    let found: { info: AbstractConst; read: IntegerRead } | undefined;
    // The sentence names the value a read outside the `/` makes an integer, where one does: in
    // `k / n` with `n` an integer by its uses, `k` is an integer only beside `n`.
    let inside: { info: AbstractConst; read: IntegerRead } | undefined;
    for (const reached of division.reads) {
      for (const info of withSources(reached)) {
        const read = info.integerReads.find((r) => !holds(r.node, division.node));
        if (read === undefined) continue;
        if (holds(division.node, read.node)) inside ??= { info, read };
        else found ??= { info, read };
      }
    }
    found ??= inside;
    if (found !== undefined) refused.push({ division, ...found });
  }
  // `(k / 2) / 3` is one mistake, said on the outer `/` (Rule 12.4).
  const outer = refused.filter(
    ({ division }) =>
      !refused.some(
        (other) => other.division !== division && holds(other.division.node, division.node),
      ),
  );
  // Each refusal names its edit unchecked first; `checkModuleEdits` then names the module's
  // edits only where they compile together, or none (the owner's decision of 2026-11-12).
  const batch: { node: ts.Node; peer?: Scalar; build: (cx: FlowContext) => BatchItem }[] = [];
  const replace = (from: TsCompilerDiagnostic, to: TsCompilerDiagnostic): TsCompilerDiagnostic => {
    const i = diagnostics.indexOf(from);
    if (i >= 0) diagnostics[i] = to;
    return to;
  };
  /** Takes out each mismatch around `node` that is its refusal said again (Rule 12.4). */
  const dropRepeats = (node: ts.Node): void => {
    const [start, end] = [node.getStart(sourceFile), node.getEnd()];
    for (let i = diagnostics.length - 1; i >= 0; i--) {
      const d = diagnostics[i]!;
      if (
        d.code === TS_CODES.TYPE_MISMATCH &&
        d.category === 'error' &&
        d.start <= start &&
        d.start + d.length >= end &&
        !d.message.includes(NO_DIVISION)
      ) {
        diagnostics.splice(i, 1);
      }
    }
  };
  for (const { division, info, read } of outer) {
    const { node } = division;
    dropRepeats(node);
    const edits = divisionEdits(info, read, division, sourceFile);
    const sentence = (
      edit: DivisionEdit | null,
      allowed?: readonly Scalar[],
    ): TsCompilerDiagnostic => {
      const d = makeDiagnostic(
        sourceFile,
        node,
        divisionSentence(info, read, node, edit, sourceFile, allowed),
        TS_CODES.TYPE_MISMATCH,
      );
      // The read that makes the constant an integer is the use that makes this `/` a refusal:
      // in a program of several files the refusal stands on it when the file that holds the
      // `/` does not refuse it on its own (`program-refusals.ts`, #1186), with the `/` as its
      // site.
      noteUse(d, read.node, sourceFile);
      return d;
    };
    let current = sentence(edits[0]!);
    diagnostics.push(current);
    const say = (edit: DivisionEdit | null, allowed?: readonly Scalar[]) =>
      (current = replace(current, sentence(edit, allowed)));
    batch.push({
      node,
      build: (cx) => {
        if (node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken) {
          // `y /= 2` names the variable declared with its type. Where the variable flows to two
          // types (`let j: i32 = y; let z: f32 = y`), no declaration serves both: no edit.
          const variable = carriedByNode.get(stripParens(node.left))?.variable;
          const change =
            variable === undefined
              ? undefined
              : declarationChange(variable.name, node.left, variable.type);
          const decl = variable === undefined ? undefined : declarationOf(variable.name, node.left);
          const use =
            decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined
              ? typesFromUse(decl.initializer, undefined, cx)
              : undefined;
          return {
            diagnostic: () => current,
            sets: [change, change],
            conflict: use?.conflict === true,
            name: () => undefined,
            generic: () => say(null, use?.allowed),
          };
        }
        // A position that asked an integer of the quotient decides it as the edits say;
        // otherwise the use of the quotient does.
        if (division.asked !== undefined) {
          const second = edits.find((e, i) => i > 0 && e.change !== undefined) ?? edits[0]!;
          // The remedy that names no edit lists the types the positions take.
          const { allowed } = typesFromUse(node, undefined, cx);
          return {
            diagnostic: () => current,
            sets: [edits[0]!.change, second.change],
            conflict: false,
            name: (set) => {
              if (set === 1) say(second);
            },
            generic: () => say(null, allowed),
          };
        }
        const { first, second, conflict, allowed } = typesFromUse(node, undefined, cx);
        const edit = (t: Scalar): DivisionEdit =>
          t === 'f32' ? edits[0]! : convertedEdit(node, t, sourceFile);
        return {
          diagnostic: () => current,
          sets: [edit(first).change, edit(second).change],
          conflict,
          name: (set) => {
            const t = set === 0 ? first : second;
            if (t !== 'f32') say(edit(t));
          },
          generic: () => say(null, allowed),
        };
      },
    });
  }
  // A `/` over a binding that holds a tree of written integers (D-b): refused where no position
  // that states an integer type, and no comparison, reads the quotient, once for the outermost
  // such `/` (Rule 12.4).
  const written = (writtenDivisionsOf.get(sourceFile) ?? []).filter(
    (w) =>
      !w.read && !zeroDivisions.has(w.node) && !outer.some((o) => holds(o.division.node, w.node)),
  );
  for (const w of written) {
    if (written.some((o) => o !== w && holds(o.node, w.node))) continue;
    const { node } = w;
    // A mismatch the quotient raised where it stands (`return ((1 | 2) * 3) / 2` in an `f32`
    // function) is this mistake said again, and the edit closes it (Rule 12.4).
    dropRepeats(node);
    const text = writtenText(node).replace(/\s+/g, ' ');
    const operator = node.operatorToken.getText(sourceFile);
    const assign = node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken;
    const sentence = (
      edit: string | null,
      kind: string,
      allowed?: readonly Scalar[],
    ): TsCompilerDiagnostic =>
      makeDiagnostic(
        sourceFile,
        node,
        `"${w.subject}" is an integer by its bit operator, and no operand of "${text}" has a ` +
          `declared type, so the "${operator}" ${NO_DIVISION}. ` +
          (edit !== null
            ? `Write "${edit}" for the ${kind} division.`
            : assign
              ? `Declare "${w.subject}" with ${(allowed ?? ['i32', 'u32'])
                  .filter((t) => t !== 'f32')
                  .join(' or ')} to choose the division.`
              : genericDivisionRemedy(
                  w.subjects,
                  w.readings === true
                    ? (allowed ?? ALL_SCALARS).map((t) => (t === 'f32' ? 'f32(i32' : t))
                    : allowed,
                  { node },
                )),
        TS_CODES.TYPE_MISMATCH,
      );
    const editIn = (t: Scalar): string =>
      t === 'f32' || w.peerEdit === undefined ? w.edit : w.peerEdit(t);
    const peer = w.peerEdit !== undefined ? w.peer : undefined;
    let current = sentence(editIn(peer ?? 'f32'), peer === undefined ? w.kind : 'integer');
    diagnostics.push(current);
    const say = (edit: string | null, kind = 'integer', allowed?: readonly Scalar[]) =>
      (current = replace(current, sentence(edit, kind, allowed)));
    batch.push({
      node,
      ...(peer !== undefined ? { peer } : {}),
      build: (cx) => {
        if (assign) {
          // `a /= 2` names the variable declared with the integer type its uses ask (`return a`
          // in a `u32` function: `let a: u32 = 1 | 2`). An `f32` use leaves no such declaration
          // (the integer of a tree is no `f32`), so it names none.
          const declared = /: (i32|u32) =/.exec(w.edit)?.[1] as Scalar | undefined;
          const name = node.left.getText(sourceFile);
          const decl = declarationOf(name, node.left);
          if (
            declared === undefined ||
            decl === undefined ||
            !ts.isVariableDeclaration(decl) ||
            decl.initializer === undefined
          ) {
            return {
              diagnostic: () => current,
              sets: [undefined, undefined],
              conflict: true,
              name: () => undefined,
              generic: () => say(null),
            };
          }
          const use = typesFromUse(decl.initializer, undefined, cx);
          const asked = (t: Scalar): Scalar => (t === 'f32' ? declared : t);
          const editIn = (t: Scalar) => w.edit.replace(/: (i32|u32) =/, `: ${t} =`);
          return {
            diagnostic: () => current,
            sets: [
              declarationChange(name, node.left, asked(use.first)),
              declarationChange(name, node.left, asked(use.second)),
            ],
            conflict: use.conflict,
            name: (set) => {
              const t = asked(set === 0 ? use.first : use.second);
              if (t !== declared) say(editIn(t));
            },
            generic: () =>
              say(null, 'integer', use.allowed.some((t) => t !== 'f32') ? use.allowed : undefined),
          };
        }
        const { first, second, conflict, allowed } = typesFromUse(node, peer, cx);
        const change = (t: Scalar): SourceChange => ({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: editIn(t),
        });
        return {
          diagnostic: () => current,
          sets: [change(first), change(second)],
          conflict,
          name: (set) => {
            const t = set === 0 ? first : second;
            if (t !== (peer ?? 'f32')) say(editIn(t), t === 'f32' ? 'float' : 'integer');
          },
          generic: () => say(null, 'integer', allowed),
        };
      },
    });
  }
  // A mismatch or an argument refusal that a read of a refused quotient raised where its `f32`
  // flows (`let q = (1 | 2) / 2; return q * 2;` in an `i32` function) is the refusal of the `/`
  // said again (Rule 12.4).
  const reads = quotientReadsOf.get(sourceFile) ?? [];
  if (reads.length > 0 && diagnostics.some((d) => d.message.includes(NO_DIVISION))) {
    for (let i = diagnostics.length - 1; i >= 0; i--) {
      const d = diagnostics[i]!;
      if (
        (d.code === TS_CODES.TYPE_MISMATCH || d.code === TS_CODES.MATH_ARGUMENT) &&
        !d.message.includes(NO_DIVISION) &&
        reads.some((r) => {
          const start = r.getStart(sourceFile);
          return d.start <= start && d.start + d.length >= r.getEnd();
        })
      ) {
        diagnostics.splice(i, 1);
      }
    }
  }
  // The trees of written integers (D-b): each tree's refusal, as it stands.
  for (const r of checkedRefusalsOf.get(sourceFile) ?? []) {
    const d = r.current();
    if (d === undefined || !diagnostics.includes(d)) continue;
    // A tree that a refused `/` over a constant also covers (`(K | 0) / 2`) is that one
    // mistake, said by the constant's sentence (Rule 12.4).
    if (outer.some((o) => holds(o.division.node, r.node) || holds(r.node, o.division.node))) {
      diagnostics.splice(diagnostics.indexOf(d), 1);
      continue;
    }
    const peer = r.peer() as Scalar | undefined;
    batch.push({
      node: r.node,
      ...(peer !== undefined ? { peer } : {}),
      build: (cx) => {
        const { first, second, conflict, allowed } = typesFromUse(r.node, peer, cx);
        const change = (t: Scalar): SourceChange => ({
          start: r.node.getStart(sourceFile),
          end: r.node.getEnd(),
          text: r.edit(t),
        });
        return {
          diagnostic: r.current,
          sets: [change(first), change(second)],
          conflict,
          name: (set) => {
            const t = set === 0 ? first : second;
            if (t !== (peer ?? 'f32')) r.restate(r.edit(t));
          },
          generic: () => r.restate(null, allowed),
        };
      },
    });
  }
  // The values with two readings (D2): the edit takes `u32` beside a `u32` and where the
  // operation's value flows to one, `i32` (TypeScript's value) where it flows to an `i32` or an
  // `f32`; a target of an assignment names its declaration with the type.
  for (const r of readingsRefusalsOf.get(sourceFile) ?? []) {
    if (!diagnostics.includes(r.diagnostic)) continue;
    batch.push({
      node: r.node,
      build: (cx) => {
        let first: 'u32' | 'i32' = 'u32';
        let second: 'u32' | 'i32' = 'i32';
        if (r.peer === 'u32') second = 'u32';
        else if (r.peer === 'i32') [first, second] = ['i32', 'i32'];
        else if (r.operator === 'f32()') [first, second] = ['i32', 'u32'];
        else {
          const use = typesFromUse(r.operation, undefined, cx);
          if (use.first === 'i32' || use.first === 'f32') [first, second] = ['i32', 'u32'];
        }
        const text = skipParenNodes(r.node).getText(sourceFile);
        // A constant of no fixed type is its TypeScript value wherever it is read, so a
        // conversion around it never reads the bits: its declaration with the type is the edit,
        // as an assignment's target's is. One declared in another file names no edit here (F4).
        const constant = untypedConstant(r.node);
        const declared = r.target || constant !== undefined;
        const elsewhere =
          constant !== undefined && programFileOf(constant) !== programFileOf(r.node);
        const shown: ReadingsRefusal = declared ? { ...r, target: true } : r;
        const change = (t: 'u32' | 'i32'): SourceChange | undefined =>
          elsewhere
            ? undefined
            : declared
              ? declarationChange(text, r.node, t)
              : { start: r.node.getStart(sourceFile), end: r.node.getEnd(), text: `${t}(${text})` };
        const say = (type: 'u32' | 'i32' | null | 'none') => {
          const next = makeDiagnostic(
            sourceFile,
            r.node,
            type === 'none' || (type === null && elsewhere)
              ? readingsSentenceOf(r, '').trimEnd()
              : readingsSentenceOf(r, readingsRemedy(shown, type)),
            TS_CODES.TYPE_MISMATCH,
          );
          const i = diagnostics.indexOf(r.diagnostic);
          if (i >= 0) diagnostics[i] = next;
          r.diagnostic = next;
        };
        return {
          diagnostic: () => r.diagnostic,
          sets: [change(first), change(second)],
          conflict: false,
          name: (set) => {
            const t = set === 0 ? first : second;
            if (t !== 'u32' || declared) say(t);
          },
          generic: () => say(null),
          bare: () => say('none'),
        };
      },
    });
  }
  // The `>>` over a written `u32` and the value forms (`Write the u32 with the same bits, …`) name
  // edits too, and each is verified with the module's others, as every named edit is ("name only
  // verified edits"; F6 of the fourteenth review of #1272). One that does not verify is not
  // named: the sentence says what is true and stops.
  for (const d of diagnostics) {
    const named = SHIFT_EDIT.exec(d.message) ?? VALUE_EDIT.exec(d.message);
    if (d.category !== 'error' || named === null || d.start === undefined) continue;
    let current = d;
    const edit = named.groups!.edit!;
    const restate = (message: string): void => {
      const next = { ...current, message };
      const i = diagnostics.indexOf(current);
      if (i >= 0) diagnostics[i] = next;
      current = next;
    };
    const bare = (): void => restate(d.message.slice(0, named.index).trimEnd());
    const change: SourceChange | undefined =
      programFileOf(nodeAtOffset(sourceFile, d.start) ?? sourceFile) === 0
        ? { start: d.start, end: d.start + d.length, text: edit }
        : undefined;
    batch.push({
      node: nodeAtOffset(sourceFile, d.start) ?? sourceFile,
      build: () => ({
        diagnostic: () => current,
        sets: [change, change],
        conflict: false,
        name: () => undefined,
        generic: bare,
        bare,
      }),
    });
  }
  // The edits the refusals name must compile where the quotients stand, all at once (as the
  // edits of change 0134 must, Rule 5.1): `checkModuleEdits`, at most two compiles a module.
  if (check !== undefined && !checkingEdit && batch.length > 0) {
    const cx: FlowContext = {
      sourceFile,
      refused: new Set(batch.map((b) => b.node)),
      tainted: new Map(),
      reached: [],
    };
    // A refusal of another file of the program is checked in its own file, which owns it
    // (#1186): its edits are never named from the importer (F5 of the fourteenth review).
    const own = batch.filter((b) => programFileOf(b.node) === 0);
    const items = own.map((b) => b.build(cx));
    checkModuleEdits(sourceFile, diagnostics, items, cx.reached, check);
  }
}

type Scalar = 'f32' | 'i32' | 'u32';

/** The edit a refused `>>` over a written `u32` names, and the edits of the value forms. */
const SHIFT_EDIT = / Write "(?<edit>u32\([^"]*\) >> [^"]*)" for the u32 shift\.$/;
const VALUE_EDIT =
  / Write the (?:u32|i32) with the same bits, (?<edit>0x[0-9a-f]+|-?\d+)(?:, or declare a u32)?\.$/;

/** The innermost node of `sourceFile` that starts at `offset`. */
function nodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | undefined {
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

/** The scalar a written type names (`u32`, or the component of `vec3u`), if it names one. */
function scalarOfTypeText(text: string): Scalar | undefined {
  const t = text.replace(/\s+/g, '');
  if (t === 'f32' || t === 'i32' || t === 'u32') return t;
  const m = /^vec[234]([fiu])$|^vec[234]<([fiu])32>$/.exec(t);
  if (m !== null) return `${(m[1] ?? m[2])!}32` as Scalar;
  if (/^vec[234]$/.test(t)) return 'f32';
  return undefined;
}

/** The type the author wrote on `decl`, not one the editor's projection wrote. */
function writtenTypeText(
  decl: { readonly type?: ts.TypeNode; readonly name: ts.Node },
  sourceFile: ts.SourceFile,
): string | undefined {
  return hasNoWrittenType(decl, sourceFile) ? undefined : decl.type!.getText(sourceFile);
}

/** The result type the author wrote on `fn`, not one the editor's projection wrote. */
function writtenResultText(
  fn: ts.SignatureDeclaration,
  sourceFile: ts.SourceFile,
): string | undefined {
  return hasNoWrittenResult(fn, sourceFile) ? undefined : fn.type!.getText(sourceFile);
}

/** The scalar of a lowered type: a scalar's, or a vector's component's. */
function scalarOfType(t: ShaderType | undefined): Scalar | undefined {
  if (t === undefined) return undefined;
  const s = t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined;
  return s === 'f32' || s === 'i32' || s === 'u32' ? s : undefined;
}

/** The declaration in scope at `at` that binds `name`: a parameter or a variable declared
 *  before it in an enclosing block. */
function declarationOf(
  name: string,
  at: ts.Node,
): ts.ParameterDeclaration | ts.VariableDeclaration | undefined {
  for (let n: ts.Node | undefined = at.parent; n !== undefined; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      for (const p of n.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === name) return p;
      }
    }
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      for (const st of n.statements) {
        if (st.pos >= at.pos) break;
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name) return d;
        }
      }
    }
  }
  return undefined;
}

/** The function declared in `sourceFile` under `name`. */
function functionNamed(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  for (const st of sourceFile.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
  }
  return undefined;
}

/** The scalar every field or property named `name` in `sourceFile` declares, if they agree. */
function propertyScalar(sourceFile: ts.SourceFile, name: string): Scalar | undefined {
  let found: Scalar | undefined;
  for (const id of identifiersNamed(sourceFile, name)) {
    const d = id.parent;
    if (!(ts.isPropertyDeclaration(d) || ts.isPropertySignature(d)) || d.name !== id) continue;
    const written = writtenTypeText(d, sourceFile);
    const s = written === undefined ? undefined : scalarOfTypeText(written);
    if (s === undefined || (found !== undefined && found !== s)) return undefined;
    found = s;
  }
  return found;
}

const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
]);

const SHIFTS = new Set([
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
]);

const identifiersOf = new WeakMap<ts.SourceFile, Map<string, ts.Identifier[]>>();

/** The identifiers of `sourceFile` spelled `name`, found in one walk of the file. */
function identifiersNamed(sourceFile: ts.SourceFile, name: string): readonly ts.Identifier[] {
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

/** What a walk of the places quotients flow to shares: the refused quotients, whose own lowered
 *  type is the refusal's and says nothing of a peer, and what the walk has followed. */
interface FlowContext {
  readonly sourceFile: ts.SourceFile;
  /** The refused `/` of every refusal of the module. */
  readonly refused: ReadonlySet<ts.Node>;
  /** Whether each declaration holds a refused quotient, directly or through another name. */
  readonly tainted: Map<ts.Node, boolean>;
  /** Each place a quotient reaches, so an error there is the edits'. */
  readonly reached: ts.Node[];
}

/** Whether `e` holds a refused quotient, or reads a name that does. */
function holdsRefused(e: ts.Node, cx: FlowContext): boolean {
  let found = false;
  const visit = (k: ts.Node): void => {
    if (found) return;
    if (cx.refused.has(k)) {
      found = true;
      return;
    }
    if (ts.isIdentifier(k)) {
      const d = declarationOf(k.text, k);
      if (
        d !== undefined &&
        ts.isVariableDeclaration(d) &&
        writtenTypeText(d, cx.sourceFile) === undefined &&
        d.initializer !== undefined
      ) {
        let t = cx.tainted.get(d);
        if (t === undefined) {
          cx.tainted.set(d, false);
          t = holdsRefused(d.initializer, cx);
          cx.tainted.set(d, t);
        }
        if (t) found = true;
      }
      return;
    }
    ts.forEachChild(k, visit);
  };
  visit(e);
  return found;
}

/** The scalar type of `e`, a peer of a quotient or the target it is stored in: the type the
 *  lowering gave it, or what is written (a declared name, a conversion, a vector constructor, a
 *  field's declared type, a float literal). `undefined` where `e` holds a refused quotient. */
function peerScalar(e: ts.Expression, cx: FlowContext, depth = 0): Scalar | undefined {
  if (depth > 64) return undefined;
  if (ts.isParenthesizedExpression(e)) return peerScalar(e.expression, cx, depth + 1);
  if (ts.isNumericLiteral(e)) return /[.eE]/.test(e.text) ? 'f32' : undefined;
  if (ts.isIdentifier(e)) {
    const d = declarationOf(e.text, e);
    const written = d === undefined ? undefined : writtenTypeText(d, cx.sourceFile);
    if (written !== undefined) return scalarOfTypeText(written);
  }
  if (holdsRefused(e, cx)) return undefined;
  const lowered = scalarOfType(loweredTypeOf(cx.sourceFile, e));
  if (lowered !== undefined) return lowered;
  if (ts.isIdentifier(e)) {
    const d = declarationOf(e.text, e);
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      return peerScalar(d.initializer, cx, depth + 1);
    }
    return undefined;
  }
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
    const callee = e.expression.text;
    const own = scalarOfTypeText(callee);
    if (own !== undefined) return own;
    const f = functionNamed(cx.sourceFile, callee);
    const result = f === undefined ? undefined : writtenResultText(f, cx.sourceFile);
    return result === undefined ? undefined : scalarOfTypeText(result);
  }
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
    return scalarOfTypeText(e.expression.text);
  }
  if (ts.isPropertyAccessExpression(e)) {
    if (/^[xyzwrgba]{1,4}$/.test(e.name.text)) return peerScalar(e.expression, cx, depth + 1);
    return propertyScalar(cx.sourceFile, e.name.text);
  }
  if (ts.isElementAccessExpression(e)) return peerScalar(e.expression, cx, depth + 1);
  if (ts.isPrefixUnaryExpression(e)) return peerScalar(e.operand, cx, depth + 1);
  if (
    ts.isBinaryExpression(e) &&
    (ARITHMETIC.has(e.operatorToken.kind) || BITWISE.has(e.operatorToken.kind))
  ) {
    return peerScalar(e.left, cx, depth + 1) ?? peerScalar(e.right, cx, depth + 1);
  }
  return undefined;
}

/** What the positions a quotient flows to ask: scalar types, an integer of either type
 *  (`int`), or a place the walk cannot follow (`opaque`). */
type Asked = Scalar | 'int' | 'opaque';

/**
 * The scalar types of the positions the value of `e` flows to, read from the structure of its
 * use (Rule 5.1's places): a declared `let`, a parameter, a result, a vector constructor, a
 * typed peer of an operator or of a builtin, the target of an assignment, an index. A `let` with
 * no type passes on what its reads ask; a bit operator asks an integer and passes on what its
 * result's place asks; a function with no result type passes on what its callers ask. Each
 * place is followed once, so the walk is linear in the module.
 */
function flowScalars(
  e: ts.Expression,
  cx: FlowContext,
  out: Set<Asked>,
  seen: Set<ts.Node>,
  depth = 0,
): void {
  if (depth > 256) return void out.add('opaque');
  let n: ts.Expression = e;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  cx.reached.push(p);
  const add = (s: Asked | undefined) => {
    if (s !== undefined) out.add(s);
  };
  const on = (next: ts.Expression) => flowScalars(next, cx, out, seen, depth + 1);
  if (ts.isVariableDeclaration(p) && p.initializer === n) {
    const declared = writtenTypeText(p, cx.sourceFile);
    if (declared !== undefined) return add(scalarOfTypeText(declared));
    if (!ts.isIdentifier(p.name) || seen.has(p)) return;
    seen.add(p);
    // An exported constant keeps the `f32` its importers read (Amendment A5), as an exported
    // function's result does: no edit changes it (F5 of the fourteenth review of #1272).
    if (exportedConstant(p)) return add('f32');
    const name = p.name.text;
    for (const k of identifiersNamed(cx.sourceFile, name)) {
      if (k.pos < p.end) continue;
      const parent = k.parent;
      const named =
        (ts.isPropertyAccessExpression(parent) && parent.name === k) ||
        (ts.isVariableDeclaration(parent) && parent.name === k) ||
        ts.isParameter(parent) ||
        (ts.isPropertyAssignment(parent) && parent.name === k);
      if (!named && declarationOf(name, k) === p) on(k);
    }
    return;
  }
  if (ts.isReturnStatement(p)) {
    let f: ts.Node = p;
    while (!ts.isFunctionLike(f) && f.parent !== undefined) f = f.parent;
    if (!ts.isFunctionLike(f)) return add('opaque');
    const result = writtenResultText(f, cx.sourceFile);
    if (result !== undefined) return add(scalarOfTypeText(result));
    // A generic function's result is read differently by the editor (its own issue): no edit
    // is proven there.
    if (f.typeParameters !== undefined && f.typeParameters.length > 0) return add('opaque');
    // An exported function keeps the `f32` result the host reads (Amendment A5 of change 0134,
    // "export는 f32 유지"): the quotient is decided there, and no edit changes that result.
    if (exportedFunction(f, cx.sourceFile)) return add('f32');
    // A function with no result type: its value flows where its callers put it.
    if (!ts.isFunctionDeclaration(f) || f.name === undefined) return add('opaque');
    if (seen.has(f)) return;
    seen.add(f);
    for (const id of identifiersNamed(cx.sourceFile, f.name.text)) {
      if (!ts.isCallExpression(id.parent) || id.parent.expression !== id) continue;
      // A call from another file of a linked program reaches the function through its export,
      // whose result is the `f32` the host reads (Amendment A5).
      if (programFileOf(id) !== programFileOf(f)) add('f32');
      else on(id.parent);
    }
    return;
  }
  if (ts.isArrowFunction(p) && p.body === n) return add('opaque');
  if (ts.isCallExpression(p) && p.expression !== n && ts.isIdentifier(p.expression)) {
    const callee = p.expression.text;
    const index = p.arguments.indexOf(n);
    if (callee === 'f32' || callee === 'i32' || callee === 'u32') return;
    const vector = scalarOfTypeText(callee);
    if (vector !== undefined) return add(vector);
    const f = functionNamed(cx.sourceFile, callee);
    if (f !== undefined) {
      const param = f.parameters[index];
      const declared = param === undefined ? undefined : writtenTypeText(param, cx.sourceFile);
      // A parameter of a type no scalar names (a generic `T`) cannot be followed.
      return add((declared !== undefined ? scalarOfTypeText(declared) : undefined) ?? 'opaque');
    }
    if (callee === 'select' && index === 2) return;
    // A builtin: its typed arguments (of `select`, the other arm), and where its result flows.
    const peers = callee === 'select' ? p.arguments.slice(0, 2) : p.arguments;
    for (const a of peers) if (a !== n) add(peerScalar(a, cx));
    return on(p);
  }
  if (ts.isBinaryExpression(p)) {
    const op = p.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsToken ||
      (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment)
    ) {
      if (p.right === n) add(peerScalar(p.left, cx));
      return;
    }
    const other = p.left === n ? p.right : p.left;
    const peer = peerScalar(other, cx);
    if (BITWISE.has(op)) {
      // A shift amount is an integer of either type; any other operand of a bit operator is an
      // integer of its peer's type, and the result flows on.
      if (SHIFTS.has(op) && p.right === n) return add('int');
      add(peer ?? 'int');
      return on(p);
    }
    if (peer !== undefined) return add(peer);
    if (ARITHMETIC.has(op)) return on(p);
    return;
  }
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return add('int');
  // A field of an object literal takes the type every field of that name declares (`{ id: q }`
  // for `interface Q { id: u32 }`).
  if (ts.isPropertyAssignment(p) && p.initializer === n && ts.isIdentifier(p.name)) {
    return add(propertyScalar(cx.sourceFile, p.name.text) ?? 'opaque');
  }
  if (ts.isPrefixUnaryExpression(p)) {
    if (p.operator === ts.SyntaxKind.TildeToken) add('int');
    return on(p);
  }
  if (ts.isConditionalExpression(p) && p.condition !== n) {
    // The other arm is a peer, as `select`'s is.
    add(peerScalar(p.whenTrue === n ? p.whenFalse : p.whenTrue, cx));
    return on(p);
  }
}

/** Whether the file exports `f`: with `export` on it, or by name in an `export { … }` list,
 *  under its own name or another (`export { g as h }`), before or after it is declared. */
/** Whether `d` is a module constant a host or another file imports: one declared `export`, or
 *  one of another file of a linked program (only an export is reached from there). */
export function exportedConstant(d: ts.VariableDeclaration): boolean {
  const statement = d.parent.parent;
  if (!ts.isVariableStatement(statement) || !ts.isSourceFile(statement.parent)) return false;
  return (
    statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true ||
    programFileOf(d) !== 0 ||
    (ts.isIdentifier(d.name) && exportedInProgram.get(statement.parent)?.has(d.name.text) === true)
  );
}

/** The exported constants of a linked program, by name, for an edited copy of its source that
 *  is compiled on its own (the check of a module's edits): the copy has no file boundaries. */
const exportedInProgram = new WeakMap<ts.SourceFile, ReadonlySet<string>>();

/** The names of `sourceFile`'s module constants that {@link exportedConstant} counts. */
export function exportedConstantNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const out = new Set<string>();
  for (const st of sourceFile.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && exportedConstant(d)) out.add(d.name.text);
    }
  }
  return out;
}

/** Marks `names` as exported constants of `edited`, an edited copy of a linked program. */
export function markExportedConstants(edited: ts.SourceFile, names: ReadonlySet<string>): void {
  if (names.size > 0) exportedInProgram.set(edited, names);
}

function exportedFunction(f: ts.SignatureDeclaration, sourceFile: ts.SourceFile): boolean {
  if (ts.getCombinedModifierFlags(f as ts.Declaration) & ts.ModifierFlags.Export) return true;
  if (!ts.isFunctionDeclaration(f) || f.name === undefined) return false;
  const name = f.name.text;
  for (const st of sourceFile.statements) {
    if (!ts.isExportDeclaration(st) || st.moduleSpecifier !== undefined) continue;
    const clause = st.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const spec of clause.elements) {
      if ((spec.propertyName ?? spec.name).getText(sourceFile) === name) return true;
    }
  }
  return false;
}

/** The one type a quotient's edit takes from what its positions ask, and the type of the second
 *  set; `conflict` where no type serves every position. */
function typesFromUse(
  node: ts.Node,
  peer: Scalar | undefined,
  cx: FlowContext,
): { first: Scalar; second: Scalar; conflict: boolean; allowed: readonly Scalar[] } {
  if (peer !== undefined) {
    cx.reached.push(node);
    return { first: peer, second: peer, conflict: false, allowed: [peer] };
  }
  const asked = new Set<Asked>();
  flowScalars(node as ts.Expression, cx, asked, new Set());
  const types = [...asked].filter((t): t is Scalar => t !== 'int' && t !== 'opaque');
  const integer = asked.has('int');
  // A place the walk cannot follow, two types, or an integer beside an `f32`: no edit is proven.
  const conflict = asked.has('opaque') || types.length > 1 || (types[0] === 'f32' && integer);
  const first: Scalar = types[0] ?? (integer ? 'i32' : 'f32');
  // The other set: `u32` where an integer of either type is asked, `i32` where nothing decides.
  const second: Scalar =
    types.length > 0 ? first : integer ? 'u32' : asked.size === 0 ? 'i32' : first;
  // The types the positions themselves take, for a remedy that names no edit.
  const allowed: Scalar[] =
    asked.has('opaque') || asked.size === 0
      ? [...ALL_SCALARS]
      : ALL_SCALARS.filter((t) => types.includes(t) || (integer && t !== 'f32'));
  return { first, second, conflict, allowed };
}

const ALL_SCALARS: readonly Scalar[] = ['i32', 'u32', 'f32'];

/** One change to the source: `[start, end)` replaced by `text`. */
interface SourceChange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** One refusal in the module's check: the change each of the two sets makes (`undefined`: the
 *  refusal names no edit that can be checked), and how it names a set's edit or none. */
interface BatchItem {
  readonly diagnostic: () => TsCompilerDiagnostic | undefined;
  readonly sets: readonly [SourceChange | undefined, SourceChange | undefined];
  readonly conflict: boolean;
  readonly name: (set: 0 | 1) => void;
  readonly generic: () => void;
  /** States the refusal with no remedy: what is true of it, where no wrap verifies in a module
   *  with this one refusal (the fourteenth review of #1272, F4). Absent: `generic` is said. */
  readonly bare?: () => void;
}

/**
 * Checks the edits every refused `/` of the module names (the trees of written integers, the
 * bindings that hold one and the constants of no fixed type): the owner's decision of
 * 2026-11-12, "name only verified edits". Each refusal's edit takes its type from where the
 * quotient flows ({@link typesFromUse}). Every edit is made at once and the program compiled
 * once; the edits are named when that adds no error the unedited program does not give at the
 * same place, and no type error where a quotient flows. Else one more set is compiled, where
 * a refusal that only an integer of either type decides takes `u32` and one nothing decides
 * takes `i32`. Where that adds an error too, or where a refusal's positions ask two types or
 * cannot be followed, no refusal of the module names an edit: each says what to write around
 * which operand. At most two edited programs are compiled a module.
 */
function checkModuleEdits(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  items: readonly BatchItem[],
  reached: readonly ts.Node[],
  check: DivisionEditCheck,
): void {
  if (items.length === 0) return;
  // A module with one refusal whose positions ask one type names no wrap it has not verified:
  // the text names no edit only where refusals conflict (D4 of 2026-11-12).
  const unverified = (it: BatchItem): void =>
    items.length === 1 && !it.conflict && it.bare !== undefined ? it.bare() : it.generic();
  if (items.some((it) => it.conflict || it.sets[0] === undefined)) {
    for (const it of items) unverified(it);
    return;
  }
  const own = new Set(items.map((it) => it.diagnostic()));
  const keyOf = (at: number | undefined, e: { code?: string; message: string }) =>
    `${String(at ?? -1)}|${lineOf(e)}`;
  // The unedited program's errors, by place and text, counted: an equal error elsewhere does not
  // hide an added one.
  const original = new Map<string, number>();
  for (const d of diagnostics) {
    if (d.category !== 'error' || own.has(d)) continue;
    const k = keyOf(d.start, d);
    original.set(k, (original.get(k) ?? 0) + 1);
  }
  // A type error the edited program gives where a quotient flows is the edits' even where the
  // unedited program gives it too (`let z = q * r; let j: i32 = z`).
  const regions = reached.map((n) => regionOf(n, sourceFile));
  const clean = (set: 0 | 1): boolean => {
    const changes = new Map<string, SourceChange>();
    for (const it of items) {
      const c = it.sets[set];
      if (c === undefined) return false;
      changes.set(`${String(c.start)}:${String(c.end)}:${c.text}`, c);
    }
    const sorted = [...changes.values()].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start < sorted[i - 1]!.end) return false;
    }
    const left = new Map(original);
    return compileEditedAll(sourceFile, sorted, check).every((e) => {
      const typed = e.code === TS_CODES.TYPE_MISMATCH || e.code === TS_CODES.MATH_ARGUMENT;
      if (typed && e.at !== undefined && regions.some(([a, b]) => e.at! >= a && e.at! < b)) {
        return false;
      }
      const k = keyOf(e.at, e);
      const count = left.get(k) ?? 0;
      if (count === 0) return false;
      left.set(k, count - 1);
      return true;
    });
  };
  const same = (c: SourceChange | undefined, d: SourceChange | undefined) =>
    c !== undefined &&
    d !== undefined &&
    c.start === d.start &&
    c.end === d.end &&
    c.text === d.text;
  const differs = items.some((it) => !same(it.sets[0], it.sets[1]));
  const named: 0 | 1 | undefined = clean(0) ? 0 : differs && clean(1) ? 1 : undefined;
  for (const it of items) {
    if (named === undefined) unverified(it);
    else it.name(named);
  }
  if (named === undefined) return;
  // The refusals as they now stand (naming an edit replaced some) stay.
  for (const it of items) {
    const d = it.diagnostic();
    if (d !== undefined) own.add(d);
  }
  // The edited program gives no type error where a quotient flows: such an error of the
  // unedited program (`let k: u32 = g()` beside `function g() { return (1 | 2) / 2; }`) is the
  // refusal said again (Rule 12.4).
  for (let i = diagnostics.length - 1; i >= 0; i--) {
    const d = diagnostics[i]!;
    if (own.has(d) || d.category !== 'error' || d.message.includes(NO_DIVISION)) continue;
    if (d.code !== TS_CODES.TYPE_MISMATCH && d.code !== TS_CODES.MATH_ARGUMENT) continue;
    if (regions.some(([a, b]) => d.start >= a && d.start < b)) diagnostics.splice(i, 1);
  }
}

/** The operands to wrap, as a remedy lists them: `"k"`, or `each of "a" and "b"`. */
function wrapList(subjects: readonly string[]): string {
  const quoted = [...new Set(subjects)].map((s) => `"${s}"`);
  if (quoted.length <= 1) return quoted[0] ?? 'an operand';
  return `each of ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]!}`;
}

/** The sentence of a refusal whose wraps would not choose the division (the owner's decision
 *  of 2026-11-13, "그 경우 감싸기 안 제시"): what is true, and no wrap. */
export const NO_WRAP_REMEDY = "Declare the type of the division's operands to choose it.";

/** The value of `node` where it is written numbers, constants with no written type that hold
 *  them, and operators over those, as TypeScript computes it. */
function constNumber(node: ts.Expression, depth = 0): number | undefined {
  const n = skipParenNodes(node);
  if (depth > 32) return undefined;
  const v = writtenNumber(n);
  if (v !== undefined) return v;
  if (ts.isIdentifier(n)) {
    const d = untypedConstant(n);
    return d?.initializer === undefined ? undefined : constNumber(d.initializer, depth + 1);
  }
  if (ts.isPrefixUnaryExpression(n)) {
    const x = constNumber(n.operand, depth + 1);
    if (x === undefined) return undefined;
    return n.operator === ts.SyntaxKind.MinusToken
      ? -x
      : n.operator === ts.SyntaxKind.TildeToken
        ? ~x
        : undefined;
  }
  if (!ts.isBinaryExpression(n)) return undefined;
  const a = constNumber(n.left, depth + 1);
  const b = constNumber(n.right, depth + 1);
  if (a === undefined || b === undefined) return undefined;
  switch (n.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      return a + b;
    case ts.SyntaxKind.MinusToken:
      return a - b;
    case ts.SyntaxKind.AsteriskToken:
      return a * b;
    case ts.SyntaxKind.BarToken:
      return a | b;
    case ts.SyntaxKind.AmpersandToken:
      return a & b;
    case ts.SyntaxKind.CaretToken:
      return a ^ b;
    case ts.SyntaxKind.LessThanLessThanToken:
      return a << (b & 31);
    case ts.SyntaxKind.GreaterThanGreaterThanToken:
      return a >> (b & 31);
    default:
      return undefined;
  }
}

/** Whether `node` holds a tree of written integers, or a value that is an integer only by a bit
 *  operator ({@link kindlessSource}). */
function containsTree(node: ts.Node): boolean {
  if (ts.isExpression(node) && (writtenBitTree(node) || kindlessSource(node))) return true;
  return ts.forEachChild(node, (c) => (containsTree(c) ? true : undefined)) === true;
}

/**
 * Whether a wrap the generic remedy of the `/` at `node` would offer cannot choose the division,
 * by a form the structure shows (the owner's decision of 2026-11-13, "그 경우 감싸기 안 제시"):
 * a `u32(…)` wrap whose quotient a unary minus reads; an `f32(…)` wrap whose quotient a bit
 * operator reads; an integer wrap of a divisor whose integer quotient is 0; and, for the sentence
 * of a constant (`constant`), a tree elsewhere in the division, which wrapping the constant leaves
 * undecided. A `?:` with one typed arm is no such form: wrapping the other operand chooses the
 * division (E2 of 2026-11-13). The check compiles nothing: the
 * module's two edited compiles stay its bound.
 */
export function wrapsCannotChoose(
  at: ts.Expression,
  allowed: readonly string[],
  constant = false,
): boolean {
  const offers = (t: string) => allowed.some((a) => a === t || (t === 'f32' && a === 'f32(i32'));
  // The refusal may stand on a minus around the `/` (`-((~(1|2)) / 7)`).
  let node: ts.Expression = at;
  while (
    ts.isParenthesizedExpression(node) ||
    (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken)
  ) {
    if (ts.isPrefixUnaryExpression(node)) {
      if (offers('u32')) return true;
      node = node.operand;
    } else node = node.expression;
  }
  if (!ts.isBinaryExpression(node)) return false;
  const outward = (n: ts.Node): ts.Node => {
    let u = n;
    while (ts.isParenthesizedExpression(u.parent)) u = u.parent;
    return u;
  };
  let use = outward(at);
  let p = use.parent;
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.MinusToken) {
    if (offers('u32')) return true;
    use = outward(p);
    p = use.parent;
  }
  const bits = [
    ts.SyntaxKind.BarToken,
    ts.SyntaxKind.AmpersandToken,
    ts.SyntaxKind.CaretToken,
    ts.SyntaxKind.LessThanLessThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
  ];
  if (
    offers('f32') &&
    ((ts.isBinaryExpression(p) && bits.includes(p.operatorToken.kind)) ||
      (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.TildeToken))
  ) {
    return true;
  }
  if (
    (offers('i32') || offers('u32')) &&
    ts.isBinaryExpression(p) &&
    p.right === use &&
    [
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
      ts.SyntaxKind.SlashEqualsToken,
      ts.SyntaxKind.PercentEqualsToken,
    ].includes(p.operatorToken.kind)
  ) {
    const a = constNumber(node.left);
    const b = constNumber(node.right);
    if (a !== undefined && b !== undefined && b !== 0 && Math.trunc(a / b) === 0) return true;
  }
  return constant && containsTree(node);
}

/** The remedy of a refusal that names no edit: what to write around which operands, or, where
 *  the structure shows that a wrap would not choose the division ({@link wrapsCannotChoose}),
 *  what is true and no wrap. */
export function genericDivisionRemedy(
  subjects: readonly string[],
  allowed: readonly string[] = ALL_SCALARS,
  division?: { readonly node: ts.Expression; readonly constant?: boolean },
): string {
  if (division !== undefined && wrapsCannotChoose(division.node, allowed, division.constant)) {
    return NO_WRAP_REMEDY;
  }
  const forms = allowed.map((t) => (t === 'f32(i32' ? 'f32(i32(…))' : `${t}(…)`));
  const list =
    forms.length <= 1 ? (forms[0] ?? '') : `${forms.slice(0, -1).join(', ')} or ${forms.at(-1)!}`;
  return `Write ${list} around ${wrapList(subjects)} to choose the division.`;
}

/** The change that declares the variable `name`, read at `at`, with `type`; `undefined` where
 *  its declaration is not a `let` or `const` of this file. */
function declarationChange(name: string, at: ts.Node, type: string): SourceChange | undefined {
  let d: ts.VariableDeclaration | ts.PropertyDeclaration | undefined;
  const local = declarationOf(name, at);
  if (local !== undefined && ts.isVariableDeclaration(local)) d = local;
  else if (local === undefined) {
    // A field of a class (`this.n /= 2`, `S.n /= 2`): the one field of that name in the file.
    const fields = identifiersNamed(at.getSourceFile(), name)
      .map((id) => id.parent)
      .filter(
        (p): p is ts.PropertyDeclaration =>
          ts.isPropertyDeclaration(p) &&
          p.name.kind === ts.SyntaxKind.Identifier &&
          (p.name as ts.Identifier).text === name,
      );
    if (fields.length === 1) d = fields[0];
  }
  if (d === undefined) return undefined;
  return { start: d.name.getEnd(), end: d.type?.getEnd() ?? d.name.getEnd(), text: `: ${type}` };
}

/** The statement, member or declaration that holds `node`. */
function regionOf(node: ts.Node, sourceFile: ts.SourceFile): readonly [number, number] {
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

/** A diagnostic as one comparable line. */
function lineOf(d: { readonly code?: string; readonly message: string }): string {
  return `${d.code ?? ''}: ${d.message}`;
}

let editCompiles = 0;

/** Whether the program being compiled is an edited copy that a checked edit compiles. Such a
 *  compile is read for its type errors alone, so the passes an edit's type cannot change (the
 *  uniformity walk, the kernel-loop proof) are skipped in it. */
export function compilingCheckedEdit(): boolean {
  return checkingEdit;
}

/** How many edited programs the checked edits have compiled in this process (for tests that
 *  bound the cost of the check). */
export function checkedEditCompiles(): number {
  return editCompiles;
}

/** The errors of `sourceFile`'s text with `changes` made, each with its offset in the original
 *  text (the change's own offset inside a change). In the editor the projection's insertions
 *  are taken out first, so the author's text is compiled, with the edits made, as `compile()`
 *  reads it; an insertion a change replaces goes with it. */
function compileEditedAll(
  sourceFile: ts.SourceFile,
  changes: readonly { readonly start: number; readonly end: number; readonly text: string }[],
  check: DivisionEditCheck,
): { readonly code?: string; readonly message: string; readonly at: number | undefined }[] {
  const edits = changes.map((c) => ({ start: c.start, end: c.end, text: c.text }));
  for (const { at, length } of projectedSpans.get(sourceFile) ?? []) {
    if (changes.every((c) => at + length <= c.start || at >= c.end)) {
      edits.push({ start: at, end: at + length, text: '' });
    }
  }
  edits.sort((a, b) => a.start - b.start);
  let text = '';
  let from = 0;
  // Each piece of the edited text, with the original offset it starts at.
  const pieces: { at: number; original: number; length: number; inside?: boolean }[] = [];
  for (const e of edits) {
    pieces.push({ at: text.length, original: from, length: e.start - from });
    text += sourceFile.text.slice(from, e.start);
    // An error inside a change stands where the change does.
    pieces.push({ at: text.length, original: e.start, length: e.text.length, inside: true });
    text += e.text;
    from = e.end;
  }
  pieces.push({ at: text.length, original: from, length: sourceFile.text.length - from });
  text += sourceFile.text.slice(from);
  const back = (offset: number | undefined): number | undefined => {
    if (offset === undefined) return undefined;
    for (const p of pieces) {
      if (offset >= p.at && offset < p.at + Math.max(p.length, 1)) {
        return p.inside === true ? p.original : p.original + (offset - p.at);
      }
    }
    return undefined;
  };
  const key = `${sourceFile.fileName}\n${text}`;
  let errors = editedErrors.get(key);
  if (errors === undefined) {
    checkingEdit = true;
    editCompiles++;
    try {
      errors = check(text, undefined);
    } finally {
      checkingEdit = false;
    }
    editedErrors.set(key, errors);
    // A few recent programs: the editor checks the same edits again in its next pass.
    if (editedErrors.size > 16) editedErrors.delete(editedErrors.keys().next().value!);
  }
  return errors.map((d) => ({
    ...(d.code !== undefined ? { code: d.code } : {}),
    message: d.message,
    at: back(d.start),
  }));
}

/** The errors of each edited program compiled lately, by its file and text: the compile is a
 *  function of the text, and the editor checks one module's edits on each of its passes. */
const editedErrors = new Map<string, ReturnType<DivisionEditCheck>>();

/** The two values of `node` where a tree's `u32` bits and its TypeScript value reach it and
 *  give different values (the owner's decision of 2026-11-12, D2), read from the source: a tree
 *  over a written number only a `u32` holds, and what carries one without a declared type
 *  through a `let`, a module `let` or `const`, a function's result, `?:`, `select`, and
 *  arithmetic over it and written numbers (`let c = a + 0`). An annotation, a conversion and a
 *  typed operand end it. `undefined` where the two agree. */
export function twoReadingsOf(
  node: ts.Expression,
  seen: Set<ts.Node> = new Set(),
): { readonly u32: number; readonly ts: number } | undefined {
  const sourceFile = node.getSourceFile();
  const n = skipParenNodes(node);
  if (seen.has(n) || seen.size > 64) return undefined;
  seen.add(n);
  const pair = readingPair(n, sourceFile, seen);
  return pair !== undefined && pair.u32 !== pair.ts ? pair : undefined;
}

/** The two readings a plain assignment `a = rhs` gives its target: those of `rhs`, or of a
 *  part that `+ - * & | ^ <<`, a minus, a `~`, `?:` or `select` carry (`a = a + T`). The
 *  fourteenth review of #1272, F2: the two readings were lost through a reassignment. */
export function assignedReadings(
  node: ts.Expression,
  depth = 0,
): { readonly u32: number; readonly ts: number } | undefined {
  const direct = twoReadingsOf(node);
  if (direct !== undefined || depth > 16) return direct;
  const n = skipParenNodes(node);
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    const carries =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.BarToken ||
      k === ts.SyntaxKind.AmpersandToken ||
      k === ts.SyntaxKind.CaretToken ||
      k === ts.SyntaxKind.LessThanLessThanToken;
    return carries
      ? (assignedReadings(n.left, depth + 1) ?? assignedReadings(n.right, depth + 1))
      : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(n) &&
    (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.TildeToken)
  ) {
    return assignedReadings(n.operand, depth + 1);
  }
  if (ts.isConditionalExpression(n)) {
    return assignedReadings(n.whenTrue, depth + 1) ?? assignedReadings(n.whenFalse, depth + 1);
  }
  if (
    ts.isCallExpression(n) &&
    ts.isIdentifier(n.expression) &&
    n.expression.text === 'select' &&
    n.arguments.length === 3
  ) {
    return (
      assignedReadings(n.arguments[0]!, depth + 1) ?? assignedReadings(n.arguments[1]!, depth + 1)
    );
  }
  return undefined;
}

/** The declaration of the constant `node` reads, where it is a `const` with no written type
 *  (`const K = 3000000000 | 0`, in a module, a function or another file). */
function untypedConstant(node: ts.Expression): ts.VariableDeclaration | undefined {
  const n = skipParenNodes(node);
  if (!ts.isIdentifier(n)) return undefined;
  const d = declarationOf(n.text, n);
  if (d === undefined || !ts.isVariableDeclaration(d)) return undefined;
  const list = d.parent;
  return ts.isVariableDeclarationList(list) &&
    (list.flags & ts.NodeFlags.Const) !== 0 &&
    writtenTypeText(d, n.getSourceFile()) === undefined
    ? d
    : undefined;
}

/** Whether the variable `id` names was declared with no written type (its uses decide it, or
 *  its initializer does): such a variable takes the two readings of what is stored in it. */
export function declaredWithoutType(id: ts.Identifier): boolean {
  const d = declarationOf(id.text, id);
  return (
    d !== undefined &&
    ts.isVariableDeclaration(d) &&
    writtenTypeText(d, id.getSourceFile()) === undefined
  );
}

/** The written number the variable `node` names was declared with, where it has no written type
 *  (`let M = 3000000000`). */
function namedNumber(node: ts.Expression): number | undefined {
  const n = skipParenNodes(node);
  if (!ts.isIdentifier(n)) return undefined;
  const d = declarationOf(n.text, n);
  if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) {
    return undefined;
  }
  return writtenTypeText(d, n.getSourceFile()) === undefined
    ? writtenNumber(d.initializer)
    : undefined;
}

function skipParenNodes(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? skipParenNodes(node.expression) : node;
}

/** The written number `node` is, where it is one. */
function writtenNumber(node: ts.Expression): number | undefined {
  const n = skipParenNodes(node);
  if (ts.isNumericLiteral(n)) return Number(n.text);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) {
    const v = writtenNumber(n.operand);
    return v === undefined ? undefined : -v;
  }
  return undefined;
}

/** Whether `node` states a type of its own: a typed name or a conversion. */
function typedNode(node: ts.Expression): boolean {
  const n = skipParenNodes(node);
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    return /^(i32|u32|f32|vec[234][iuf]?)$/.test(n.expression.text);
  }
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n.text, n);
    return d !== undefined && writtenTypeText(d, n.getSourceFile()) !== undefined;
  }
  return false;
}

/** Both values of `n` (`u32`: what the lowering computes from a tree's bits, `ts`:
 *  TypeScript's), or `undefined` where no tree with two readings reaches it. */
function readingPair(
  n: ts.Expression,
  sourceFile: ts.SourceFile,
  seen: Set<ts.Node>,
): { u32: number; ts: number } | undefined {
  const of = (e: ts.Expression) => {
    const inner = skipParenNodes(e);
    if (seen.has(inner)) return undefined;
    seen.add(inner);
    return readingPair(inner, sourceFile, seen);
  };
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    const bit =
      k === ts.SyntaxKind.BarToken ||
      k === ts.SyntaxKind.AmpersandToken ||
      k === ts.SyntaxKind.CaretToken ||
      k === ts.SyntaxKind.LessThanLessThanToken ||
      k === ts.SyntaxKind.GreaterThanGreaterThanToken;
    const arith =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken;
    if (!bit && !arith) return undefined;
    const lv = writtenNumber(n.left);
    const rv = writtenNumber(n.right);
    const lp = lv === undefined ? of(n.left) : undefined;
    const rp = rv === undefined ? of(n.right) : undefined;
    // The root of a tree over a written `u32`: its bits and ToInt32 of them. A variable with
    // no written type declared with such a number reads as it (`let M = 3000000000; M | 0`).
    const ln = lv ?? namedNumber(n.left);
    const rn = rv ?? namedNumber(n.right);
    const bigNumber = (v: number | undefined) =>
      v !== undefined && v > 2147483647 && v <= 4294967295;
    if (bit && (bigNumber(ln) || bigNumber(rn)) && ln !== undefined && rn !== undefined) {
      const [ua, ub] = [ln >>> 0, rn >>> 0];
      const u =
        k === ts.SyntaxKind.BarToken
          ? (ua | ub) >>> 0
          : k === ts.SyntaxKind.AmpersandToken
            ? (ua & ub) >>> 0
            : k === ts.SyntaxKind.CaretToken
              ? (ua ^ ub) >>> 0
              : k === ts.SyntaxKind.LessThanLessThanToken
                ? (ua << (ub & 31)) >>> 0
                : ua >>> (ub & 31);
      return { u32: u, ts: u | 0 };
    }
    // A tree of written numbers is one fold, which computes as TypeScript does (THE RULE): only
    // its root over a written `u32` (above) reads the bits.
    if (constantTree(n.left) && constantTree(n.right)) return undefined;
    // Arithmetic over a value with two readings and a written number, or a constant tree
    // (`(1 << 3) | LB`): the bits compute in u32, TypeScript in doubles.
    const numberPair = (e: ts.Expression, v: number | undefined) => {
      const x = v ?? constNumber(e);
      return x === undefined ? undefined : { u32: x, ts: x };
    };
    const a = lp ?? numberPair(n.left, lv);
    const b = rp ?? numberPair(n.right, rv);
    if ((lp === undefined && rp === undefined) || a === undefined || b === undefined)
      return undefined;
    const op = (x: number, y: number, unsigned: boolean): number => {
      switch (k) {
        case ts.SyntaxKind.PlusToken:
          return unsigned ? (x + y) >>> 0 : x + y;
        case ts.SyntaxKind.MinusToken:
          return unsigned ? (x - y) >>> 0 : x - y;
        case ts.SyntaxKind.AsteriskToken:
          return unsigned ? Math.imul(x, y) >>> 0 : x * y;
        case ts.SyntaxKind.BarToken:
          return unsigned ? (x | y) >>> 0 : x | y;
        case ts.SyntaxKind.AmpersandToken:
          return unsigned ? (x & y) >>> 0 : x & y;
        case ts.SyntaxKind.CaretToken:
          return unsigned ? (x ^ y) >>> 0 : x ^ y;
        case ts.SyntaxKind.LessThanLessThanToken:
          return unsigned ? (x << (y & 31)) >>> 0 : x << (y & 31);
        default:
          return unsigned ? x >>> (y & 31) : x >> (y & 31);
      }
    };
    return { u32: op(a.u32, b.u32, true), ts: op(a.ts, b.ts, false) };
  }
  if (ts.isPrefixUnaryExpression(n)) {
    const p = of(n.operand);
    if (p === undefined) return undefined;
    if (n.operator === ts.SyntaxKind.TildeToken) return { u32: ~p.u32 >>> 0, ts: ~p.ts };
    if (n.operator === ts.SyntaxKind.MinusToken) return { u32: -p.u32 >>> 0, ts: -p.ts };
    return undefined;
  }
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n.text, n);
    if (d === undefined || !ts.isVariableDeclaration(d)) return undefined;
    if (writtenTypeText(d, sourceFile) !== undefined) return undefined;
    // Every value stored in the variable, wherever it is stored (E1 of 2026-11-13: a module
    // `let` set in another function, a reassignment, a compound assignment).
    const own = d.initializer === undefined ? undefined : of(d.initializer);
    if (own !== undefined) return own;
    for (const id of identifiersNamed(sourceFile, n.text)) {
      if (id === d.name || declarationOf(n.text, id) !== d) continue;
      const p = skipParenUp(id).parent;
      if (!ts.isBinaryExpression(p) || p.left !== skipParenUp(id)) continue;
      const k = p.operatorToken.kind;
      if (k === ts.SyntaxKind.EqualsToken) {
        const v = of(p.right);
        if (v !== undefined) return v;
        continue;
      }
      const base = COMPOUND_BASE.get(k);
      if (base === undefined || seen.has(p)) continue;
      seen.add(p);
      const v = binaryPair(id, base, p.right, sourceFile, seen);
      if (v !== undefined && v.u32 !== v.ts) return v;
    }
    return undefined;
  }
  if (ts.isConditionalExpression(n)) {
    // An arm beside a typed `i32` takes TypeScript's value.
    if (typedNode(n.whenTrue) || typedNode(n.whenFalse)) {
      const other = typedNode(n.whenTrue) ? n.whenFalse : n.whenTrue;
      const typed = typedNode(n.whenTrue) ? n.whenTrue : n.whenFalse;
      if (/^i32\(|^ii$/.test(skipParenNodes(typed).getText(sourceFile))) return undefined;
      return of(other);
    }
    return of(n.whenTrue) ?? of(n.whenFalse);
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    const callee = n.expression.text;
    if (callee === 'select' && n.arguments.length === 3) {
      return of(n.arguments[0]!) ?? of(n.arguments[1]!);
    }
    const f = calleeAt(callee, n);
    if (f === undefined || f.body === undefined) return undefined;
    // A generic result carries the readings of what is passed to it (E1 of 2026-11-13: through
    // `let b = a`, another generic, `?:`, `min`, `select`).
    const result = writtenResultText(f, sourceFile);
    if (result !== undefined && (f.typeParameters ?? []).some((t) => t.name.text === result)) {
      for (const arg of n.arguments) {
        const v = of(arg);
        if (v !== undefined) return v;
      }
      return undefined;
    }
    if (result !== undefined) return undefined;
    // Every return of a function with no written result (mixed returns), an arrow's body.
    if (!ts.isBlock(f.body)) return of(f.body);
    const returns: ts.Expression[] = [];
    const walk = (x: ts.Node): void => {
      if (ts.isReturnStatement(x) && x.expression !== undefined) returns.push(x.expression);
      else if (!ts.isFunctionLike(x)) ts.forEachChild(x, walk);
    };
    ts.forEachChild(f.body, walk);
    for (const r of returns) {
      const v = of(r);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** The operator a compound assignment applies (`^=` is `^`). */
const COMPOUND_BASE = new Map<ts.SyntaxKind, ts.BinaryOperator>([
  [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
  [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
  [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
  [ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.BarToken],
  [ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.AmpersandToken],
  [ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.CaretToken],
  [ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.LessThanLessThanToken],
]);

/** {@link readingPair} of `left op right` for a compound assignment, which has no node of its own. */
function binaryPair(
  left: ts.Expression,
  op: ts.BinaryOperator,
  right: ts.Expression,
  sourceFile: ts.SourceFile,
  seen: Set<ts.Node>,
): { u32: number; ts: number } | undefined {
  const synthetic = ts.factory.createBinaryExpression(left, op, right);
  // The synthetic node reads its operands where they stand in the file.
  (synthetic as { parent: ts.Node }).parent = left.parent;
  return readingPair(synthetic, sourceFile, seen);
}

/** One refusal of an operation whose result differs between a tree's two readings (D2): its
 *  operand, the operation, and the diagnostic as it stands. Its edit is chosen and verified with
 *  the module's other edits ({@link checkModuleEdits}). */
interface ReadingsRefusal {
  readonly node: ts.Expression;
  readonly operation: ts.Node;
  readonly operator: string;
  readonly readings: { readonly u32: number; readonly ts: number };
  /** The typed peer's type, where the operation has one. */
  readonly peer?: 'i32' | 'u32';
  /** Whether the operand is the target of an assignment, which no conversion can wrap. */
  readonly target: boolean;
  diagnostic: TsCompilerDiagnostic;
}

const readingsRefusalsOf = new WeakMap<ts.SourceFile, ReadingsRefusal[]>();

/** The declaration of the variable `name` read at `at`, as written, with `type` after its name:
 *  `let a: u32 = 3000000000 | 0`. */
function declaredWith(name: string, at: ts.Node, type: string): string | undefined {
  const d = declarationOf(name, at);
  if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined)
    return undefined;
  const list = d.parent;
  const keyword =
    ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const ? 'const' : 'let';
  return `${keyword} ${name}: ${type} = ${d.initializer.getText().replace(/\s+/g, ' ')}`;
}

function readingsSentenceOf(r: ReadingsRefusal, remedy: string): string {
  const text = skipParenNodes(r.node).getText().replace(/\s+/g, ' ');
  return (
    `"${text}" is ${String(r.readings.u32)} on its u32 bits and ${String(r.readings.ts)} in ` +
    `TypeScript, so the "${r.operator}" does not say which value it means. ${remedy}`
  );
}

function readingsRemedy(r: ReadingsRefusal, type: 'u32' | 'i32' | null): string {
  const text = skipParenNodes(r.node).getText().replace(/\s+/g, ' ');
  if (r.target) {
    if (type === null) return `Declare "${text}" with u32 or i32 to choose its value.`;
    const line = declaredWith(text, r.node, type);
    return line === undefined
      ? `Declare "${text}" with ${type} to choose its value.`
      : `Write "${line}" for the ${type} value.`;
  }
  return type === null
    ? `Write u32(…) or i32(…) around "${text}" to choose its value.`
    : `Write "${type}(${text})" for the ${type} value.`;
}

/** Refuses the operation `operation` over `node`, whose two readings give different results
 *  (the owner's decision of 2026-11-12, D2). The sentence names `u32(…)` until the module's
 *  check chooses and verifies the edit. */
export function refuseTwoReadings(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  info: Omit<ReadingsRefusal, 'diagnostic'>,
): void {
  const r = info as ReadingsRefusal;
  r.diagnostic = makeDiagnostic(
    sourceFile,
    info.node,
    readingsSentenceOf(r, readingsRemedy(r, 'u32')),
    TS_CODES.TYPE_MISMATCH,
  );
  diagnostics.push(r.diagnostic);
  let list = readingsRefusalsOf.get(sourceFile);
  if (list === undefined) readingsRefusalsOf.set(sourceFile, (list = []));
  list.push(r);
}

/** Whether `node` is written numbers and operators over them alone. */
function constantTree(node: ts.Expression): boolean {
  const n = skipParenNodes(node);
  if (writtenNumber(n) !== undefined) return true;
  if (ts.isPrefixUnaryExpression(n)) return constantTree(n.operand);
  return ts.isBinaryExpression(n) && constantTree(n.left) && constantTree(n.right);
}

/** Whether `node` is a bit tree of written integers in the source (`(5 | 0)`, `~(1 | 2)`). */
function writtenBitTree(node: ts.Expression): boolean {
  const n = skipParenNodes(node);
  const leaf = (e: ts.Expression): boolean => writtenNumber(e) !== undefined || writtenBitTree(e);
  if (ts.isPrefixUnaryExpression(n)) {
    return (
      (n.operator === ts.SyntaxKind.TildeToken && leaf(n.operand)) ||
      (n.operator === ts.SyntaxKind.MinusToken && writtenBitTree(n.operand))
    );
  }
  if (!ts.isBinaryExpression(n)) return false;
  const k = n.operatorToken.kind;
  const bit =
    k === ts.SyntaxKind.BarToken ||
    k === ts.SyntaxKind.AmpersandToken ||
    k === ts.SyntaxKind.CaretToken ||
    k === ts.SyntaxKind.LessThanLessThanToken ||
    k === ts.SyntaxKind.GreaterThanGreaterThanToken;
  return bit && leaf(n.left) && leaf(n.right);
}

/** Whether `node` reads a value that is an integer only by its bit operator, by a way the
 *  lowering's own marks do not follow: a module `let` of such a tree, or a call of a function
 *  with no written result that returns one (the module's own calls read its integer copy,
 *  Amendment A5). A `/` over it does not say which division it is (D-b). */
export function kindlessSource(node: ts.Expression, depth = 0): boolean {
  const n = skipParenNodes(node);
  const sourceFile = n.getSourceFile();
  if (depth > 16) return false;
  // Arithmetic and bit operators over such values and written numbers (`(-(5 | 0)) | M`), and
  // builtins over those (`gg() ^ sign(-7 | 0)`).
  const part = (e: ts.Expression) =>
    writtenNumber(e) !== undefined || writtenBitTree(e) || inferredInteger(e, depth + 1);
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    // A shift's type is its left operand's, whatever its amount is (`gg() << vi`).
    if (
      k === ts.SyntaxKind.LessThanLessThanToken ||
      k === ts.SyntaxKind.GreaterThanGreaterThanToken
    ) {
      return kindlessSource(n.left, depth + 1);
    }
    const op =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.BarToken ||
      k === ts.SyntaxKind.AmpersandToken ||
      k === ts.SyntaxKind.CaretToken;
    return (
      op &&
      part(n.left) &&
      part(n.right) &&
      (kindlessSource(n.left, depth + 1) || kindlessSource(n.right, depth + 1))
    );
  }
  if (
    ts.isPrefixUnaryExpression(n) &&
    (n.operator === ts.SyntaxKind.MinusToken || n.operator === ts.SyntaxKind.TildeToken)
  ) {
    return kindlessSource(n.operand, depth + 1);
  }
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n.text, n);
    return (
      d !== undefined &&
      ts.isVariableDeclaration(d) &&
      ts.isSourceFile(d.parent.parent.parent) &&
      writtenTypeText(d, sourceFile) === undefined &&
      d.initializer !== undefined &&
      writtenBitTree(d.initializer)
    );
  }
  // `?:`, `select` and an integer builtin carry their arms' or arguments' origin, as they do
  // over a tree (`abs(gg())`, `vi > 3 ? gg() : 1`).
  const carried = carriedParts(n);
  if (carried !== undefined) {
    return carried.every((e) => part(e)) && carried.some((e) => kindlessSource(e, depth + 1));
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
    const f = functionNamed(sourceFile, n.expression.text);
    if (f?.body === undefined) return false;
    // A generic function's result is its argument (`id<T>(a: T): T`): the origin is the
    // argument's (the fourteenth review of #1272, F3).
    const generic = genericArgument(f, n, sourceFile);
    if (generic !== undefined) return generic !== null && inferredInteger(generic, depth + 1);
    if (writtenResultText(f, sourceFile) !== undefined) return false;
    // A function with no written result that returns an integer by its bit operator, through
    // its own bindings and builtins too (`return abs(6 ^ 3)`, `let x = 6 ^ 3; return x`): the
    // module's own calls read its integer copy (Amendment A5), so its result carries the
    // origin, as `let a = abs(6 ^ 3)` does (the fourteenth review of #1272, F1).
    const returns: ts.ReturnStatement[] = [];
    const walk = (x: ts.Node): void => {
      if (ts.isReturnStatement(x)) returns.push(x);
      else if (!ts.isFunctionLike(x)) ts.forEachChild(x, walk);
    };
    ts.forEachChild(f.body, walk);
    return (
      returns.length > 0 &&
      returns.every((r) => r.expression !== undefined && inferredInteger(r.expression, depth + 1))
    );
  }
  return false;
}

/** Whether the variable `d` declares is assigned anywhere after its declaration: `=`, a compound
 *  assignment, `++` or `--`, in any function of the file (a module `let` set elsewhere). */
export function reassignedAnywhere(d: ts.VariableDeclaration): boolean {
  if (!ts.isIdentifier(d.name)) return false;
  const name = d.name.text;
  return identifiersNamed(d.getSourceFile(), name).some((id) => {
    if (id === d.name) return false;
    const p = skipParenUp(id);
    const parent = p.parent;
    const target =
      (ts.isBinaryExpression(parent) &&
        parent.left === p &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
          parent.operator === ts.SyntaxKind.MinusMinusToken));
    return target && declarationOf(name, id) === d;
  });
}

function skipParenUp(n: ts.Node): ts.Node {
  let u = n;
  while (ts.isParenthesizedExpression(u.parent)) u = u.parent;
  return u;
}

/** The function a call of `name` at `at` reaches: one declared in a block around `at` or at the
 *  top of the file, or a `const` bound to an arrow or a function expression. */
function calleeAt(
  name: string,
  at: ts.Node,
): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined {
  for (let n: ts.Node | undefined = at.parent; n !== undefined; n = n.parent) {
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      for (const st of n.statements) {
        if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st;
      }
    }
  }
  const d = declarationOf(name, at);
  if (
    d !== undefined &&
    ts.isVariableDeclaration(d) &&
    d.initializer !== undefined &&
    (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
  ) {
    return d.initializer;
  }
  return undefined;
}

/** Whether `f` writes its result type, and it names no type parameter (a generic result is no
 *  declared type: its origin is the argument's). */
function writesResult(f: ts.SignatureDeclaration): boolean {
  const result = writtenResultText(f, f.getSourceFile());
  return result !== undefined && !(f.typeParameters ?? []).some((t) => t.name.text === result);
}

/**
 * Whether the type of the integer `node` is one the author wrote (the owner's decision of
 * 2026-11-13, E1, "증명 못 하면 추론으로 봄"): a conversion `i32()`, `u32()` or `f32()`, a typed
 * parameter, a variable with a written type, a field or an element (whose types are written), a
 * call of a function with a written result type, or an operator or builtin over one of those.
 * Anything else is an integer by inference, unless proven: the result of a call of a function
 * with no written result (any form: mixed returns, an arrow, a local function, a method, a
 * getter), a generic result, a module `let` with no written type, and a read of a variable with
 * no written type that is assigned anywhere. A variable with no written type that nothing assigns
 * is its initializer's.
 */
export function provenTyped(node: ts.Expression, depth = 0): boolean {
  const n = skipParenNodes(node);
  if (depth > 32) return false;
  if (writtenNumber(n) !== undefined) return false;
  if (ts.isCallExpression(n)) {
    const callee = n.expression;
    if (ts.isIdentifier(callee)) {
      if (/^(i32|u32|f32|f16|bool|vec[234][iuf]?|mat[234](x[234])?f?|array)$/.test(callee.text)) {
        return true;
      }
      const carried = carriedParts(n);
      if (carried !== undefined) return carried.some((e) => provenTyped(e, depth + 1));
      const f = calleeAt(callee.text, n);
      // A builtin or a name no declaration of this file binds keeps its own type.
      return f === undefined ? true : writesResult(f);
    }
    if (ts.isPropertyAccessExpression(callee)) {
      // A method: every method of that name in the file writes its result type.
      const methods = identifiersNamed(n.getSourceFile(), callee.name.text)
        .map((id) => id.parent)
        .filter(
          (p): p is ts.MethodDeclaration =>
            ts.isMethodDeclaration(p) && p.name.kind === ts.SyntaxKind.Identifier,
        );
      return methods.length === 0 || methods.every(writesResult);
    }
    return true;
  }
  if (ts.isPropertyAccessExpression(n)) {
    // A getter with no written result is a call of it (E1).
    const getters = identifiersNamed(n.getSourceFile(), n.name.text)
      .map((id) => id.parent)
      .filter((p): p is ts.GetAccessorDeclaration => ts.isGetAccessorDeclaration(p));
    return getters.every(writesResult);
  }
  if (ts.isElementAccessExpression(n)) return true;
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n.text, n);
    if (d === undefined) return true;
    if (ts.isParameter(d)) return writtenTypeText(d, n.getSourceFile()) !== undefined;
    if (writtenTypeText(d, n.getSourceFile()) !== undefined) return true;
    if (ts.isSourceFile(d.parent.parent.parent) && !(d.parent.flags & ts.NodeFlags.Const)) {
      return false;
    }
    if (reassignedAnywhere(d) || d.initializer === undefined) return false;
    return provenTyped(d.initializer, depth + 1);
  }
  if (ts.isPrefixUnaryExpression(n)) return provenTyped(n.operand, depth + 1);
  if (ts.isConditionalExpression(n)) {
    return provenTyped(n.whenTrue, depth + 1) || provenTyped(n.whenFalse, depth + 1);
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (
      k === ts.SyntaxKind.LessThanLessThanToken ||
      k === ts.SyntaxKind.GreaterThanGreaterThanToken
    ) {
      return provenTyped(n.left, depth + 1);
    }
    return provenTyped(n.left, depth + 1) || provenTyped(n.right, depth + 1);
  }
  return true;
}

/** The arms of a `?:` or a `select`, or the arguments of an integer builtin, that carry their
 *  origin to the result; `undefined` for any other node. */
function carriedParts(n: ts.Expression): readonly ts.Expression[] | undefined {
  if (ts.isConditionalExpression(n)) return [n.whenTrue, n.whenFalse];
  if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression)) return undefined;
  const name = n.expression.text;
  if (name === 'select' && n.arguments.length === 3) return n.arguments.slice(0, 2);
  if (['abs', 'sign', 'min', 'max', 'clamp'].includes(name) && n.arguments.length > 0) {
    return n.arguments;
  }
  return undefined;
}

/** The argument a call of the generic `f` returns, where `f`'s result is a type parameter and
 *  each of its returns is the parameter of that type; `null` where the result is a type
 *  parameter returned some other way; `undefined` where `f` is no such function. */
function genericArgument(
  f: ts.FunctionDeclaration,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ts.Expression | null | undefined {
  const result = writtenResultText(f, sourceFile);
  if (result === undefined || !(f.typeParameters ?? []).some((t) => t.name.text === result)) {
    return undefined;
  }
  const at = f.parameters.findIndex(
    (p) => p.type !== undefined && p.type.getText(sourceFile) === result,
  );
  const returns: ts.ReturnStatement[] = [...(f.body?.statements ?? [])].filter(
    ts.isReturnStatement,
  );
  const param = f.parameters[at];
  if (
    param === undefined ||
    !ts.isIdentifier(param.name) ||
    returns.length === 0 ||
    !returns.every(
      (r) =>
        r.expression !== undefined &&
        ts.isIdentifier(skipParenNodes(r.expression)) &&
        (skipParenNodes(r.expression) as ts.Identifier).text === (param.name as ts.Identifier).text,
    )
  ) {
    return null;
  }
  return call.arguments[at] ?? null;
}

/** Whether `node` is an integer only by a bit operator: a bit tree of written integers, a value
 *  {@link kindlessSource} follows, a binding of the function with no written type that holds
 *  one, or a builtin, `?:` or `select` over those and written numbers. */
function inferredInteger(node: ts.Expression, depth: number): boolean {
  const n = skipParenNodes(node);
  if (depth > 16) return false;
  if (writtenBitTree(n) || kindlessSource(n, depth + 1)) return true;
  const part = (e: ts.Expression) =>
    writtenNumber(e) !== undefined || inferredInteger(e, depth + 1);
  const carried = carriedParts(n);
  if (carried !== undefined) {
    return carried.every(part) && carried.some((e) => inferredInteger(e, depth + 1));
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (
      k === ts.SyntaxKind.LessThanLessThanToken ||
      k === ts.SyntaxKind.GreaterThanGreaterThanToken
    ) {
      return inferredInteger(n.left, depth + 1);
    }
    const op =
      k === ts.SyntaxKind.PlusToken ||
      k === ts.SyntaxKind.MinusToken ||
      k === ts.SyntaxKind.AsteriskToken ||
      k === ts.SyntaxKind.PercentToken ||
      k === ts.SyntaxKind.BarToken ||
      k === ts.SyntaxKind.AmpersandToken ||
      k === ts.SyntaxKind.CaretToken;
    return op && part(n.left) && part(n.right) && (!constantTree(n.left) || !constantTree(n.right));
  }
  if (ts.isIdentifier(n)) {
    const d = declarationOf(n.text, n);
    return (
      d !== undefined &&
      ts.isVariableDeclaration(d) &&
      writtenTypeText(d, n.getSourceFile()) === undefined &&
      d.initializer !== undefined &&
      inferredInteger(d.initializer, depth + 1)
    );
  }
  return false;
}

/** The declaration of the variable `name` read at `at` with `type` written after its name, as
 *  the edit of a refused `/=` names it; `undefined` where it is no `let` or `const` here. */
export function declarationWithType(name: string, at: ts.Node, type: string): string | undefined {
  return declaredWith(name, at, type);
}
