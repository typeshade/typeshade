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
import { f32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic, noteUse } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import { sameFile, writtenRange, writtenText } from './context.js';

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
  /** `const` for the remedy line; a static field is written `static`. */
  readonly keyword: 'const' | 'static';
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
}
const nodeMarks = new WeakMap<ts.SourceFile, NodeMarks>();
function marksOf(node: ts.Node): NodeMarks {
  const sf = node.getSourceFile();
  let marks = nodeMarks.get(sf);
  if (marks === undefined) nodeMarks.set(sf, (marks = { read: new Map(), carried: new Map() }));
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
  return {
    name,
    value: tree.value,
    integerWritten: tree.integerWritten,
    keyword,
    nameNode,
    written: writtenText(initializer).replace(/\s+/g, ' '),
    sources: tree.reads,
    integerReads: [],
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
  }
  return expr;
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
    readonly keyword: 'let' | 'const';
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

/** `node` as written, with each part that carries an origin converted to `type`: `f32(k) / 2`,
 *  `xs[i32(k) / 2]`. A float conversion of a value under a bitwise or shift operator converts
 *  the outermost such operation instead, which has an integer's value: `f32(k | 1) / 2`. */
function withOriginsConverted(node: ts.Node, type: string, sourceFile: ts.SourceFile): string {
  const wrapped = new Set<ts.Node>();
  for (const leaf of originLeaves(node)) {
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
  const start = node.getStart(sourceFile);
  let out = '';
  let at = start;
  for (const n of outer.sort((x, y) => x.getStart(sourceFile) - y.getStart(sourceFile))) {
    out += writtenRange(sourceFile, at, n.getStart(sourceFile));
    out += `${type}(${writtenText(ts.isParenthesizedExpression(n) ? n.expression : n)})`;
    at = n.getEnd();
  }
  return (out + writtenRange(sourceFile, at, node.getEnd())).replace(/\s+/g, ' ');
}

const ANOTHER_READ = 'where another line reads it, and no operand of';

/** Whether `d` is the refusal of {@link reportAbstractDivisions}. It depends on the whole
 *  program: the `/` may stand in one file and the integer read in another, which imports it.
 *  The language service asks, so that the file of the `/` shows what `compile()` of the
 *  importing file reports (Rule 12.7). */
export function isAbstractDivisionRefusal(d: {
  readonly code?: string | undefined;
  readonly message: string;
}): boolean {
  return d.code === TS_CODES.TYPE_MISMATCH && d.message.includes(ANOTHER_READ);
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
  /** `[start, end)` of the source and the text that replaces it; `undefined` when the edit is
   *  not checked (a `/=` names its variable's declaration). */
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
            : `${variable.keyword} ${variable.name}: ${variable.type} = ${variable.init}`,
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
    return { kind: type === 'f32' ? 'float' : 'integer', text, change: replace(text) };
  };
  const declared = (type: 'i32' | 'u32'): DivisionEdit | undefined => {
    if (!sameFile(info.nameNode, node) || !info.integerReads.every((r) => r.type === type)) {
      return undefined;
    }
    const decl = info.nameNode.parent as ts.VariableDeclaration | ts.PropertyDeclaration;
    // After the name, in place of a type the projection wrote there.
    const at = info.nameNode.getEnd();
    const change = { start: at, end: decl.type?.getEnd() ?? at, text: `: ${type}` };
    return { kind: 'integer', text: `${info.keyword} ${short}: ${type} = ${info.written}`, change };
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

/** The refusal's sentence, naming `edit`. */
function divisionSentence(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32' },
  node: ts.BinaryExpression,
  edit: DivisionEdit,
  sourceFile: ts.SourceFile,
): string {
  const written = writtenText(node).replace(/\s+/g, ' ');
  const direct = originLeaves(node).find((leaf) => readByNode.get(leaf as ts.Expression) === info);
  const subject = direct !== undefined ? writtenText(direct) : info.name;
  const operator = node.operatorToken.getText(sourceFile);
  return (
    `"${subject}" is ${read.type === 'u32' ? 'a u32' : 'an i32'} ${ANOTHER_READ} ` +
    `"${written}" has a declared type, so the "${operator}" does not say which division it is. ` +
    `Write "${edit.text}" for the ${edit.kind} division.`
  );
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

/** Reports each `/` recorded by {@link noteAbstractDivision} that reaches a constant another
 *  read made an integer, once for the outermost such `/`. The quotient's own read
 *  (`let j: u32 = K / 2`) is not another read: the written `8 / 2` is `4u` there, and so is
 *  the constant's. Call it after the whole module was lowered. */
/** Compiles `text`, a whole source with one edit made, and returns its errors. `starts` are the
 *  editor projection's insertions in `text`, moved past the edit. */
export type DivisionEditCheck = (
  text: string,
  starts: readonly number[] | undefined,
) => readonly { readonly code?: string; readonly message: string }[];

/** True while a named edit is being compiled: the refusals of that compile name their preferred
 *  edit unchecked, so a check never starts another. */
let checkingEdit = false;

export function reportAbstractDivisions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  check?: DivisionEditCheck,
): void {
  const refused: { division: Division; info: AbstractConst; read: IntegerRead }[] = [];
  for (const division of divisionsOf.get(sourceFile)?.values() ?? []) {
    let found: { info: AbstractConst; read: IntegerRead } | undefined;
    for (const reached of division.reads) {
      for (const info of withSources(reached)) {
        const read = info.integerReads.find((r) => !holds(r.node, division.node));
        if (read !== undefined) found ??= { info, read };
      }
    }
    if (found !== undefined) refused.push({ division, ...found });
  }
  const before = diagnostics.filter((d) => d.category === 'error').map(lineOf);
  for (const { division, info, read } of refused) {
    const { node } = division;
    // `(k / 2) / 3` is one mistake, said on the outer `/` (Rule 12.4).
    if (refused.some((other) => other.division !== division && holds(other.division.node, node)))
      continue;
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    // A mismatch the same `/` raised (its quotient beside an integer) is this mistake said a
    // second time (Rule 12.4); a mismatch that stays after the edit is another mistake.
    const overlapping = diagnostics.filter(
      (d) =>
        d.code === TS_CODES.TYPE_MISMATCH &&
        d.category === 'error' &&
        d.start <= start &&
        d.start + d.length >= end,
    );
    const edits = divisionEdits(info, read, division, sourceFile);
    let chosen = edits[0]!;
    let after: Set<string> | undefined;
    if (check !== undefined && !checkingEdit) {
      // The edit the sentence names must compile where the quotient stands (Rule 5.1): the
      // first edit whose program adds no error to what the file already reports. Where none
      // does (`xs[-k / 2]` is a negative index in every reading), the one that adds fewest.
      const caused = new Set(overlapping.map(lineOf));
      const allowed = new Set(before.filter((line) => !caused.has(line)));
      let fewest = Infinity;
      for (const edit of edits) {
        if (edit.change === undefined) break;
        const result = compileEdited(sourceFile, edit.change, check);
        const extra = result.filter((r) => !allowed.has(r) && !r.includes(ANOTHER_READ)).length;
        if (extra < fewest) {
          fewest = extra;
          chosen = edit;
          after = new Set(result);
        }
        if (extra === 0) break;
      }
      // With no edit that compiles, the program holds another mistake, and a mismatch around
      // the `/` may be that one: each is kept.
      if (fewest > 0) after = new Set(overlapping.map(lineOf));
    }
    for (const d of overlapping) {
      if (after !== undefined && after.has(lineOf(d))) continue;
      const i = diagnostics.indexOf(d);
      if (i >= 0) diagnostics.splice(i, 1);
    }
    const refusal = makeDiagnostic(
      sourceFile,
      node,
      divisionSentence(info, read, node, chosen, sourceFile),
      TS_CODES.TYPE_MISMATCH,
    );
    // The read that makes the constant an integer is the use that makes this `/` a refusal: in
    // a program of several files the refusal stands on it when the file that holds the `/`
    // does not refuse it on its own (`program-refusals.ts`, #1186), with the `/` as its site.
    noteUse(refusal, read.node, sourceFile);
    diagnostics.push(refusal);
  }
}

/** A diagnostic as one comparable line. */
function lineOf(d: { readonly code?: string; readonly message: string }): string {
  return `${d.code ?? ''}: ${d.message}`;
}

/** The errors of `sourceFile`'s text with `change` made, each as `code: message`. In the editor
 *  the projection's insertions are taken out first, so the author's text is compiled, with the
 *  edit made, as `compile()` reads it; an insertion the change replaces goes with it. */
function compileEdited(
  sourceFile: ts.SourceFile,
  change: { readonly start: number; readonly end: number; readonly text: string },
  check: DivisionEditCheck,
): string[] {
  const edits = [{ start: change.start, end: change.end, text: change.text }];
  for (const { at, length } of projectedSpans.get(sourceFile) ?? []) {
    if (at + length <= change.start || at >= change.end) {
      edits.push({ start: at, end: at + length, text: '' });
    }
  }
  let text = sourceFile.text;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  checkingEdit = true;
  try {
    return check(text, undefined).map(lineOf);
  } finally {
    checkingEdit = false;
  }
}
