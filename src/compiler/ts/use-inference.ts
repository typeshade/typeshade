// A written number takes its type from every place it reaches (Rule 5.1, change 0134 items 1
// and 3; `docs/owner-decisions.md` OD-7).
//
// An unannotated `let` initialized by an integer-written literal has no type the author wrote.
// Its uses decide one: an operand beside a typed peer (`n += vi`, `k < i`), an argument of a
// builtin beside a typed argument (`max(m, vi)`), a constructor argument, an arm of a
// conditional, a field of an object literal, a bitwise or shift operand, an index, an
// assignment from a typed value, a `return` in a function whose result is declared, an
// argument of a declared parameter, and another value that takes its type the same way.
// Where nothing decides, the compiler chooses `f32` by itself (decision Q5), the type such a
// value always had, so no emitted byte moves for a program that compiled before.
//
// HOW IT IS SOLVED. The lowering already computes the type of every peer, so the inference
// does not repeat it. The module is lowered once with each undecided value read as the `f32`
// it would have been. Each place that would retarget a WRITTEN NUMBER (`lit-coerce.ts`,
// `numeric.ts`) or that refuses an `f32` where an integer is needed (an index, a bitwise
// operand, an assignment) records a DEMAND on the value it reads instead. After the pass the
// demands of each value are settled into a decision, and the module is lowered again with the
// decisions as if the author had written them. A decision can give a new peer its type
// (`b += a` once `a` is a `u32`), so this repeats until no decision is new: a fixed point over
// the module, independent of source order. Only the last pass's diagnostics are kept.
//
// Uses that demand two concrete types are refused with `TS8003` at the declaration, with the
// annotation remedy, as Rule 5.1 always said.
//
// Implements: Rule 5.1 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f64T, i32T, u32T } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey } from './optional.js';
import { abstractLiteralOf, type AbstractConst, type Carried } from './abstract-const.js';

/** What a use asks of a value: a concrete scalar, or `int`, an integer of no kind (an index, a
 *  bitwise operand with no typed peer), which is an `i32` unless another use says `u32`. */
export type Demand = 'i32' | 'u32' | 'f32' | 'f64' | 'int';

/** One value whose type its uses decide, shared by its declaration's binding and each read. */
export interface InferredValue {
  /** The declaration, the key of the value across the passes of one compile. */
  readonly decl: ts.Node;
  /** The name as the author wrote it. */
  readonly name: string;
  /** The initializer as the author wrote it, for a remedy line. */
  readonly written?: string;
  /** The type the uses gave it, when an earlier pass decided one (or the declared uses of
   *  changes 0036 and 0037 did). `undefined` while undecided: it reads as an `f32`. */
  readonly type?: ShaderType;
}

interface State {
  /** Decisions of the passes so far, by declaration. */
  readonly decided: Map<ts.Node, ShaderType>;
  /** Declarations whose uses demand two concrete types, with the sentence. */
  readonly conflicts: Map<ts.Node, string>;
  /** The header declarations of `for` loops an earlier pass found not counted: each is a
   *  value its uses decide, not a counted loop's counter (Amendment A1 of change 0134). */
  readonly openCounters: Set<ts.Node>;
  /** Whether the running pass found a new one. */
  newOpenCounter: boolean;
  /** Demands recorded in the pass that is running. */
  demands: Map<ts.Node, { readonly name: string; readonly asked: Set<Demand> }>;
}

const states = new WeakMap<ts.SourceFile, State>();
const readByExpr = new WeakMap<Expr, InferredValue>();
const readByNode = new WeakMap<ts.Node, InferredValue>();
/** The source file whose lowering is running, so a retarget that has only an expression can
 *  reach the pass's demands. */
let current: State | undefined;

/** Starts the inference of one compile of `sourceFile`. */
export function beginUseInference(sourceFile: ts.SourceFile): void {
  states.set(sourceFile, {
    decided: new Map(),
    conflicts: new Map(),
    openCounters: new Set(),
    newOpenCounter: false,
    demands: new Map(),
  });
}

/** Starts one pass: the demands of the pass before are forgotten. Returns what to hand
 *  {@link endUseInferencePass}. */
export function beginUseInferencePass(sourceFile: ts.SourceFile): State | undefined {
  const outer = current;
  const state = states.get(sourceFile);
  if (state !== undefined) state.demands = new Map();
  current = state;
  return outer;
}

