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
import { f32T } from '../../core/ir/types.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';

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
}

const readByExpr = new WeakMap<Expr, AbstractConst>();
const readByNode = new WeakMap<ts.Node, AbstractConst>();
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
    const k = inner.operatorToken.kind;
    const divides = k === ts.SyntaxKind.SlashToken || k === ts.SyntaxKind.PercentToken;
    if (divides && b.value === 0) return undefined;
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

/** A variable with no annotation whose initializer reaches constants of no fixed type with no
 *  declared type between (`let y = k`, `let z = y + 1`, `const m = max(k, 1)`): it has no
 *  declared type either, so a `/` over it reaches those constants as a derived constant does
 *  (Amendment A2 of change 0134). */
export interface Carried {
  readonly reaches: readonly AbstractConst[];
  /** The declaration with `f32` written, for the remedy of a `/=`: `let y: f32 = k`. */
  readonly declaredF32: string;
}

const carriedByNode = new WeakMap<ts.Node, Carried>();

/** Remembers that `node` reads the variable `carried` describes. Returns `expr`. */
export function markCarriedRead<E extends Expr>(
  expr: E,
  node: ts.Node,
  carried: Carried | undefined,
): E {
  if (carried !== undefined) carriedByNode.set(node, carried);
  return expr;
}

/** What a new variable carries, when its initializer reaches a constant of no fixed type with
 *  no declared type between; `undefined` when it reaches none. Call it after lowering the
 *  initializer. */
export function carriedBy(
  keyword: 'let' | 'const',
  name: string,
  initializer: ts.Expression,
  isBuiltin: (name: string) => boolean,
): Carried | undefined {
  const reaches = typelessReads(initializer, isBuiltin);
  if (reaches === undefined || reaches.length === 0) return undefined;
  return {
    reaches,
    declaredF32: `${keyword} ${name}: f32 = ${initializer.getText().replace(/\s+/g, ' ')}`,
  };
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
export function noteIntegerContext(node: ts.Expression, type: 'i32' | 'u32'): void {
  const visit = (n: ts.Node): void => {
    const division = divisionByNode.get(n);
    if (division !== undefined) division.asked ??= type;
    ts.forEachChild(n, visit);
  };
  visit(node);
}

const CASTS: ReadonlySet<string> = new Set(['f32', 'f64', 'i32', 'u32', 'bool']);

/** The constants of no fixed type that `node` reaches with no declared type between: through
 *  written numbers, `+ - * / %`, a unary minus, a bitwise or shift operator, the arms of a
 *  conditional and the arguments of a builtin. `undefined` when some part has a declared type
 *  (a parameter, a typed local, a conversion, a call of a declared function). */
function typelessReads(
  node: ts.Expression,
  isBuiltin: (name: string) => boolean,
): AbstractConst[] | undefined {
  const inner = stripParens(node);
  if (ts.isNumericLiteral(inner)) return [];
  const read = readByNode.get(inner);
  if (read !== undefined) return [read];
  const carried = carriedByNode.get(inner);
  if (carried !== undefined) return [...carried.reaches];
  if (
    ts.isPrefixUnaryExpression(inner) &&
    (inner.operator === ts.SyntaxKind.MinusToken || inner.operator === ts.SyntaxKind.TildeToken)
  ) {
    return typelessReads(inner.operand, isBuiltin);
  }
  const all = (parts: readonly ts.Expression[]): AbstractConst[] | undefined => {
    const out: AbstractConst[] = [];
    for (const part of parts) {
      const reads = typelessReads(part, isBuiltin);
      if (reads === undefined) return undefined;
      out.push(...reads);
    }
    return out;
  };
  if (
    ts.isBinaryExpression(inner) &&
    (ARITH.has(inner.operatorToken.kind) || BITWISE.has(inner.operatorToken.kind))
  ) {
    return all([inner.left, inner.right]);
  }
  if (ts.isConditionalExpression(inner)) return all([inner.whenTrue, inner.whenFalse]);
  if (
    ts.isCallExpression(inner) &&
    ts.isIdentifier(inner.expression) &&
    !CASTS.has(inner.expression.text) &&
    isBuiltin(inner.expression.text) &&
    inner.arguments.length > 0
  ) {
    return all([...inner.arguments]);
  }
  return undefined;
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
  const left = typelessReads(node.left, isBuiltin);
  const right = typelessReads(node.right, isBuiltin);
  if (left === undefined || right === undefined) return;
  const reads = [...left, ...right];
  if (reads.length === 0) return;
  let table = divisionsOf.get(sourceFile);
  if (table === undefined) divisionsOf.set(sourceFile, (table = new Map()));
  const division: Division = { node, reads };
  table.set(node, division);
  divisionByNode.set(node, division);
}

/** Whether `node` holds a bitwise or shift operator: its value is an integer's. */
function holdsBitwise(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node) && BITWISE.has(node.operatorToken.kind)) return true;
  return ts.forEachChild(node, (child) => (holdsBitwise(child) ? true : undefined)) === true;
}

