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
import { f32T, f64T, i32T, u32T } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey } from './optional.js';
import { abstractLiteralOf, type AbstractConst, type Carried } from './abstract-const.js';

/** What a use asks of a value: a concrete scalar, or `int`, an integer of no kind (an index, a
 *  bitwise operand with no typed peer), which is an `i32` unless another use says `u32`. */
export type Demand = 'i32' | 'u32' | 'f32' | 'f64' | 'int';

/** One value whose type its uses decide, shared by its declaration's binding and each read. */
export interface InferredValue {
  /** The declaration: a `let`, a module variable, a field, or the call of a function whose
   *  callers decide its result. */
  readonly decl: ts.Node;
  /** The key of the value across the passes of one compile: the declaration, or the
   *  declaration in one copy of a function (Amendment A1 of change 0134, "사본마다 추론"). */
  readonly key?: object;
  /** A read of a function's result at one call: every use it has counts, an `f32` one too,
   *  since each call takes the copy its own use asks for (Rule 8.19, change 0134 item 1). */
  readonly perUse?: true;
  /** The name as the author wrote it. */
  readonly name: string;
  /** The initializer as the author wrote it, for a remedy line. */
  readonly written?: string;
  /** The type the uses gave it, when an earlier pass decided one (or the declared uses of
   *  changes 0036 and 0037 did). `undefined` while undecided: it reads as an `f32`. */
  readonly type?: ShaderType;
}

interface State {
  /** Decisions of the passes so far, by the key of each value. */
  readonly decided: Map<object, ShaderType>;
  /** Values whose uses demand two concrete types, with the sentence. */
  readonly conflicts: Map<object, string>;
  /** The header declarations of `for` loops an earlier pass found not counted: each is a
   *  value its uses decide, not a counted loop's counter (Amendment A1 of change 0134). */
  readonly openCounters: Set<ts.Node>;
  /** Whether the running pass found a new one. */
  newOpenCounter: boolean;
  /** Demands recorded in the pass that is running. */
  demands: Map<object, { readonly name: string; readonly asked: Set<Demand>; perUse: boolean }>;
  /** The functions an earlier pass found returning a written number or a value of item 1
   *  (Rule 8.19): their callers decide their result. */
  readonly callerDecided: Set<ts.Node>;
  /** Whether the running pass found a new one. */
  newCallerDecided: boolean;
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
    callerDecided: new Set(),
    newCallerDecided: false,
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
    state.newCallerDecided = false;
    return true;
  }
  // A pass that found a function its callers decide did not yet read its calls as values.
  let changed = state.newCallerDecided;
  state.newCallerDecided = false;
  for (const [decl, { name, asked, perUse }] of state.demands) {
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
    // `f32` is what an undecided value already is: nothing to lower again. A call's own `f32`
    // use is a decision, which picks the copy of the function it calls.
    if (one === undefined || one === 'int') continue;
    if (one === 'f32') {
      if (perUse) {
        state.decided.set(decl, f32T);
        changed = true;
      }
      continue;
    }
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
  return states.get(sourceFile)?.decided.get(keyOf(decl));
}

/** The sentence of a declaration whose uses demand two types, if they do. */
export function inferenceConflict(sourceFile: ts.SourceFile, decl: ts.Node): string | undefined {
  return states.get(sourceFile)?.conflicts.get(keyOf(decl));
}

// ═══ Copies of a function its callers decide (Rule 8.19; Amendment A1, "사본마다 추론") ═══
//
// Each copy of such a function infers its own locals, and each call in it decides its own
// callee's copy: while a copy's body is lowered, a declaration in it is keyed by the
// declaration and the copy.

let copyTag: string | undefined;
const copyKeys = new WeakMap<ts.Node, Map<string, object>>();

/** The key of `decl` in the body being lowered: the declaration, or one object for each copy. */
export function keyOf(decl: ts.Node): object {
  if (copyTag === undefined) return decl;
  let byTag = copyKeys.get(decl);
  if (byTag === undefined) copyKeys.set(decl, (byTag = new Map()));
  let key = byTag.get(copyTag);
  if (key === undefined) byTag.set(copyTag, (key = { decl, copy: copyTag }));
  return key;
}

/** Runs `run` while the body of the copy `tag` is lowered; `undefined` for any other body. */
export function inCopy<T>(tag: string | undefined, run: () => T): T {
  const outer = copyTag;
  copyTag = tag;
  try {
    return run();
  } finally {
    copyTag = outer;
  }
}

/** The copy whose body is being lowered, if any. */
export function currentCopy(): string | undefined {
  return copyTag;
}

/** Records that the function `decl` returns a written number or a value no use has decided:
 *  from the next pass its callers decide its result. */