/** Ends a pass started with {@link beginUseInferencePass}. */
export function endUseInferencePass(outer: State | undefined): void {
  current = outer;
}

const CONCRETE: readonly Demand[] = ['i32', 'u32', 'f32', 'f64'];
const TYPE_OF: Readonly<Record<'i32' | 'u32' | 'f64', ShaderType>> = {
  i32: i32T,
  u32: u32T,
  f64: f64T,
};

/** Settles the demands of the pass that just ran. Returns whether a decision or a conflict is
 *  new, so that the module must be lowered again. */
export function settleUseInference(sourceFile: ts.SourceFile): boolean {
  const state = states.get(sourceFile);
  if (state === undefined) return false;
  // A pass that found a `for` not counted typed that counter as a counted loop's. What its
  // uses asked of other values rests on that type, so the pass decides nothing else.
  if (state.newOpenCounter) {
    state.newOpenCounter = false;
    return true;
  }
  let changed = false;
  for (const [decl, { name, asked }] of state.demands) {
    if (state.decided.has(decl) || state.conflicts.has(decl)) continue;
    const concrete = CONCRETE.filter((d) => asked.has(d));
    const wantsInteger = asked.has('int');
    const clash =
      concrete.length > 1
        ? concrete
        : wantsInteger && concrete.some((d) => d === 'f32' || d === 'f64')
          ? (['an integer', ...concrete] as string[])
          : undefined;
    if (clash !== undefined) {
      state.conflicts.set(
        decl,
        `Cannot infer "${name}": its uses require ${clash.slice(0, -1).join(', ')} and ` +
          `${clash[clash.length - 1]!}. Write an explicit type annotation on "${name}" and cast ` +
          `the uses that need another type.`,
      );
      changed = true;
      continue;
    }
    const one = concrete[0] ?? (wantsInteger ? 'i32' : undefined);
    // `f32` is what an undecided value already is: nothing to lower again.
    if (one === undefined || one === 'f32' || one === 'int') continue;
    state.decided.set(decl, TYPE_OF[one]);
    changed = true;
  }
  return changed;
}

/** Records that the `for` whose header declares `decl` is not a counted loop: from the next
 *  pass, `decl` is an ordinary `let`, whose uses decide its type. */
export function noteOpenCounter(sourceFile: ts.SourceFile, decl: ts.Node): void {
  const state = states.get(sourceFile);
  if (state === undefined || state.openCounters.has(decl)) return;
  state.openCounters.add(decl);
  state.newOpenCounter = true;
}

/** Whether an earlier pass found the `for` of the header declaration `decl` not counted. */
export function isOpenCounter(sourceFile: ts.SourceFile, decl: ts.Node): boolean {
  return states.get(sourceFile)?.openCounters.has(decl) === true;
}

/** The type an earlier pass decided for `decl`, if any. */
export function decidedType(sourceFile: ts.SourceFile, decl: ts.Node): ShaderType | undefined {
  return states.get(sourceFile)?.decided.get(decl);
}

/** The sentence of a declaration whose uses demand two types, if they do. */
export function inferenceConflict(sourceFile: ts.SourceFile, decl: ts.Node): string | undefined {
  return states.get(sourceFile)?.conflicts.get(decl);
}

/** Whether the inference of this compile is running (it is not for a lowering outside
 *  `compileTsSource`, which then keeps the declared-use inference alone). */
export function useInferenceActive(sourceFile: ts.SourceFile): boolean {
  return states.has(sourceFile);
}

/** Remembers that `expr`, lowered from `node`, reads `value`. Returns `expr`. */
export function markInferredRead<E extends Expr>(
  expr: E,
  node: ts.Node,
  value: InferredValue | undefined,
): E {
  if (value !== undefined) {
    readByExpr.set(expr, value);
    readByNode.set(node, value);
  }
  return expr;
}

function stripParens(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}

/** The value `node` reads, when it reads one whose type its uses decide. */
export function inferredReadAt(node: ts.Expression): InferredValue | undefined {
  return readByNode.get(stripParens(node));
}

