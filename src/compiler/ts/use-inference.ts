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
import type { Expr, FuncDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { f32T, f64T, i32T, u32T } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey } from './optional.js';
import { resetResultCopies } from './symbols.js';
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
  /** For such a read: the name of the function, which a refusal of a `/` over the call names,
   *  and which stands outside any `/` as the uses that decided the result do. */
  readonly function?: ts.Node;
  /** For such a read: an integer result some call of the function asks, which makes a `/` over
   *  any call of it refused, whichever copy the call takes. */
  readonly integerResult?: ShaderType;
  /** For such a read: the key of the function it calls (`calleeKeyOf`), so that a decision of
   *  the call reaches the function in the next pass. */
  readonly callee?: object;
  /** For such a read: no use of this call has decided it yet. It reads the result the function
   *  has (`type`), and its use is still recorded, so that a call in a body whose result another
   *  call fixed asks for its own copy. */
  readonly open?: true;
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
  demands: Map<
    object,
    { readonly name: string; readonly asked: Set<Demand>; perUse: boolean; callee?: object }
  >;
  /** The functions an earlier pass found returning a written number or a value of item 1
   *  (Rule 8.19): their callers decide their result. */
  readonly callerDecided: Set<ts.Node>;
  /** Whether the running pass found a new one. */
  newCallerDecided: boolean;
  /** The result types the calls of each function its callers decide asked, in the pass before
   *  and in the running one, by `calleeKeyOf`. */
  askedBefore: Map<object, Map<string, ShaderType>>;
  askedNow: Map<object, Map<string, ShaderType>>;
  /** Set for the last pass of a compile whose passes ran out (`switchCallersOff`). */
  callersOff: boolean;
  /** The functions `switchCallersOff` switched off: those no call had decided yet. */
  readonly off: Set<ts.Node>;
  /** Each call of one of them, with the function's name, for the sentence of a mismatch. */
  readonly offCalls: Map<ts.Node, string>;
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
    askedBefore: new Map(),
    askedNow: new Map(),
    callersOff: false,
    off: new Set(),
    offCalls: new Map(),
  });
}

/** Starts one pass: the demands of the pass before are forgotten. Returns what to hand
 *  {@link endUseInferencePass}. */
export function beginUseInferencePass(sourceFile: ts.SourceFile): State | undefined {
  const outer = current;
  const state = states.get(sourceFile);
  if (state !== undefined) {
    state.demands = new Map();
    state.askedBefore = state.askedNow;
    state.askedNow = new Map();
  }
  resetResultCopies(sourceFile);
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
  // A pass that found a function its callers decide did not yet read its calls as values, and
  // one whose calls asked other result types than the pass before made other copies.
  let changed = state.newCallerDecided;
  state.newCallerDecided = false;
  // A call's decision reaches the function it calls in the next pass at once, as if that pass
  // had lowered the call already: one pass a link of a chain of such functions.
  const decide = (decl: object, type: ShaderType, callee: object | undefined): void => {
    state.decided.set(decl, type);
    if (callee === undefined) return;
    let types = state.askedNow.get(callee);
    if (types === undefined) state.askedNow.set(callee, (types = new Map()));
    types.set(typeKey(type), type);
  };
  for (const [decl, { name, asked, perUse, callee }] of state.demands) {
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
      // A call's own `f32` use picks the function's `f32`, which it has unless another call
      // asks another type: it lowers nothing again by itself (the comparison below).
      if (perUse) decide(decl, f32T, callee);
      continue;
    }
    decide(decl, TYPE_OF[one], callee);
    changed = true;
  }
  return changed || !sameAsked(state.askedBefore, state.askedNow);
}

/** The result types a function's calls asked, with a set of `f32` alone read as none: the
 *  function has the `f32` already, so such a set changes nothing. */
function askedTypes(
  map: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
  key: object,
): ReadonlySet<string> {
  const types = map.get(key);
  if (types === undefined || (types.size === 1 && types.has('f32'))) return new Set();
  return new Set(types.keys());
}

function sameAsked(
  a: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
  b: ReadonlyMap<object, ReadonlyMap<string, ShaderType>>,
): boolean {
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = askedTypes(a, key);
    const y = askedTypes(b, key);
    if (x.size !== y.size || [...x].some((k) => !y.has(k))) return false;
  }
  return true;
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
 *  its callers decide its result. A call of it lowered after this, in this pass too, reads as a
 *  value no use has decided, so a function that returns such a call is found in the same pass. */