/** `node` as written, with each read of a constant of no fixed type converted: `f32(k)`. */
function withReadsConverted(node: ts.Node, sourceFile: ts.SourceFile): string {
  const reads: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (readByNode.has(n) || carriedByNode.has(n)) reads.push(n);
    else ts.forEachChild(n, visit);
  };
  visit(node);
  const start = node.getStart(sourceFile);
  let out = '';
  let at = start;
  for (const read of reads.sort((a, b) => a.getStart(sourceFile) - b.getStart(sourceFile))) {
    out += sourceFile.text.slice(at, read.getStart(sourceFile));
    out += `f32(${read.getText(sourceFile)})`;
    at = read.getEnd();
  }
  return (out + sourceFile.text.slice(at, node.getEnd())).replace(/\s+/g, ' ');
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

/** The sentence of a refused `/` (decisions Q6, Q10 and Q11): what is wrong, and the one edit
 *  that says which division the author means where the quotient stands. An integer position
 *  (`xs[k / 2]`, `r + k / 2`) or a bitwise operand names the constant with its type written;
 *  any other position names the `/` with its constants converted. */
export function abstractDivisionMessage(
  info: AbstractConst,
  read: { readonly type: 'i32' | 'u32' },
  division: { readonly node: ts.BinaryExpression; readonly asked?: 'i32' | 'u32' },
  sourceFile: ts.SourceFile,
): string {
  const { node } = division;
  const written = node.getText(sourceFile).replace(/\s+/g, ' ');
  const short = info.name.includes('.')
    ? info.name.slice(info.name.lastIndexOf('.') + 1)
    : info.name;
  const integer = division.asked !== undefined || holdsBitwise(node);
  // `y /= 2` has no operand to convert: the variable with its type written is the float edit.
  const float =
    node.operatorToken.kind === ts.SyntaxKind.SlashEqualsToken
      ? (carriedByNode.get(stripParens(node.left))?.declaredF32 ??
        withReadsConverted(node, sourceFile))
      : withReadsConverted(node, sourceFile);
  return (
    `"${info.name}" is ${read.type === 'u32' ? 'a u32' : 'an i32'} ${ANOTHER_READ} ` +
    `"${written}" has a declared type, so the "${node.operatorToken.getText(sourceFile)}" does not say which ` +
    `division it is. Write ` +
    (integer
      ? // The type of the other read, which then stays as written (`h(k)`, `xs[k / 2]`).
        `"${info.keyword} ${short}: ${read.type} = ${info.written}" for the ` + `integer division.`
      : `"${float}" for the float division.`)
  );
}

/** Reports each `/` recorded by {@link noteAbstractDivision} that reaches a constant another
 *  read made an integer, once for the outermost such `/`. The quotient's own read
 *  (`let j: u32 = K / 2`) is not another read: the written `8 / 2` is `4u` there, and so is
 *  the constant's. Call it after the whole module was lowered. */
export function reportAbstractDivisions(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const refused: { division: Division; info: AbstractConst; read: IntegerRead }[] = [];
  for (const division of divisionsOf.get(sourceFile)?.values() ?? []) {
    let found: { info: AbstractConst; read: IntegerRead } | undefined;
    for (const reached of division.reads) {
      for (const info of withSources(reached)) {
        const read = info.integerReads.find(
          (r) => !holds(division.node, r.node) && !holds(r.node, division.node),
        );
        if (read !== undefined) found ??= { info, read };
      }
    }
    if (found !== undefined) refused.push({ division, ...found });
  }
  for (const { division, info, read } of refused) {
    const { node } = division;
    // `(k / 2) / 3` is one mistake, said on the outer `/` (Rule 12.4).
    if (refused.some((other) => other.division !== division && holds(other.division.node, node)))
      continue;
    // A mismatch the same `/` already raised (its quotient beside an integer) is this mistake
    // said a second time (Rule 12.4): the refusal of the `/` replaces it.
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
        abstractDivisionMessage(info, read, division, sourceFile),
        TS_CODES.TYPE_MISMATCH,
      ),
    );
  }
}