/** Whether `node` reads a value that no use has decided yet: it has no type to lend. */
export function isUndecidedRead(node: ts.Expression): boolean {
  const read = inferredReadAt(node);
  return read !== undefined && read.type === undefined;
}

/** The undecided values `expr` reads, through `+ - * / %` and a unary minus over reads and
 *  literals; empty when `expr` holds anything else, which has a type of its own. */
function undecidedIn(expr: Expr): InferredValue[] {
  const out: InferredValue[] = [];
  const walk = (e: Expr): boolean => {
    const read = readByExpr.get(e);
    if (read !== undefined) {
      if (read.type === undefined) out.push(read);
      return read.type === undefined;
    }
    if (e.op === 'lit') return typeof e.value === 'number';
    if (e.op === 'unop') return walk(e.a);
    if (e.op === 'binop' && ['+', '-', '*', '/', '%'].includes(e.bop)) {
      const a = walk(e.a);
      const b = walk(e.b);
      return a && b;
    }
    // A constant of no fixed type is a written number here: it lends no type and takes none.
    return abstractLiteralOf(e) !== undefined;
  };
  return walk(expr) ? out : [];
}

let soft = false;

/** Runs `run` with each integer demand it records taken as `int`, an integer of no kind. An
 *  index and a shift retarget a written number to a fixed integer type that the position does
 *  not require (`xs[2]` is an `i32` index, and a `u32` index is one too). */
export function softDemands<T>(run: () => T): T {
  const outer = soft;
  soft = true;
  try {
    return run();
  } finally {
    soft = outer;
  }
}

function record(value: InferredValue, asked: Demand): void {
  if (current === undefined || value.type !== undefined) return;
  // An `f32` peer asks nothing: an undecided value is an `f32` already, and a written number
  // beside it is typed `f32` only by having no type (`j + 1`). An integer use beside an `f32`
  // use is refused where the `f32` use stands, once the value is the integer.
  if (asked === 'f32') return;
  const demand: Demand = soft && (asked === 'i32' || asked === 'u32') ? 'int' : asked;
  let entry = current.demands.get(value.decl);
  if (entry === undefined) {
    current.demands.set(value.decl, (entry = { name: value.name, asked: new Set() }));
  }
  entry.asked.add(demand);
}

/** Records that a use of `expr` asks for `demand`, on each undecided value `expr` reads. */
export function noteDemand(expr: Expr, demand: Demand | ShaderType): void {
  if (current === undefined) return;
  const asked: Demand | undefined = typeof demand === 'string' ? demand : demandOfType(demand);
  if (asked === undefined) return;
  for (const value of undecidedIn(expr)) record(value, asked);
}

/** Records that an assignment to `value` stores a value of `type`: the value takes it, when
 *  `stored` has a type of its own (it reads no undecided value). */
export function noteStoredType(
  value: InferredValue | undefined,
  stored: Expr,
  type: ShaderType,
): void {
  if (value === undefined || undecidedIn(stored).length > 0) return;
  const asked = demandOfType(type);
  if (asked !== undefined) record(value, asked);
}

/** Records that `value` is used where only an integer stands (a bitwise target). */
export function noteIntegerUse(value: InferredValue | undefined, peer?: ShaderType): void {
  if (value === undefined) return;
  const asked = peer === undefined ? undefined : demandOfType(peer);
  record(value, asked === 'i32' || asked === 'u32' ? asked : 'int');
}

/** The demand a peer or a declared position of type `type` makes: its scalar, a vector's
 *  element scalar, `f64` for an emulated double; nothing for any other type. */
function demandOfType(type: ShaderType): Demand | undefined {
  if (type.kind === 'f64' || type.kind === 'vec64') return 'f64';
  if (type.kind === 'vec') return type.elem === 'f32' ? 'f32' : type.elem === 'i32' ? 'i32' : 'u32';
  const key = typeKey(type);
  return key === 'i32' || key === 'u32' || key === 'f32' ? key : undefined;
}

/** Whether the integer type of `node` came from inference alone (decisions Q6 and Q11): a
 *  read of a value its uses made an integer, a written number, or `+ - * / %` and a unary
 *  minus over those, with at least one such read. `reads` collects the values. */