export function noteCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): void {
  const state = states.get(sourceFile);
  if (state === undefined || state.callerDecided.has(decl)) return;
  state.callerDecided.add(decl);
  state.newCallerDecided = true;
}

/** Whether the callers of the function `decl` decide its result: found in this pass or an
 *  earlier one, and not switched off after the passes ran out (`MAX_INFERENCE_PASSES`). */
export function isCallerDecided(sourceFile: ts.SourceFile, decl: ts.Node): boolean {
  const state = states.get(sourceFile);
  return state !== undefined && !state.off.has(decl) && state.callerDecided.has(decl);
}

/** Switches off, for the last pass of a compile whose passes ran out, each function whose calls
 *  decide its result and that no call has given a type yet: it takes its first
 *  `return`'s type, as before change 0134, and a function its calls did decide keeps that type. */
export function switchCallersOff(sourceFile: ts.SourceFile): void {
  const state = states.get(sourceFile);
  if (state === undefined) return;
  state.callersOff = true;
  const decided = new Set<ts.Node>();
  // A function whose calls asked only `f32` is decided too: it keeps the `f32` it has.
  for (const [key, types] of state.askedNow) {
    if (types.size > 0) decided.add((key as { node: ts.Node }).node);
  }
  for (const node of state.callerDecided) if (!decided.has(node)) state.off.add(node);
}

/** Each call of a function `switchCallersOff` switched off, with the function's name. */
export function switchedOffCalls(sourceFile: ts.SourceFile): ReadonlyMap<ts.Node, string> {
  return states.get(sourceFile)?.offCalls ?? new Map();
}

/** Whether `switchCallersOff` ran for this compile. */
export function callersSwitchedOff(sourceFile: ts.SourceFile): boolean {
  return states.get(sourceFile)?.callersOff === true;
}

const calleeKeys = new WeakMap<ts.Node, Map<string, object>>();

/** The key of one function its callers decide across the passes: its declaration, and for an
 *  instance of a generic function its instance (Rule 8.9: its copies are per instance). */
export function calleeKeyOf(node: ts.Node, instance = ''): object {
  let byInstance = calleeKeys.get(node);
  if (byInstance === undefined) calleeKeys.set(node, (byInstance = new Map()));
  let key = byInstance.get(instance);
  if (key === undefined) byInstance.set(instance, (key = { node, instance }));
  return key;
}

/** The result types the calls of the function `key` asked in the pass before this one, by type
 *  key: what decides its result and its copies now. */
export function askedOf(sourceFile: ts.SourceFile, key: object): ReadonlyMap<string, ShaderType> {
  return states.get(sourceFile)?.askedBefore.get(key) ?? new Map();
}

/** One function its callers decide, as one pass lowers it. */
interface CallerDecidedInfo {
  /** The name a message and the hover give it. */
  readonly name: string;
  /** Its name in its declaration, which a refusal of a `/` over a call of it names. */
  readonly node: ts.Node;
  /** The function as written, which `noteCallerDecided` marks. */
  readonly decl: ts.Node;
  readonly key: object;
  /** The copy that returns `type`, made the first time a call asks for it. */
  readonly copyFor: (type: ShaderType) => FuncDecl | undefined;
}
const callerDecidedStubs = new WeakMap<FuncDecl, CallerDecidedInfo>();

/** Registers `stub`, a function its callers may decide, for this pass: its calls read as values
 *  once `noteCallerDecided` marks it, in this pass or an earlier one. */
export function registerCallerDecided(stub: FuncDecl, info: CallerDecidedInfo): void {
  callerDecidedStubs.set(stub, info);
}

/** The function a call of `decl` at `call` calls, and the record its read is marked with, when
 *  the callers of `decl` decide its result (Rule 8.19, change 0134 item 1): the copy whose result
 *  the call's own use decided, else the function itself. */