export function noteCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): void {
  const state = states.get(sourceFile);
  if (state === undefined || state.callerDecided.has(decl)) return;
  state.callerDecided.add(decl);
  state.newCallerDecided = true;
}

/** Whether an earlier pass found that the callers of the function `decl` decide its result. */
export function isCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): boolean {
  return states.get(sourceFile)?.callerDecided.has(decl) === true;
}

/** Every decision of this compile for the call `call`, one for each copy the call is lowered
 *  in, or for the call itself outside any copy. */
export function decisionsOfCall(sourceFile: ts.SourceFile, call: ts.Node): ShaderType[] {
  const state = states.get(sourceFile);
  if (state === undefined) return [];
  const out: ShaderType[] = [];
  const own = state.decided.get(call);
  if (own !== undefined) out.push(own);
  for (const key of copyKeys.get(call)?.values() ?? []) {
    const t = state.decided.get(key);
    if (t !== undefined) out.push(t);
  }
  return out;
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
  // use is refused where the `f32` use stands, once the value is the integer. A call of a
  // function its callers decide is the exception: its `f32` use picks the `f32` copy.
  if (asked === 'f32' && value.perUse !== true) return;
  const demand: Demand = soft && (asked === 'i32' || asked === 'u32') ? 'int' : asked;
  const key = value.key ?? value.decl;
  let entry = current.demands.get(key);
  if (entry === undefined) {
    current.demands.set(
      key,
      (entry = { name: value.name, asked: new Set(), perUse: value.perUse === true }),
    );
  }
  entry.asked.add(demand);
}

/** The value `expr` reads when it is the read of one whose type its uses decide (a name, a
 *  field, a call of a function its callers decide). */
export function inferredOfExpr(expr: Expr | undefined): InferredValue | undefined {
  return expr === undefined ? undefined : readByExpr.get(expr);
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

/** The `i32` a counted `for` gives its counter by default while its start or its bound reads a
 *  value no use has decided. It is an `i32` everywhere but here: as a peer it asks `int`, an
 *  integer of no kind, so the default does not decide that value (`for (let j = 0; j < n;
 *  j++)` with `n += vi` makes `n` a `u32`, and the next pass counts `j` in `u32`). */
export const counterDefaultI32: ShaderType = { kind: 'scalar', scalar: 'i32' };

/** Whether `expr` reads a value no use has decided yet, through arithmetic over reads and
 *  written numbers. */
export function readsUndecided(expr: Expr): boolean {
  return undecidedIn(expr).length > 0;
}

/** The demand a peer or a declared position of type `type` makes: its scalar, a vector's
 *  element scalar, `f64` for an emulated double; nothing for any other type. */
function demandOfType(type: ShaderType): Demand | undefined {
  if (type === counterDefaultI32) return 'int';
  if (type.kind === 'f64' || type.kind === 'vec64') return 'f64';
  if (type.kind === 'vec') return type.elem === 'f32' ? 'f32' : type.elem === 'i32' ? 'i32' : 'u32';
  const key = typeKey(type);
  return key === 'i32' || key === 'u32' || key === 'f32' ? key : undefined;
}

/** The origin a read of `value` carries when its uses made it an integer: a `/` over it whose
 *  operands have no declared type is refused, as a `/` over a constant that some read makes an
 *  integer is (decisions Q6 and Q11; `abstract-const.ts` reports it, with the edit it checks).
 *  One record for each declaration, for each type its uses gave it. */
const origins = new WeakMap<object, { key: string; carried: Carried }>();
export function inferredOrigin(value: InferredValue | undefined): Carried | undefined {
  if (value === undefined) return undefined;
  // The counter of a `for` that is not counted, which no use gives a type, reads as the `f32`
  // the compiler chooses. It was an `i32` on `main`, so a `/` over it does not say which
  // division it is, and is refused as a `/` over an integer is (the owner's decision of
  // 2026-11-11, "A2 우선: 거부"). Its edits keep the `i32` it had.
  const openCounter =
    value.type === undefined && isOpenCounter(value.decl.getSourceFile(), value.decl);
  if (value.type === undefined && !openCounter) return undefined;
  const key = value.type === undefined ? 'i32' : typeKey(value.type);
  if (key !== 'i32' && key !== 'u32') return undefined;
  const cacheKey = openCounter ? 'counter' : key;
  const cached = origins.get(value.key ?? value.decl);
  if (cached !== undefined && cached.key === cacheKey) return cached.carried;
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
    ...(openCounter ? { openCounter: true as const } : {}),
  };
  const carried: Carried = {
    reaches: [info],
    float: false,
    variable: {
      keyword: 'let',
      name: value.name,
      init: value.written ?? '',
      type: openCounter ? 'f32' : key,
    },
  };
  origins.set(value.key ?? value.decl, { key: cacheKey, carried });
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