export function inferredIntegerOnly(node: ts.Expression, reads: InferredValue[] = []): boolean {
  const inner = stripParens(node);
  if (ts.isNumericLiteral(inner)) {
    const written = inner.getText();
    return /^0[xXbBoO]/.test(written) || !/[.eE]/.test(written);
  }
  const read = readByNode.get(inner);
  if (read !== undefined) {
    const key = read.type === undefined ? undefined : typeKey(read.type);
    if (key !== 'i32' && key !== 'u32') return false;
    reads.push(read);
    return true;
  }
  if (ts.isPrefixUnaryExpression(inner) && inner.operator === ts.SyntaxKind.MinusToken) {
    return inferredIntegerOnly(inner.operand, reads);
  }
  if (
    ts.isBinaryExpression(inner) &&
    [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.MinusToken,
      ts.SyntaxKind.AsteriskToken,
      ts.SyntaxKind.SlashToken,
      ts.SyntaxKind.PercentToken,
    ].includes(inner.operatorToken.kind)
  ) {
    return inferredIntegerOnly(inner.left, reads) && inferredIntegerOnly(inner.right, reads);
  }
  return false;
}

/** The sentence of a refused `/` or `/=` whose operands are all integers by inference
 *  (decisions Q6 and Q11), or `undefined` when one operand has a type the author wrote. */
export function inferredDivisionMessage(
  left: ts.Expression,
  right: ts.Expression,
  operator: '/' | '/=',
  keywordOf: (value: InferredValue) => string,
  sourceFile: ts.SourceFile,
): string | undefined {
  const reads: InferredValue[] = [];
  if (!inferredIntegerOnly(left, reads) || !inferredIntegerOnly(right, reads)) return undefined;
  const value = reads[0];
  if (value === undefined || value.type === undefined) return undefined;
  const type = typeKey(value.type);
  const l = left.getText(sourceFile);
  const r = right.getText(sourceFile);
  const cast = (text: string, operand: ts.Expression): string =>
    inferredReadAt(operand) === value ? `f32(${text})` : text;
  const float =
    operator === '/'
      ? `"${cast(l, left)} / ${cast(r, right)}"`
      : `"${keywordOf(value)} ${value.name}: f32 = ${value.written ?? '...'}"`;
  return (
    `"${value.name}" is ${type === 'u32' ? 'a u32' : 'an i32'} by its uses, and no operand of ` +
    `"${l} ${operator} ${r}" has a declared type, so the "${operator}" does not say which ` +
    `division it is. Write "${keywordOf(value)} ${value.name}: ${type} = ${value.written ?? '...'}" for the integer ` +
    `division, or ${float} for the float one.`
  );
}

/** The origin a read of `value` carries when its uses made it an integer: a `/` over it whose
 *  operands have no declared type is refused, as a `/` over a constant that some read makes an
 *  integer is (decisions Q6 and Q11; `abstract-const.ts` reports it, with the edit it checks).
 *  One record for each declaration, for each type its uses gave it. */
const origins = new WeakMap<ts.Node, { key: string; carried: Carried }>();
export function inferredOrigin(value: InferredValue | undefined): Carried | undefined {
  if (value === undefined || value.type === undefined) return undefined;
  const key = typeKey(value.type);
  if (key !== 'i32' && key !== 'u32') return undefined;
  const cached = origins.get(value.decl);
  if (cached !== undefined && cached.key === key) return cached.carried;
  const decl = value.decl as ts.VariableDeclaration;
  const info: AbstractConst = {
    name: value.name,
    value: Number.NaN,
    integerWritten: true,
    keyword: 'let',
    nameNode: decl.name,
    written: value.written ?? '',
    sources: [],
    // Its uses are the other read that makes it an integer: they stand outside any `/`.
    integerReads: [{ type: key, node: decl.name as ts.Expression }],
  };
  const carried: Carried = {
    reaches: [info],
    float: false,
    variable: { keyword: 'let', name: value.name, init: value.written ?? '', type: key },
  };
  origins.set(value.decl, { key, carried });
  return carried;
}

/** What a read of a binding carries: the constants its initializer reaches, and where its uses
 *  made it an integer and it reaches none, the record of {@link inferredOrigin}. */
export function carriedOf(
  carries: Carried | undefined,
  value: InferredValue | undefined,
): Carried | undefined {
  if (carries !== undefined && carries.reaches.length > 0) return carries;
  return inferredOrigin(value) ?? carries;
}