export function callerDecidedCall(
  decl: FuncDecl,
  call: ts.Node,
  sourceFile: ts.SourceFile,
): { readonly target: FuncDecl; readonly value: InferredValue } | undefined {
  const info = callerDecidedStubs.get(decl);
  const state = states.get(sourceFile);
  if (info === undefined || state === undefined) return undefined;
  if (state.off.has(info.decl)) {
    state.offCalls.set(call, info.name);
    return undefined;
  }
  if (!state.callerDecided.has(info.decl)) return undefined;
  const key = keyOf(call);
  const asked = state.decided.get(key);
  if (asked !== undefined) {
    let types = state.askedNow.get(info.key);
    if (types === undefined) state.askedNow.set(info.key, (types = new Map()));
    types.set(typeKey(asked), asked);
  }
  const before = state.askedBefore.get(info.key);
  const target =
    asked === undefined || typeKey(asked) === typeKey(decl.ret)
      ? decl
      : (info.copyFor(asked) ?? decl);
  // Once the calls decided the function, a call that decides nothing reads the result it has.
  const type = asked !== undefined || (before?.size ?? 0) > 0 ? target.ret : undefined;
  // A `/` over a call of a function that has an integer copy does not say which division it is,
  // whichever copy the call takes (the owner's decision of 2026-11-11, "거부 유지").
  const integer = [...(before?.values() ?? []), ...(asked !== undefined ? [asked] : [])].find(
    (t) => typeKey(t) === 'i32' || typeKey(t) === 'u32',
  );
  return {
    target,
    value: {
      decl: call,
      key,
      name: info.name,
      perUse: true,
      function: info.node,
      callee: info.key,
      written: `${info.name}()`,
      ...(type !== undefined ? { type } : {}),
      ...(type !== undefined && asked === undefined ? { open: true as const } : {}),
      ...(integer !== undefined ? { integerResult: integer } : {}),
    },
  };
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
      // A call that no use decided yet reads its function's result, and its use still asks.
      const open = read.type === undefined || read.open === true;
      if (open) out.push(read);
      return open;
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

let quiet = false;

/** Runs `run` with no demand recorded: the peer it retargets against has no type of its own. */
export function quietDemands<T>(run: () => T): T {
  const outer = quiet;
  quiet = true;
  try {
    return run();
  } finally {
    quiet = outer;
  }
}

function record(value: InferredValue, asked: Demand): void {
  if (current === undefined || quiet || (value.type !== undefined && value.open !== true)) return;
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
      (entry = {
        name: value.name,
        asked: new Set(),
        perUse: value.perUse === true,
        ...(value.callee !== undefined ? { callee: value.callee } : {}),
      }),
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
  const own = value.integerResult ?? value.type;
  if (own === undefined && !openCounter) return undefined;
  const key = own === undefined ? 'i32' : typeKey(own);
  if (key !== 'i32' && key !== 'u32') return undefined;
  const cacheKey = openCounter ? 'counter' : key;
  const cached = origins.get(value.key ?? value.decl);
  if (cached !== undefined && cached.key === cacheKey) return cached.carried;
  // A `let` or a module variable is written `let`, a static field `static`, a field with no
  // keyword; a call of a function its callers decide names the function, whose result the
  // edit does not declare (`function`).
  const decl = value.decl as ts.VariableDeclaration | ts.PropertyDeclaration;
  const keyword: AbstractConst['keyword'] =
    value.function !== undefined
      ? 'function'
      : ts.isPropertyDeclaration(decl)
        ? decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) === true
          ? 'static'
          : ''
        : 'let';
  const nameNode = value.function ?? decl.name;
  const info: AbstractConst = {
    // A call is named as the author wrote it: `g()`, `c.m()`, and `c.m` for a getter's read.
    name:
      value.function !== undefined
        ? value.decl.getText(value.decl.getSourceFile()).replace(/\s+/g, ' ')
        : value.name,
    value: Number.NaN,
    integerWritten: true,
    keyword,
    nameNode,
    written: value.written ?? '',
    sources: [],
    // Its uses are the other read that makes it an integer: they stand outside any `/`.
    integerReads: [{ type: key, node: nameNode as ts.Expression }],
    ...(openCounter ? { openCounter: true as const } : {}),
  };
  const carried: Carried = {
    reaches: [info],
    float: false,
    ...(keyword === 'function'
      ? {}
      : {
          variable: {
            keyword,
            name: value.name,
            init: value.written ?? '',
            type: openCounter ? 'f32' : key,
          },
        }),
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
