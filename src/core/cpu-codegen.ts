// ═══ Shader DSL — CPU (f64) js-source backend ═══
//
// The perf-critical twin of the tree-walk interpreter (oracle.ts). Same IR,
// same op-library (cpu-runtime.ts), but instead of RE-WALKING the IR on every
// call it walks the IR ONCE at compile time and emits a JS source string per
// fn, then `new Function`s it. The recursive per-node `evalExpr` dispatch + the
// per-`call` argument-array allocation (the ~40 %-of-frame / GC-churn hot spot
// the profile flagged at high pitch, X-GIS #1162) collapse into straight-line JS with
// real local variables.
//
// ─── BIT-IDENTITY CONTRACT (the whole point) ───
// compileModuleJs(m).fns.f(args) === compileModule(m).fns.f(args), Object.is per
// element, for ALL inputs. This holds BY CONSTRUCTION, not by tuning:
//   • the emitted code runs the IDENTICAL op tree in doubles, with a `Math.fround`
//     exactly where the IR has an `__fround` (the f32 precision pass) and nowhere
//     else;
//   • scalar arithmetic is inlined to the same JS operators scalarBin uses
//     (`+ - * / %`, `>>> 0`-normalised bitwise, i32-aware `>>`);
//   • it is TYPE-DIRECTED (#410): the IR types every expression, so a vector
//     operation of a known width is written out one component at a time, each
//     component the scalar operation the shared helper (applyBin, compareValues,
//     selectComponents, the vector constructor) applies to it, and each
//     per-component builtin calls the one scalar function its BUILTINS entry
//     applies per component (`COMPONENTWISE`, cpu-runtime.ts). `dot`, `length`,
//     `distance`, `normalize` and `cross` are written out term by term in the
//     order their BUILTINS entries sum. Everything else (matrices, the other
//     builtins) calls the SAME cpu-runtime helper the interpreter calls, bound
//     once at the top of the factory rather than looked up per call;
//   • it keeps the interpreter's evaluation order: an operand with an effect, or
//     one evaluated before one, is evaluated once, in order, into a temporary,
//     and its components read afterwards, as the helper reads them (`isPure`);
//   • consts embed their cpuValue / evaluate their valueExpr through the same
//     op tree; literals embed round-trip-exact (incl. -0 / NaN / ±Infinity);
//   • the flat per-call env is modelled as function-scope JS locals (one JS var
//     per distinct IR name — same clobber semantics as the interpreter's single
//     Map), and value references (number[] vectors, struct objects) are shared
//     exactly as the interpreter shares them, so member-mutation aliasing is
//     preserved rather than approximated. A value built by the generated code
//     itself is new, and is stored without the copy a shared one takes.
// cpu-codegen.test.ts differential-gates this over every construct in both
// precisions; the map package gates it over the whole PROJECTION_MODULE with
// boundary + seeded-random sweeps. The f64-ALGEBRA caveat (oracle.ts header)
// applies verbatim — this is still NOT an f32 GPU-precision oracle.
//
// HYBRID FALLBACK: if a fn body hits an IR construct that cannot be emitted
// semantically-identically (raw/placeholder Stmt, an lvalue shape with no
// expression form), that ONE fn falls back to the interpreter (the module is a
// hybrid); the rest still run compiled. A `new Function` failure (a CSP
// `unsafe-eval` host) throws so the caller can fall the whole module back to the
// interpreter.

import type {
  Expr,
  Stmt,
  ModuleDecl,
  StructDecl,
  ShaderType,
  BinOp,
  CmpOp,
  FuncDecl,
} from './ir/index.js';
import { eachExpr, eachStmtExpr } from './ir/visit.js';
import { validate } from './passes/validate.js';
import { autoVars } from './passes/opt/index.js';
import { froundF32 } from './passes/precision.js';
import { treeCombine, treeLoops, type LoopReduction } from './passes/parallel-loop.js';
import { treeIdentity } from './kernel-tree.js';
import type { CpuPrecision } from './oracle.js';
import { consoleTableRows, type ConsoleSink } from './console.js';
import {
  type CpuValue,
  type NumKind,
  type Componentwise,
  FIELD_IDX,
  BUILTINS,
  COMPONENTWISE,
  GPU_STUBS,
  numKindOf,
  copiedParams,
  isAggregateType,
  elemKindOf,
  zeroOf,
  comparesAsF32,
  TYPED_BIT_BUILTINS,
} from './cpu-runtime.js';
import { compileModule, type CpuModule } from './oracle.js';
import { isAtomicIntrinsic, isBarrierIntrinsic } from './intrinsics.js';
import { fnWrites } from './passes/effects.js';
import { dispatchCompute } from './debug/dispatch.js';
import { createCodegenRuntime, type CodegenRuntime } from './cpu-codegen-runtime.js';

/** Sentinel: a per-fn body used an IR construct the codegen can't emit
 *  bit-identically. Caught by compileModuleJs → that fn falls back to the
 *  interpreter (hybrid module). Never escapes this module. */
class CodegenUnsupported extends Error {}

const q = (s: string): string => JSON.stringify(s);

/** Emit a JS numeric/boolean literal that reads back to the EXACT same value.
 *  ECMAScript Number→string (radix 10) is the shortest round-trip form, so
 *  String(finite) parses back identically; -0 / NaN / ±Infinity are handled
 *  explicitly (String(-0) === "0" would lose the sign). */
function jsNum(v: number | boolean): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

/** A value whose runtime shape is number[] (interpreter `isArr(v)` true):
 *  vec / vec64 / mat / array. Scalars, f64 (a native JS number here), bool are not. */
function isArrayValued(t: ShaderType): boolean {
  return t.kind === 'vec' || t.kind === 'vec64' || t.kind === 'mat' || t.kind === 'array';
}
const isF32 = (t: ShaderType): boolean => t.kind === 'scalar' && t.scalar === 'f32';
/** An `f32` or a vector of them: what the precision pass rounds (`passes/precision.ts`). */
const isF32ish = (t: ShaderType): boolean => isF32(t) || (t.kind === 'vec' && t.elem === 'f32');

/** The zero value literal for a `var` with no initializer — mirrors
 *  cpu-runtime `zeroOf` (vec/vec64 → N zeros, mat → N² zeros, struct → every field zeroed
 *  recursively, array → N zeros of its element, bool → false, everything else → 0). The two
 *  must agree exactly: the interpreter and this generator are the two CPU backends, and a
 *  `var` that starts as `0` in one and as `[0, 0, 0]` in the other is the bit-identity
 *  contract broken at the declaration. The array, bool and struct arms all arrived with #8
 *  A10, which gave the source language the init-less declaration that reaches them. */
function zeroLit(t: ShaderType, structs: ReadonlyMap<string, StructDecl>): string {
  if (t.kind === 'vec' || t.kind === 'vec64') return `new Array(${t.n}).fill(0)`;
  // A matrix is a flat column-major component list: cols * rows, not n squared.
  if (t.kind === 'mat') return `new Array(${t.cols * t.rows}).fill(0)`;
  // Field by field, exactly as the interpreter's `zeroOf` builds it: the old `{}` left every
  // field absent, so `let s: S;` then `s.a` read `undefined` here and on the interpreter
  // alike, where WGSL's `var s: S;` reads 0. Recursion covers a nested struct and an array of
  // structs. An undeclared struct name keeps `{}`, the same fallback `zeroOf` takes.
  if (t.kind === 'struct') {
    const decl = structs.get(t.name);
    if (decl === undefined) return '{}';
    const fields = decl.fields.map((f) => `${q(f.name)}: ${zeroLit(f.type, structs)}`);
    return `{${fields.join(', ')}}`;
  }
  if (t.kind === 'array') {
    return `[${Array.from({ length: t.size ?? 0 }, () => zeroLit(t.elem, structs)).join(', ')}]`;
  }
  if (t.kind === 'scalar' && t.scalar === 'bool') return 'false';
  return '0';
}

/** Module-scope codegen state shared by every fn. */
interface ModCtx {
  structs: Map<string, StructDecl>;
  /** const name → its JS local id in the factory (`$C_<i>`). */
  constId: Map<string, string>;
  /** override name → its JS local id in the factory (`$O_<i>`). */
  overrideId: Map<string, string>;
  /** The names the module actually declares as functions, so a call the front end resolved
   *  to one (`declRef`) can be routed to it rather than to a builtin of the same name. */
  fnNames: Set<string>;
  /** The module variables (roadmap 0.2 item 5), read and written through `$.vars`. */
  varNames: Set<string>;
  /** The resource bindings, so a write to one that no local shadows lands in `$.bindings`
   *  where the host reads it, the way the interpreter's `setLValue` writes it. */
  bindingNames: Set<string>;
  /** Each declared function's parameters, for a call to store back what its `inout`
   *  parameters hold as it returns (`inoutReturn`, cpu-runtime.ts). */
  params: Map<string, FuncDecl['params']>;
  /** The loops a kernel function's reduction is combined in the tree order by (Rule 7.2),
   *  and whether an `f32` combine rounds. */
  trees: ReadonlyMap<Stmt, readonly LoopReduction[]>;
  f32: boolean;
  /** What the factory binds once for every function ({@link bound}): the name of each
   *  right-hand side, keyed by its source. */
  bound: Map<string, string>;
  /** {@link isPure}'s answers, by expression. */
  pure: WeakMap<Expr, boolean>;
}

/** Per-fn codegen state: the flat env → JS locals mapping + the hoist list. */
interface FnCtx {
  mod: ModCtx;
  /** IR name (param OR let/var) → JS identifier. Params pre-seeded to `$a<i>`;
   *  a `let`/`var` of a NEW name allocates `$v<n>` (hoisted). A repeat name maps
   *  to the SAME id — the interpreter's single flat Map has no shadowing, so
   *  same-name = same slot here too. */
  varId: Map<string, string>;
  /** `$v` locals to declare at the top of the fn body (function-scope, flat). */
  hoisted: string[];
  n: number;
  /** For a function with an `inout` parameter, the statement that publishes what its
   *  parameters hold as it returns (`$.inout.values = [...]`), run at every return. */
  inoutPublish?: string;
  /** The parameters rounded to `f32` once, as the function is entered (`$p<i>`, one name per
   *  component of a vector), by name. The precision pass's rounding of a read of one
   *  (`__fround(p)`) reads these instead of rounding the parameter again. */
  rounded: Map<string, readonly string[]>;
}

/** A fresh JS temporary for the function, declared with the others at its top. */
function tempVar(S: FnCtx): string {
  const id = `$t${S.n++}`;
  S.hoisted.push(id);
  return id;
}

/** A call's source, followed by storing what each of the callee's `inout` parameters holds as
 *  it returned into the variable passed there, as the interpreter's `storeBack` does. Only a
 *  variable: a field or an element reaches a struct the callee wrote in place. */
function storeBackJs(call: Expr & { op: 'call' }, callSrc: string, S: FnCtx): string {
  const params = S.mod.params.get(call.fn);
  if (params === undefined || !params.some((p) => p.mode === 'inout')) return callSrc;
  const stores: string[] = [];
  params.forEach((p, i) => {
    const arg = call.args[i];
    if (p.mode !== 'inout' || arg === undefined) return;
    if (arg.op === 'varref' || arg.op === 'param') {
      stores.push(emitAssignExpr(arg, `$.inout.values[${i}]`, S));
    }
  });
  if (stores.length === 0) return callSrc;
  const t = tempVar(S);
  return `(${t} = ${callSrc}, ${stores.join(', ')}, ${t})`;
}

function declareVar(name: string, S: FnCtx): string {
  let id = S.varId.get(name);
  if (id === undefined) {
    id = `$v${S.n++}`;
    S.varId.set(name, id);
    S.hoisted.push(id);
  }
  return id;
}

function readVar(name: string, S: FnCtx): string {
  const id = S.varId.get(name);
  if (id !== undefined) return id;
  if (S.mod.varNames.has(name)) return `$.vars[${q(name)}]`;
  // Not a param/local ⇒ a storage/uniform binding (setBinding). The interpreter
  // resolves env first, then ctx.bindings; a declared local always shadows.
  return `$.bindings[${q(name)}]`;
}

// ─── Expressions ─────────────────────────────────────────────────────────────────────────────
//
// Type-directed (#410). The runtime helpers learn a vector's width and a scalar's kind from the
// value on every call (`applyBin` maps over its operand, `BUILTINS.floor` checks whether it was
// handed an array); the IR already says both, so a vector the generator can build per
// component is written as one scalar expression per component ({@link Lanes}), and only the
// whole vector a statement, a call or a return needs is ever allocated. A component reads the
// components of its operands directly: `q.xy - g.xy` is `[q[0] - g[0], q[1] - g[1]]`.
//
// A component is computed separately, in any order, and only where it is read, so this is done
// only where no effect can tell: for an expression {@link isPure} holds of. An operand with an
// effect, and every operand before one, is evaluated in order into a temporary, and its
// components read from there once all the operands are evaluated, which is when the runtime
// helper reads them ({@link operands}).

/** One expression, as the JavaScript that evaluates it. */
interface Js {
  /** Evaluates the expression once, where the IR evaluates it. */
  readonly js: string;
  /** Costs nothing and has no effect: a literal, a constant, a local, a parameter, a temporary,
   *  or one of their components at a fixed index. It may be written more than once. */
  readonly atom?: boolean;
  /** Holds one value for the whole call: a literal, a module constant or override, a parameter
   *  rounded at entry, or a component of one. */
  readonly stable?: boolean;
  /** A new array or object, nested ones included, that nothing else holds: a store keeps it
   *  without the copy it makes of a shared one. */
  readonly fresh?: boolean;
  /** A number `Math.fround` returns unchanged, so rounding it again is left out. */
  readonly rounded?: boolean;
  /** The number a literal holds, which a rounding of it folds. */
  readonly num?: number;
}

/** A vector-valued expression as one scalar expression per component, each without an effect,
 *  to be read after the assignments in `pre` have run, in order. */
interface Lanes {
  readonly pre: readonly string[];
  readonly comps: readonly Js[];
}

type Call = Extract<Expr, { op: 'call' }>;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** `s`, after the assignments in `pre`, as one expression. */
const seq = (pre: readonly string[], s: string): string =>
  pre.length === 0 ? s : `(${[...pre, s].join(', ')})`;

/** `base[key]`, parenthesising `base` unless it is a name. */
const keyed = (base: string, key: string): string =>
  /^[\w$]+$/.test(base) ? `${base}[${key}]` : `(${base})[${key}]`;

/** A vector as an array literal of its components. */
const arrayOf = (l: Lanes): Js => ({
  js: seq(l.pre, `[${l.comps.map((c) => c.js).join(', ')}]`),
  fresh: true,
});

/** A literal. A number carries its value, which a rounding folds. */
function litJs(v: number | boolean): Js {
  if (typeof v === 'boolean') return { js: jsNum(v), atom: true, stable: true };
  return { js: jsNum(v), atom: true, stable: true, num: v, rounded: Object.is(Math.fround(v), v) };
}

/** How many components the runtime holds a value of `t` as, one number or bool each: a vector
 *  of any element, or an emulated-double vector. Undefined for any other type. */
function widthOf(t: ShaderType | undefined): number | undefined {
  return t !== undefined && (t.kind === 'vec' || t.kind === 'vec64') ? t.n : undefined;
}
/** A type the runtime holds as one number or bool, which a vector operation hands every
 *  component. */
const isScalar = (t: ShaderType): boolean => t.kind === 'scalar' || t.kind === 'f64';
/** An operand an operation of `n` components reads per component: a vector of `n`, or a
 *  scalar. */
const fits = (t: ShaderType, n: number): boolean => widthOf(t) === n || isScalar(t);

/** The name the factory binds `rhs` to, once for the module: `Math.fround` as `$fr`, and a
 *  builtin or a runtime helper as `$h<k>`, so a call reads a local of the factory where it
 *  used to look the function up every time. */
function bound(S: FnCtx, rhs: string): string {
  const table = S.mod.bound;
  let id = table.get(rhs);
  if (id === undefined) {
    id = rhs === 'Math.fround' ? '$fr' : `$h${table.size}`;
    table.set(rhs, id);
  }
  return id;
}

/** The runtime helpers the generated code calls through a binding: plain functions that read
 *  no `this`. (`console` reads the runtime's `invocation`, and the tables are written.) */
type Helper =
  | 'applyBin'
  | 'matVecShaped'
  | 'matMulShaped'
  | 'vecMatShaped'
  | 'matColumn'
  | 'matTransposeShaped'
  | 'setMatColumn'
  | 'splat'
  | 'swiz'
  | 'negVec'
  | 'wrap'
  | 'cmpVec'
  | 'bit'
  | 'selVec'
  | 'u32Sat'
  | 'i32Sat'
  | 'intDiv'
  | 'intRem'
  | 'clone'
  | 'cvt'
  | 'cvtVec';
const helper = (S: FnCtx, name: Helper & keyof CodegenRuntime): string => bound(S, `$.${name}`);

/** `v` rounded to f32, as `Math.fround` rounds it: a literal's value folded, a value already
 *  rounded left as it is. */
function rounded(v: Js, S: FnCtx): Js {
  if (v.rounded) return v;
  if (v.num !== undefined) return litJs(Math.fround(v.num));
  return { js: `${bound(S, 'Math.fround')}(${v.js})`, rounded: true };
}

/** `v`, or a temporary assigned it in `pre`: a value read more than once is computed once. */
function atomize(v: Js, S: FnCtx, pre: string[]): Js {
  if (v.atom) return v;
  const t = tempVar(S);
  pre.push(`${t} = ${v.js}`);
  return { js: t, atom: true, rounded: v.rounded };
}

/** `js` negated. A `-` straight after another would read as a decrement. */
const negate = (js: string): string => (js.startsWith('-') ? `(-(${js}))` : `(-${js})`);

/** A number `js` wrapped into the integer kind `kind`, as `wrapInt` wraps it. */
const wrapNum = (js: string, kind: NumKind): string =>
  kind === 'f32' ? js : kind === 'i32' ? `(${js} | 0)` : `(${js} >>> 0)`;

/** `js`, a value of type `t`, wrapped into its integer type as the interpreter's `wrapValue`
 *  does: inline for a scalar, through the runtime for a vector. A float type is left alone. */
function wrapped(js: string, t: ShaderType, S: FnCtx): string {
  const kind = numKindOf(t);
  if (kind === 'f32') return js;
  if (isArrayValued(t)) return `${helper(S, 'wrap')}(${js}, ${q(kind)})`;
  return wrapNum(js, kind);
}

/** `terms` added up from 0 in order, the way `reduce((s, t) => s + t, 0)` adds them. */
const sumOf = (terms: readonly string[]): string => terms.reduce((s, t) => `(${s} + ${t})`, '0');

/** The per-component builtin `name`, if it is one. */
function componentwiseOf(name: string): Componentwise | undefined {
  return Object.hasOwn(COMPONENTWISE, name)
    ? (COMPONENTWISE as Readonly<Record<string, Componentwise>>)[name]
    : undefined;
}

/** Where a call goes, decided in the interpreter's order (oracle.ts, `evalExpr`'s `call`). */
type CallKind =
  | 'barrier'
  | 'atomic'
  | 'console'
  | 'saturate'
  | 'transpose'
  | 'bits'
  | 'module'
  | 'builtin'
  | 'stub';

function callKind(e: Call, S: FnCtx): CallKind {
  const intrinsic = e.declRef === undefined;
  if (intrinsic && isBarrierIntrinsic(e.fn)) return 'barrier';
  if (intrinsic && isAtomicIntrinsic(e.fn)) return 'atomic';
  if (intrinsic && e.fn.startsWith('console.')) return 'console';
  // f32→u32/i32 SATURATES per WGSL — the SAME static-type branch the interpreter takes
  // (oracle.ts 'call'), baked at compile time so the twins stay bit-identical. Integer sources
  // fall through to the wrapping BUILTINS forms.
  if (e.fn === 'u32' || e.fn === 'i32') {
    const src = e.args[0]!.type;
    if (src.kind === 'f64' || (src.kind === 'scalar' && src.scalar === 'f32')) return 'saturate';
  }
  // `transpose` needs the matrix's SHAPE, baked in here from the static type: a flat
  // column-major list cannot tell a mat2x3 from a mat3x2, and `BUILTINS.transpose` recovers its
  // dimension from the array length, which is only right for a square one (#149).
  if (intrinsic && e.fn === 'transpose' && e.args[0]!.type.kind === 'mat') return 'transpose';
  // A bit builtin whose value depends on the argument's kind (§10) takes the static kind.
  if (intrinsic && TYPED_BIT_BUILTINS.has(e.fn)) return 'bits';
  // A call the front end resolved to a declared function (`declRef`) goes to that function,
  // which is what the emitted shader calls; the interpreter makes the same choice.
  if (!intrinsic && S.mod.fnNames.has(e.fn)) return 'module';
  if (BUILTINS[e.fn]) return 'builtin';
  if (GPU_STUBS[e.fn]) return 'stub';
  // A module function, dispatched through $.F so a compiled fn can call one that fell back to
  // the interpreter (and vice versa).
  return 'module';
}

/** Whether evaluating `e` has no effect, and reads nothing an effect elsewhere in the same
 *  expression could change: no call of a module function, no atomic, barrier, `console` or
 *  GPU-stub call. Such an expression may be evaluated in pieces, in any order, and each piece
 *  only where it is read. */
function isPure(e: Expr, S: FnCtx): boolean {
  const memo = S.mod.pure;
  const hit = memo.get(e);
  if (hit !== undefined) return hit;
  const p = (x: Expr): boolean => isPure(x, S);
  let pure: boolean;
  switch (e.op) {
    case 'lit':
    case 'constref':
    case 'overrideref':
    case 'param':
    case 'varref':
      pure = true;
      break;
    case 'externref':
      pure = false;
      break;
    case 'binop':
    case 'compare':
    case 'logical':
      pure = p(e.a) && p(e.b);
      break;
    case 'unop':
      pure = p(e.a);
      break;
    case 'member':
      pure = p(e.base);
      break;
    case 'index':
      pure = p(e.base) && p(e.idx);
      break;
    case 'construct':
      pure = e.args.every(p);
      break;
    case 'select':
      pure = p(e.cond) && p(e.ifTrue) && p(e.ifFalse);
      break;
    case 'matchExpr':
      pure = p(e.scrutinee) && e.cases.every(([, v]) => p(v)) && p(e.default);
      break;
    case 'call': {
      const k = callKind(e, S);
      pure =
        (k === 'saturate' ||
          k === 'transpose' ||
          k === 'bits' ||
          (k === 'builtin' && Object.hasOwn(BUILTINS, e.fn))) &&
        e.args.every(p);
      break;
    }
  }
  memo.set(e, pure);
  return pure;
}

/** The parameter rounded at entry that `__fround(a)`, of type `t`, reads, when `a` is one and
 *  both have its shape: its names, one per component. */
function roundedParam(a: Expr, t: ShaderType, S: FnCtx): readonly string[] | undefined {
  if (a.op !== 'param') return undefined;
  const ids = S.rounded.get(a.name);
  if (ids === undefined) return undefined;
  const n = widthOf(a.type);
  const fitsIds =
    n === undefined
      ? isScalar(a.type) && isScalar(t) && ids.length === 1
      : widthOf(t) === n && ids.length === n;
  return fitsIds ? ids : undefined;
}

/** Whether `e` evaluates to the same value wherever in its expression it is read: a literal, a
 *  module constant or override, or the rounding of a literal or of a parameter rounded at
 *  entry. */
function isStable(e: Expr, S: FnCtx): boolean {
  if (e.op === 'lit' || e.op === 'constref' || e.op === 'overrideref') return true;
  if (e.op !== 'call' || e.fn !== '__fround' || e.args.length !== 1) return false;
  if (callKind(e, S) !== 'builtin') return false;
  const a = e.args[0]!;
  return a.op === 'lit' || roundedParam(a, e.type, S) !== undefined;
}

/** The operands of an operation that reads them per component, each as its components (one for
 *  a scalar), with the assignments to run first. An operand with an effect, and every operand
 *  before one, is evaluated here, in order, into a temporary, and read from there after all of
 *  them are evaluated, when the runtime helper reads it: a local a later call writes is read as
 *  it was, and an array a later call changes in place as it is then. The operands after the
 *  last such one have no effect and are read per component. A scalar every component reads
 *  (`broadcast`) is computed once. */
function operands(
  ops: readonly Expr[],
  S: FnCtx,
  broadcast = true,
): { pre: string[]; parts: Js[][] } {
  let last = -1;
  ops.forEach((o, j) => {
    if (!isPure(o, S)) last = j;
  });
  const pre: string[] = [];
  const parts = ops.map((o, j): Js[] => {
    const w = widthOf(o.type);
    if (j <= last && !isStable(o, S)) {
      const v = emit(o, S);
      const t = tempVar(S);
      pre.push(`${t} = ${v.js}`);
      if (w === undefined) return [{ js: t, atom: true, rounded: v.rounded }];
      return range(w).map((i) => ({ js: `${t}[${i}]`, atom: true }));
    }
    if (w !== undefined) {
      const l = lanesOf(o, w, S);
      pre.push(...l.pre);
      return [...l.comps];
    }
    const v = emit(o, S);
    return [broadcast ? atomize(v, S, pre) : v];
  });
  return { pre, parts };
}

/** An operation of `n` components over `ops`, each a vector of `n` read per component or a
 *  scalar every component reads: component `i` is `f` of the operands' component `i`. */
function lanewise(ops: readonly Expr[], n: number, S: FnCtx, f: (xs: readonly Js[]) => Js): Lanes {
  const { pre, parts } = operands(ops, S);
  const comps = range(n).map((i) =>
    f(parts.map((p, j) => (widthOf(ops[j]!.type) === undefined ? p[0]! : p[i]!))),
  );
  return { pre, comps };
}

/** The components of `e`, a vector of `n`: built per component where the generator knows how
 *  ({@link ownLanes}), read from the evaluated array otherwise. */
function lanesOf(e: Expr, n: number, S: FnCtx): Lanes {
  const own = ownLanes(e, n, S);
  if (own !== undefined) return own;
  const v = emit(e, S);
  if (v.atom) {
    return {
      pre: [],
      comps: range(n).map((i) => ({ js: keyed(v.js, String(i)), atom: true, stable: v.stable })),
    };
  }
  const t = tempVar(S);
  return {
    pre: [`${t} = ${v.js}`],
    comps: range(n).map((i) => ({ js: `${t}[${i}]`, atom: true })),
  };
}

/** `e`, a vector of `n` components, built one component at a time, or undefined for an
 *  expression the generator leaves to the runtime. Decided from the types before anything is
 *  emitted, so an undefined answer leaves `S` as it was. */
function ownLanes(e: Expr, n: number, S: FnCtx): Lanes | undefined {
  switch (e.op) {
    case 'binop': {
      // Component-wise, with a scalar broadcast, as `applyBin` computes it; the matrix
      // products take a matrix, which no component of this reads.
      if (widthOf(e.a.type) === undefined && widthOf(e.b.type) === undefined) return undefined;
      if (!fits(e.a.type, n) || !fits(e.b.type, n)) return undefined;
      const kind = numKindOf(e.type);
      return lanewise([e.a, e.b], n, S, ([a, b]) => ({
        js: emitScalarBin(e.bop, a!.js, b!.js, kind, S),
      }));
    }
    case 'unop': {
      if (widthOf(e.a.type) !== n) return undefined;
      const kind = numKindOf(e.type);
      return lanewise([e.a], n, S, ([a]) => ({ js: wrapNum(negate(a!.js), kind) }));
    }
    case 'compare': {
      // Two vectors, componentwise into a vector of bools (§27), as `compareValues`.
      if (widthOf(e.a.type) !== n || widthOf(e.b.type) !== n) return undefined;
      const f32 = comparesAsF32(e.a.type);
      return lanewise([e.a, e.b], n, S, ([a, b]) => ({ js: compareJs(e.cop, a!, b!, f32, S) }));
    }
    case 'select': {
      // A vector-of-bools condition picks per component, every operand evaluated, as
      // `selectComponents`. A scalar one evaluates one arm only and is left whole.
      if (widthOf(e.cond.type) !== n || widthOf(e.ifTrue.type) !== n) return undefined;
      if (widthOf(e.ifFalse.type) !== n) return undefined;
      return lanewise([e.cond, e.ifTrue, e.ifFalse], n, S, ([c, t, f]) => ({
        js: `(${c!.js} ? ${t!.js} : ${f!.js})`,
        rounded: t!.rounded === true && f!.rounded === true,
      }));
    }
    case 'construct':
      return constructLanes(e, n, S);
    case 'member':
      return swizzleLanes(e, n, S);
    case 'call':
      return callLanes(e, n, S);
    default:
      return undefined;
  }
}

/** A vector constructor, each component the argument's, converted to the vector's element
 *  kind where it differs (`convertComponent`, the interpreter's `construct`), or one scalar
 *  in every component (WGSL's splat). */
function constructLanes(
  e: Extract<Expr, { op: 'construct' }>,
  n: number,
  S: FnCtx,
): Lanes | undefined {
  const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
  const splat = e.args.length === 1 && !isArrayValued(e.args[0]!.type);
  let count = 0;
  for (const a of e.args) {
    const w = widthOf(a.type);
    // A matrix or an array argument is spread through the runtime.
    if (w === undefined && isArrayValued(a.type)) return undefined;
    count += w ?? 1;
  }
  if (!splat && count !== n) return undefined;
  const { pre, parts } = operands(e.args, S, false);
  const cvt = (c: Js, a: Expr): Js => {
    const from = elemKindOf(a.type);
    if (elem === undefined || from === undefined || from === elem) return c;
    return { js: `${helper(S, 'cvt')}(${c.js}, ${q(from)}, ${q(elem)})` };
  };
  if (splat) {
    const c = atomize(cvt(parts[0]![0]!, e.args[0]!), S, pre);
    return { pre, comps: range(n).map(() => c) };
  }
  return { pre, comps: e.args.flatMap((a, j) => parts[j]!.map((c) => cvt(c, a))) };
}

/** A swizzle of two or more components (`.xy`, `.zyx`) of a vector: its components picked, as
 *  the runtime's `swiz` picks them. A component picked twice is computed once. */
function swizzleLanes(e: Extract<Expr, { op: 'member' }>, n: number, S: FnCtx): Lanes | undefined {
  const w = widthOf(e.base.type);
  if (w === undefined || e.field.length < 2 || e.field.length !== n) return undefined;
  const idx: number[] = [];
  for (const c of e.field) {
    if (!Object.hasOwn(FIELD_IDX, c)) return undefined;
    const i = FIELD_IDX[c]!;
    if (i >= w) return undefined;
    idx.push(i);
  }
  const { pre, parts } = operands([e.base], S);
  const src = parts[0]!;
  const picked = (i: number): number => idx.filter((k) => k === i).length;
  const comps = src.map((c, i) => (picked(i) > 1 ? atomize(c, S, pre) : c));
  return { pre, comps: idx.map((i) => comps[i]!) };
}

/** A builtin with a vector result, per component: the rounding, a per-component builtin
 *  (`COMPONENTWISE`), `normalize` and `cross`. */
function callLanes(e: Call, n: number, S: FnCtx): Lanes | undefined {
  if (callKind(e, S) !== 'builtin') return undefined;
  const kind = numKindOf(e.type);
  const out = (l: Lanes): Lanes =>
    kind === 'f32' ? l : { pre: l.pre, comps: l.comps.map((c) => ({ js: wrapNum(c.js, kind) })) };
  const [a0] = e.args;
  if (e.fn === '__fround') {
    if (e.args.length !== 1 || widthOf(a0!.type) !== n) return undefined;
    const ids = roundedParam(a0!, e.type, S);
    if (ids !== undefined) {
      return out({
        pre: [],
        comps: ids.map((id) => ({ js: id, atom: true, stable: true, rounded: true })),
      });
    }
    return out(lanewise(e.args, n, S, ([x]) => rounded(x!, S)));
  }
  if (e.fn === 'normalize') {
    // `l = sqrt(a.reduce((s, c) => s + c * c, 0)); a.map((c) => c / l)`, term for term.
    if (e.args.length !== 1 || widthOf(a0!.type) !== n) return undefined;
    const { pre, parts } = operands(e.args, S);
    const c = parts[0]!.map((x) => atomize(x, S, pre));
    const l = tempVar(S);
    pre.push(`${l} = Math.sqrt(${sumOf(c.map((x) => `${x.js} * ${x.js}`))})`);
    return out({ pre, comps: c.map((x) => ({ js: `(${x.js} / ${l})` })) });
  }
  if (e.fn === 'cross') {
    if (n !== 3 || e.args.length !== 2 || !e.args.every((a) => widthOf(a.type) === 3))
      return undefined;
    const { pre, parts } = operands(e.args, S);
    const [u, w] = parts.map((p) => p.map((x) => atomize(x, S, pre))) as [Js[], Js[]];
    const d = (i: number, j: number, k: number, l: number): Js => ({
      js: `(${u[i]!.js} * ${w[j]!.js} - ${u[k]!.js} * ${w[l]!.js})`,
    });
    return out({ pre, comps: [d(1, 2, 2, 1), d(2, 0, 0, 2), d(0, 1, 1, 0)] });
  }
  const cw = componentwiseOf(e.fn);
  if (cw === undefined || e.args.length !== cw.lane.length) return undefined;
  // Every argument a vector of `n` or a scalar, and the one the entry dispatches on a vector,
  // so the entry takes its per-component path over these very components.
  if (!e.args.every((a) => fits(a.type, n))) return undefined;
  const vector =
    cw.vector === 'any'
      ? e.args.some((a) => widthOf(a.type) === n)
      : widthOf(e.args[cw.vector]?.type) === n;
  if (!vector) return undefined;
  const lane = bound(S, `$.L[${q(e.fn)}].lane`);
  return out(
    lanewise(e.args, n, S, (xs) => ({ js: `${lane}(${xs.map((x) => x.js).join(', ')})` })),
  );
}

/** Component `i` of the vector `base`: of one the generator builds per component, that
 *  component alone. */
function component(base: Expr, i: number, S: FnCtx): Js {
  const n = widthOf(base.type);
  if (n !== undefined && i < n) {
    const own = ownLanes(base, n, S);
    if (own !== undefined) {
      const c = own.comps[i]!;
      return own.pre.length === 0 ? c : { js: seq(own.pre, c.js), rounded: c.rounded };
    }
  }
  const b = emit(base, S);
  return { js: keyed(b.js, String(i)), atom: b.atom, stable: b.stable };
}

/** A comparison of two scalars, as `compareValues` makes it: `==` and `!=` on f32 operands
 *  round both first (X-GIS #13); the ordering ones compare the doubles. */
function compareJs(cop: CmpOp, a: Js, b: Js, f32: boolean, S: FnCtx): string {
  switch (cop) {
    case '<':
      return `(${a.js} < ${b.js})`;
    case '>':
      return `(${a.js} > ${b.js})`;
    case '<=':
      return `(${a.js} <= ${b.js})`;
    case '>=':
      return `(${a.js} >= ${b.js})`;
    case '==':
      return f32 ? `(${rounded(a, S).js} === ${rounded(b, S).js})` : `(${a.js} === ${b.js})`;
    case '!=':
      return f32 ? `(${rounded(a, S).js} !== ${rounded(b, S).js})` : `(${a.js} !== ${b.js})`;
  }
}

function emitExpr(e: Expr, S: FnCtx): string {
  return emit(e, S).js;
}

function emit(e: Expr, S: FnCtx): Js {
  const n = widthOf(e.type);
  if (n !== undefined) {
    const own = ownLanes(e, n, S);
    if (own !== undefined) return arrayOf(own);
  }
  switch (e.op) {
    case 'lit':
      return litJs(e.value);
    case 'constref': {
      const id = S.mod.constId.get(e.name);
      if (id === undefined) throw new CodegenUnsupported(`unknown const ${e.name}`);
      return { js: id, atom: true, stable: true };
    }
    case 'overrideref': {
      const id = S.mod.overrideId.get(e.name);
      if (id === undefined) throw new CodegenUnsupported(`unknown override ${e.name}`);
      return { js: id, atom: true, stable: true };
    }
    // X-GIS #1713 — a HOST-provided global has no CPU value: there is no host here. Refusing is
    // the honest answer; substituting 0 would make the oracle silently disagree with the
    // GPU, which is the one thing a reference implementation must never do.
    case 'externref':
      throw new CodegenUnsupported(`host-provided global '${e.name}' has no CPU value`);
    case 'param':
    case 'varref':
      return { js: readVar(e.name, S), atom: true };
    case 'binop':
      return emitBinop(e, S);
    case 'unop': {
      const a = emitExpr(e.a, S);
      if (isArrayValued(e.a.type))
        return { js: wrapped(`${helper(S, 'negVec')}(${a})`, e.type, S), fresh: true };
      return { js: wrapped(negate(a), e.type, S) };
    }
    case 'compare': {
      const a = emit(e.a, S);
      const b = emit(e.b, S);
      // Two vectors compare componentwise into a vector of bools (§27), through the runtime
      // helper the interpreter shares, so the twins cannot disagree.
      if (isArrayValued(e.a.type)) {
        return {
          js: `${helper(S, 'cmpVec')}(${q(e.cop)}, ${a.js}, ${b.js}, ${comparesAsF32(e.a.type)})`,
          fresh: true,
        };
      }
      return { js: compareJs(e.cop, a, b, isF32(e.a.type), S) };
    }
    case 'logical': {
      const a = emitExpr(e.a, S);
      const b = emitExpr(e.b, S);
      // Operands are bool-typed, so JS `&&`/`||` returns the same boolean the
      // interpreter does (`a ? evalB : false` / `a ? true : evalB`), lazily.
      return { js: e.lop === '&&' ? `(${a} && ${b})` : `(${a} || ${b})` };
    }
    case 'call':
      return emitCall(e, S);
    case 'member': {
      if (isArrayValued(e.base.type)) {
        if (e.field.length > 1) {
          const idx = [...e.field].map((c) => FIELD_IDX[c]);
          if (idx.some((i) => i === undefined)) throw new CodegenUnsupported(`swizzle .${e.field}`);
          return {
            js: `${helper(S, 'swiz')}(${emitExpr(e.base, S)}, [${idx.join(', ')}])`,
            fresh: true,
          };
        }
        const i = FIELD_IDX[e.field];
        if (i === undefined) throw new CodegenUnsupported(`field .${e.field}`);
        return component(e.base, i, S);
      }
      const base = emit(e.base, S);
      return { js: keyed(base.js, q(e.field)), atom: base.atom };
    }
    case 'construct':
      return emitConstruct(e, S);
    case 'select': {
      // A vector-of-bools condition picks per component (§27), both arms evaluated.
      if (e.cond.type.kind === 'vec') {
        return {
          js: `${helper(S, 'selVec')}(${emitExpr(e.cond, S)}, ${emitExpr(e.ifTrue, S)}, ${emitExpr(e.ifFalse, S)})`,
          fresh: true,
        };
      }
      const c = emitExpr(e.cond, S);
      const t = emit(e.ifTrue, S);
      const f = emit(e.ifFalse, S);
      return {
        js: `(${c} ? ${t.js} : ${f.js})`,
        fresh: t.fresh === true && f.fresh === true,
        rounded: t.rounded === true && f.rounded === true,
      };
    }
    case 'index': {
      // `m[j]` is COLUMN j of a flat column-major list — see matColumn.
      if (e.base.type.kind === 'mat') {
        return {
          js: `${helper(S, 'matColumn')}(${emitExpr(e.base, S)}, ${emitExpr(e.idx, S)}, ${e.base.type.rows})`,
          fresh: true,
        };
      }
      const i = e.idx.op === 'lit' ? e.idx.value : undefined;
      const n = widthOf(e.base.type);
      if (n !== undefined && typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < n)
        return component(e.base, i, S);
      const base = emit(e.base, S);
      const idx = emit(e.idx, S);
      return { js: keyed(base.js, idx.js), atom: base.atom === true && idx.atom === true };
    }
    case 'matchExpr': {
      // Evaluate the scrutinee once (IIFE arg), then a lazy nested ternary picks
      // the matching case's expr or the default — same no-fall-through, only the
      // matched arm evaluated. `$m` cannot collide with $a/$v/$C/$O ids.
      let expr = emitExpr(e.default, S);
      for (let i = e.cases.length - 1; i >= 0; i--) {
        expr = `($m === ${jsNum(e.cases[i]![0])} ? ${emitExpr(e.cases[i]![1], S)} : ${expr})`;
      }
      return { js: `(($m) => ${expr})(${emitExpr(e.scrutinee, S)})` };
    }
  }
}

function emitCall(e: Call, S: FnCtx): Js {
  const kind = callKind(e, S);
  // A barrier has no meaning for one compiled invocation; the runtime throws and names
  // `dispatch`, which runs the workgroup in lockstep on the interpreter (#82).
  if (kind === 'barrier') return { js: `$.barrier(${q(e.fn)})` };
  // An atomic builtin's first argument is a LOCATION (roadmap 0.2 item 4): the runtime
  // reads and writes it back in one step, mirroring the interpreter's `evalAtomic`.
  if (kind === 'atomic') return { js: emitAtomic(e, S) };
  if (kind === 'builtin') {
    const own = builtinJs(e, S);
    if (own !== undefined) return own;
  }
  const args = e.args.map((a) => emitExpr(a, S));
  switch (kind) {
    case 'console': {
      const method = e.fn.slice('console.'.length);
      const rows = consoleTableRows(
        method,
        e.args.map((a) => a.type),
      );
      return {
        js: `$.console(${q(method)}, [${args.join(', ')}], ${e.span ? q(JSON.stringify(e.span)) : 'undefined'}, ${e.labels ? JSON.stringify(e.labels) : 'undefined'}${rows === undefined ? '' : `, ${rows}`})`,
      };
    }
    case 'saturate':
      return { js: `${helper(S, e.fn === 'u32' ? 'u32Sat' : 'i32Sat')}(${args[0]})` };
    case 'transpose': {
      const t = e.args[0]!.type as Extract<ShaderType, { kind: 'mat' }>;
      return {
        js: `${helper(S, 'matTransposeShaped')}(${args[0]}, ${t.cols}, ${t.rows})`,
        fresh: true,
      };
    }
    case 'bits': {
      const k = elemKindOf(e.args[0]!.type) === 'i32' ? 'i32' : 'u32';
      return {
        js: `${helper(S, 'bit')}(${q(e.fn)}, ${q(k)}, [${args.join(', ')}])`,
        fresh: isArrayValued(e.type),
      };
    }
    case 'builtin': {
      // Bound once, unless the name is not the table's own (then a method call, as before).
      const f = Object.hasOwn(BUILTINS, e.fn) ? bound(S, `$.B[${q(e.fn)}]`) : `$.B[${q(e.fn)}]`;
      return { js: wrapped(`${f}(${args.join(', ')})`, e.type, S) };
    }
    case 'stub':
      return { js: `$.gpuStub(${[q(e.fn), ...args].join(', ')})` };
    default:
      return { js: storeBackJs(e, `$.F[${q(e.fn)}](${args.join(', ')})`, S) };
  }
}

/** A builtin with a scalar result the generator writes out where the types allow: the rounding
 *  of a scalar, a per-component builtin of scalars (its `lane` function, which is what the
 *  entry calls on scalars), and `dot`, `length` and `distance` of vectors, summed term by term
 *  as their entries sum. Undefined for any other call, which goes through the table. */
function builtinJs(e: Call, S: FnCtx): Js | undefined {
  const kind = numKindOf(e.type);
  const out = (v: Js): Js => (kind === 'f32' ? v : { js: wrapNum(v.js, kind) });
  const [a0, a1] = e.args;
  if (e.fn === '__fround') {
    if (e.args.length !== 1 || !isScalar(a0!.type)) return undefined;
    const ids = roundedParam(a0!, e.type, S);
    if (ids !== undefined) return out({ js: ids[0]!, atom: true, stable: true, rounded: true });
    return out(rounded(emit(a0!, S), S));
  }
  const cw = componentwiseOf(e.fn);
  if (cw !== undefined) {
    if (e.args.length !== cw.lane.length || !e.args.every((a) => isScalar(a.type)))
      return undefined;
    const lane = bound(S, `$.L[${q(e.fn)}].lane`);
    return out({ js: `${lane}(${e.args.map((a) => emitExpr(a, S)).join(', ')})` });
  }
  if ((e.fn === 'dot' || e.fn === 'distance') && e.args.length === 2) {
    const w = widthOf(a0!.type);
    if (w === undefined || widthOf(a1!.type) !== w) return undefined;
    const { pre, parts } = operands(e.args, S);
    const [a, b] = parts as [Js[], Js[]];
    // dot: `a.reduce((s, c, i) => s + c * b[i], 0)`.
    if (e.fn === 'dot')
      return out({ js: seq(pre, sumOf(range(w).map((i) => `${a[i]!.js} * ${b[i]!.js}`))) });
    // distance: `d = c - b[i]; s + d * d`, then the square root.
    const d = range(w).map((i) => atomize({ js: `(${a[i]!.js} - ${b[i]!.js})` }, S, pre));
    return out({ js: seq(pre, `Math.sqrt(${sumOf(d.map((x) => `${x.js} * ${x.js}`))})`) });
  }
  if (e.fn === 'length' && e.args.length === 1) {
    // `Math.sqrt(v.reduce((s, c) => s + c * c, 0))`.
    const w = widthOf(a0!.type);
    if (w === undefined) return undefined;
    const { pre, parts } = operands(e.args, S);
    const c = parts[0]!.map((x) => atomize(x, S, pre));
    return out({ js: seq(pre, `Math.sqrt(${sumOf(c.map((x) => `${x.js} * ${x.js}`))})`) });
  }
  return undefined;
}

function emitBinop(e: Extract<Expr, { op: 'binop' }>, S: FnCtx): Js {
  const a = emitExpr(e.a, S);
  const b = emitExpr(e.b, S);
  // mat*vec / mat*mat / vec*mat dispatched by STATIC type, exactly as the
  // interpreter dispatches (values are type-blind number[] at runtime).
  // The SHAPE is baked in from the static type: a flat list cannot tell a mat2x3 from a
  // mat3x2, and the two multiply differently (#149).
  if (
    e.bop === '*' &&
    e.a.type.kind === 'mat' &&
    (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
  )
    return {
      js: `${helper(S, 'matVecShaped')}(${a}, ${b}, ${e.a.type.cols}, ${e.a.type.rows})`,
      fresh: true,
    };
  if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat')
    return {
      js: `${helper(S, 'matMulShaped')}(${a}, ${b}, ${e.a.type.cols}, ${e.a.type.rows}, ${e.b.type.cols})`,
      fresh: true,
    };
  // vecR * matCxR — the row-vector product, `transpose(m) * v`.
  if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat')
    return {
      js: `${helper(S, 'vecMatShaped')}(${a}, ${b}, ${e.b.type.cols}, ${e.b.type.rows})`,
      fresh: true,
    };
  const kind = numKindOf(e.type);
  // Either operand array-valued (a matrix, an array, a vector of another shape) ⇒
  // component-wise via the shared applyBin — the SAME function the interpreter uses.
  if (isArrayValued(e.a.type) || isArrayValued(e.b.type))
    return { js: `${helper(S, 'applyBin')}(${q(e.bop)}, ${a}, ${b}, ${q(kind)})`, fresh: true };
  // Both scalar — inline to scalarBin's exact JS ops.
  return { js: emitScalarBin(e.bop, a, b, kind, S) };
}

/** `applyBin(bop, a, b, kind)`, the value of a compound assignment `a bop= b`: per component
 *  where the types say `a` is a vector and `b` one of its width or a scalar, inline for two
 *  scalars, and through the runtime otherwise. Never a matrix product: `applyBin` is
 *  component-wise whatever the operands are, in both engines. */
function applyBinJs(bop: BinOp, a: Expr, b: Expr, kind: NumKind, S: FnCtx): string {
  const n = widthOf(a.type);
  if (n !== undefined && fits(b.type, n)) {
    return arrayOf(
      lanewise([a, b], n, S, ([x, y]) => ({ js: emitScalarBin(bop, x!.js, y!.js, kind, S) })),
    ).js;
  }
  const x = emitExpr(a, S);
  const y = emitExpr(b, S);
  if (!isArrayValued(a.type) && !isArrayValued(b.type)) return emitScalarBin(bop, x, y, kind, S);
  return `${helper(S, 'applyBin')}(${q(bop)}, ${x}, ${y}, ${q(kind)})`;
}

/** scalarBin's spellings, token for token: the float kind is plain JS arithmetic; an
 *  integer kind wraps with `| 0` / `>>> 0` exactly as `wrapInt` does, multiplies through
 *  `Math.imul`, and divides / takes the remainder through the SAME `intDiv` / `intRem`
 *  helpers the interpreter calls (X-GIS #2274) — bit-identical by construction. */
function emitScalarBin(bop: BinOp, a: string, b: string, kind: NumKind, S: FnCtx): string {
  const int = kind !== 'f32';
  const wrap = (s: string): string => (kind === 'i32' ? `(${s} | 0)` : `(${s} >>> 0)`);
  switch (bop) {
    case '+':
      return int ? wrap(`(${a} + ${b})`) : `(${a} + ${b})`;
    case '-':
      return int ? wrap(`(${a} - ${b})`) : `(${a} - ${b})`;
    case '*':
      return int ? wrap(`Math.imul(${a}, ${b})`) : `(${a} * ${b})`;
    case '/':
      return int ? `${helper(S, 'intDiv')}(${a}, ${b}, ${q(kind)})` : `(${a} / ${b})`;
    case '%':
      return int ? `${helper(S, 'intRem')}(${a}, ${b}, ${q(kind)})` : `(${a} % ${b})`;
    case '&':
      return kind === 'i32' ? `(${a} & ${b})` : `((${a} & ${b}) >>> 0)`;
    case '|':
      return kind === 'i32' ? `(${a} | ${b})` : `((${a} | ${b}) >>> 0)`;
    case '^':
      return kind === 'i32' ? `(${a} ^ ${b})` : `((${a} ^ ${b}) >>> 0)`;
    case '<<':
      return kind === 'i32' ? `(${a} << ${b})` : `((${a} << ${b}) >>> 0)`;
    case '>>':
      return kind === 'i32' ? `(${a} >> ${b})` : `(${a} >>> ${b})`;
  }
}

/** A constructor the per-component path leaves whole: an array, a struct, a matrix, and a
 *  vector whose arguments it does not take apart. */
function emitConstruct(e: Extract<Expr, { op: 'construct' }>, S: FnCtx): Js {
  // A new array or object is fresh when every aggregate it holds is.
  const freshAll = (vals: readonly Js[]): boolean =>
    vals.every((v, i) => !isAggregateType(e.args[i]!.type) || v.fresh === true);
  if (e.type.kind === 'array') {
    const vals = e.args.map((a) => emit(a, S));
    return { js: `[${vals.map((v) => v.js).join(', ')}]`, fresh: freshAll(vals) };
  }
  if (e.type.kind === 'struct') {
    const decl = S.mod.structs.get(e.type.name);
    if (decl === undefined) throw new CodegenUnsupported(`struct ${e.type.name} not declared`);
    const vals = decl.fields.map((_, i) => emit(e.args[i]!, S));
    const fields = decl.fields.map((f, i) => `${q(f.name)}: ${vals[i]!.js}`);
    return { js: `{ ${fields.join(', ')} }`, fresh: freshAll(vals) };
  }
  // Vector: WGSL splat (single scalar arg fills all N) vs flatten (scalars +
  // spread vec args), matching the interpreter's out.length===1 check. A component whose
  // kind differs from the constructed vector's is converted, which is the same
  // convertComponent(s) the interpreter calls — WGSL's element-CONVERTING constructor,
  // vecN<T>(v: vecN<S>).
  const elem = e.type.kind === 'vec' ? e.type.elem : undefined;
  const n = e.type.kind === 'vec' || e.type.kind === 'vec64' ? e.type.n : 0;
  const cvt = (a: Expr): string => {
    const src = emitExpr(a, S);
    const from = elemKindOf(a.type);
    if (elem === undefined || from === undefined || from === elem) return src;
    return `${helper(S, isArrayValued(a.type) ? 'cvtVec' : 'cvt')}(${src}, ${q(from)}, ${q(elem)})`;
  };
  if (e.args.length === 1 && !isArrayValued(e.args[0]!.type))
    return { js: `${helper(S, 'splat')}(${n}, ${cvt(e.args[0]!)})`, fresh: true };
  const parts = e.args.map((a) => (isArrayValued(a.type) ? `...(${cvt(a)})` : cvt(a)));
  return { js: `[${parts.join(', ')}]`, fresh: true };
}

/** Assignment as an EXPRESSION (no trailing `;`) — used for for-loop updates
 *  and, with `;` appended, for statements. Mirrors setLValue. */
/** `atomicAdd(xs[i], v)` and its family. The generated code hands the runtime the container
 *  and the key of the location, or a getter and a setter for a JS local, so the read and the
 *  write-back happen once, in one `atomicStep`, the way the interpreter's `refOf` does. */
function emitAtomic(e: Extract<Expr, { op: 'call' }>, S: FnCtx): string {
  const loc = e.args[0];
  if (loc === undefined) throw new CodegenUnsupported(`${e.fn} without a location`);
  const fn = q(e.fn);
  const kind = q(numKindOf(loc.type));
  const arg = e.args[1] === undefined ? '0' : emitExpr(e.args[1], S);
  // `atomicCompareExchangeWeak`'s third argument is the value to store (#152); the other ten
  // builtins have none, and the runtime helpers take `undefined` for them.
  const store = e.args[2] === undefined ? 'undefined' : emitExpr(e.args[2], S);
  if (loc.op === 'index') {
    return `$.atomicAt(${fn}, ${emitExpr(loc.base, S)}, ${emitExpr(loc.idx, S)}, ${arg}, ${kind}, ${store})`;
  }
  if (loc.op === 'member') {
    const key = isArrayValued(loc.base.type) ? String(FIELD_IDX[loc.field] ?? -1) : q(loc.field);
    return `$.atomicAt(${fn}, ${emitExpr(loc.base, S)}, ${key}, ${arg}, ${kind}, ${store})`;
  }
  if (loc.op === 'varref' || loc.op === 'param') {
    const id = S.varId.get(loc.name);
    if (id === undefined) {
      const table = S.mod.varNames.has(loc.name) ? '$.vars' : '$.bindings';
      return `$.atomicAt(${fn}, ${table}, ${q(loc.name)}, ${arg}, ${kind}, ${store})`;
    }
    return `$.atomicRef(${fn}, () => ${id}, ($v) => (${id} = $v), ${arg}, ${kind}, ${store})`;
  }
  throw new CodegenUnsupported(`atomic location ${loc.op}`);
}

function emitAssignExpr(target: Expr, valueStr: string, S: FnCtx): string {
  if (target.op === 'varref' || target.op === 'param') {
    // A module-level name no local shadows is written in the module's table, mirroring the
    // interpreter's `setLValue`; a local, or an unknown name, is a JS local.
    const local = S.varId.get(target.name);
    if (local === undefined && S.mod.varNames.has(target.name))
      return `$.vars[${q(target.name)}] = ${valueStr}`;
    if (local === undefined && S.mod.bindingNames.has(target.name))
      return `$.bindings[${q(target.name)}] = ${valueStr}`;
    const id = local ?? declareVar(target.name, S);
    return `${id} = ${valueStr}`;
  }
  if (target.op === 'member') {
    const base = emitExpr(target.base, S);
    if (isArrayValued(target.base.type)) {
      const i = FIELD_IDX[target.field];
      if (i === undefined) throw new CodegenUnsupported(`assign .${target.field}`);
      return `(${base})[${i}] = ${valueStr}`;
    }
    return `(${base})[${q(target.field)}] = ${valueStr}`;
  }
  if (target.op === 'index') {
    // `m[j] = v` writes COLUMN j into the flat list — see setMatColumn.
    if (target.base.type.kind === 'mat') {
      return `${helper(S, 'setMatColumn')}(${emitExpr(target.base, S)}, ${emitExpr(target.idx, S)}, ${target.base.type.rows}, ${valueStr})`;
    }
    return `(${emitExpr(target.base, S)})[${emitExpr(target.idx, S)}] = ${valueStr}`;
  }
  throw new CodegenUnsupported(`assignment target ${target.op}`);
}

/** The right-hand side of any STORE — a `let`/`var` binding or an assignment to an existing
 *  name: an aggregate is COPIED, as `var w = v` and `w = v` both are on the GPU targets,
 *  through the SAME cloneValue the interpreter calls, so the two stay bit-identical. A scalar
 *  store emits exactly the source it emitted before, and so does a value the generated code
 *  has just built (`Js.fresh`), which nothing else can reach: its copy would hold the same
 *  values and be the only one left.
 *
 *  The binding half alone was not enough: `w = v` stored the same array under the second name,
 *  so a later `w.x = 100.` reached through to `v` and the CPU said 100 where both GPU targets
 *  say 3. */
function bindJs(v: Js, t: ShaderType, S: FnCtx): string {
  return isAggregateType(t) && v.fresh !== true ? `${helper(S, 'clone')}(${v.js})` : v.js;
}

function emitStmt(s: Stmt, S: FnCtx): string {
  switch (s.s) {
    case 'let': {
      const id = declareVar(s.name, S);
      return `${id} = ${bindJs(emit(s.expr, S), s.expr.type, S)};`;
    }
    case 'var': {
      const id = declareVar(s.name, S);
      return `${id} = ${s.init ? bindJs(emit(s.init, S), s.type, S) : zeroLit(s.type, S.mod.structs)};`;
    }
    case 'assign':
      return `${emitAssignExpr(s.target, bindJs(emit(s.expr, S), s.expr.type, S), S)};`;
    case 'assignOp': {
      const val = applyBinJs(s.bop, s.target, s.expr, numKindOf(s.target.type), S);
      return `${emitAssignExpr(s.target, val, S)};`;
    }
    case 'return':
      if (S.inoutPublish !== undefined) {
        if (!s.expr) return `return void (${S.inoutPublish});`;
        const t = tempVar(S);
        return `return (${t} = ${emitExpr(s.expr, S)}, ${S.inoutPublish}, ${t});`;
      }
      return s.expr ? `return ${emitExpr(s.expr, S)};` : `return undefined;`;
    case 'break':
      return `break;`;
    case 'continue':
      return `continue;`;
    case 'discard':
      // The interpreter's discard signal propagates out of the fn as `undefined`.
      return `return undefined;`;
    case 'call':
      // Evaluated for its effect; the value is dropped, as the GPU drops it.
      return `${emitExpr(s.expr, S)};`;
    case 'if': {
      const parts: string[] = [];
      s.arms.forEach((arm, i) => {
        parts.push(
          `${i === 0 ? 'if' : 'else if'} (${emitExpr(arm.cond, S)}) {\n${emitBody(arm.body, S)}\n}`,
        );
      });
      if (s.elseBody) parts.push(`else {\n${emitBody(s.elseBody, S)}\n}`);
      return parts.join(' ');
    }
    case 'for': {
      const init = emitForInit(s.init, S);
      const cond = emitExpr(s.cond, S);
      const update = emitForUpdate(s.update, S);
      const reductions = S.mod.trees.get(s);
      if (reductions !== undefined) return emitTreeFor(s, reductions, init, cond, update, S);
      return `for (${init}; ${cond}; ${update}) {\n${emitBody(s.body, S)}\n}`;
    }
    case 'switch': {
      // Native switch: strict-=== case match + no fall-through (explicit break),
      // which is exactly the interpreter's find-by-value + single-case-body. A
      // `break` inside a case body is consumed by this switch; a `continue` /
      // `return` / discard propagates, same as the interpreter's signals.
      const scrut = emitExpr(s.scrut, S);
      const cases = s.cases.map(
        // JavaScript shares a body between labels by stacking them, which is what a
        // multi-selector clause is: `case 0: case 1: { … break; }`.
        (c) =>
          `${c.values.map((v) => `case ${jsNum(v)}:`).join(' ')} {\n${emitBody(c.body, S)}\nbreak;\n}`,
      );
      const dflt = s.defaultBody ? `default: {\n${emitBody(s.defaultBody, S)}\nbreak;\n}` : '';
      return `switch (${scrut}) {\n${cases.join('\n')}\n${dflt}\n}`;
    }
    case 'placeholder':
      // Composer must splice before emit; on the CPU path a leak is a bug — fall
      // this fn back to the interpreter (which throws loudly with the tag).
      throw new CodegenUnsupported(`placeholder ${s.tag}`);
    case 'raw':
      // Raw passthrough is GPU-only — no CPU evaluation. Fall back.
      throw new CodegenUnsupported('raw Stmt');
  }
}

/** A kernel function's reduction loop, as the interpreter runs it (Rule 7.2): each iteration
 *  combines into the variable from the identity, what it holds after the iteration is
 *  collected, and after the loop the variable is combined with the collection folded in the
 *  tree order (`core/kernel-tree.ts`). A `continue` reaches the `finally`. */
function emitTreeFor(
  s: Stmt & { s: 'for' },
  reductions: readonly LoopReduction[],
  init: string,
  cond: string,
  update: string,
  S: FnCtx,
): string {
  const ids = reductions.map((r) => readVar(r.name, S));
  const saved = reductions.map(() => tempVar(S));
  const bags = reductions.map(() => tempVar(S));
  const identities = reductions.map((r) => identityJs(r));
  S.varId.set('$ta', '$ta');
  S.varId.set('$tb', '$tb');
  const combines = reductions.map(
    (r) => `(($ta, $tb) => ${emitExpr(treeCombine(r, S.mod.f32), S)})`,
  );
  S.varId.delete('$ta');
  S.varId.delete('$tb');
  const before = ids.map((id, k) => `${saved[k]} = ${id}; ${bags[k]} = [];`).join('\n');
  const start = ids.map((id, k) => `${id} = ${identities[k]};`).join(' ');
  const collect = ids.map((id, k) => `${bags[k]}.push(${id});`).join(' ');
  const after = ids
    .map(
      (id, k) =>
        `${id} = ${saved[k]};\n{ const $tr = $.tree(${bags[k]}, ${combines[k]}, () => ${identities[k]}); if ($tr !== undefined) ${id} = ${combines[k]}(${id}, $tr); }`,
    )
    .join('\n');
  return `${before}\nfor (${init}; ${cond}; ${update}) {\n${start}\ntry {\n${emitBody(s.body, S)}\n} finally { ${collect} }\n}\n${after}`;
}

/** A fresh identity of `r`'s operator in its type, as JavaScript. */
function identityJs(r: LoopReduction): string {
  const t = r.type;
  const scalar =
    t.kind === 'scalar'
      ? t.scalar
      : t.kind === 'vec'
        ? t.elem
        : t.kind === 'f64' || t.kind === 'vec64'
          ? 'f64'
          : undefined;
  if (scalar === undefined) throw new CodegenUnsupported(`a ${t.kind} reduction`);
  const one = jsNum(treeIdentity(r.op, scalar));
  return t.kind === 'vec' || t.kind === 'vec64'
    ? `[${new Array<string>(t.n).fill(one).join(', ')}]`
    : one;
}

function emitForInit(s: Stmt, S: FnCtx): string {
  if (s.s === 'let') return `${declareVar(s.name, S)} = ${emitExpr(s.expr, S)}`;
  if (s.s === 'var')
    return `${declareVar(s.name, S)} = ${s.init ? emitExpr(s.init, S) : zeroLit(s.type, S.mod.structs)}`;
  throw new CodegenUnsupported(`for-init ${s.s}`);
}

function emitForUpdate(s: Stmt, S: FnCtx): string {
  if (s.s === 'assign') return emitAssignExpr(s.target, bindJs(emit(s.expr, S), s.expr.type, S), S);
  if (s.s === 'assignOp') {
    const val = applyBinJs(s.bop, s.target, s.expr, numKindOf(s.target.type), S);
    return emitAssignExpr(s.target, val, S);
  }
  throw new CodegenUnsupported(`for-update ${s.s}`);
}

function emitBody(body: readonly Stmt[], S: FnCtx): string {
  return body.map((s) => emitStmt(s, S)).join('\n');
}

/** How the body of a function uses one of its parameters. */
interface ParamUse {
  /** Every read of it, a rounding's included. */
  reads: number;
  /** The reads the precision pass rounds (`__fround(p)`) with the parameter's own shape, which
   *  a parameter rounded at entry serves. */
  wrapped: number;
  /** Anything may write it: an assignment into it, an atomic on it, an `inout` argument, or a
   *  local of its name, which the flat environment makes the same variable. */
  written: boolean;
}

/** How `f`'s body uses each of its parameters, by name. A name two parameters share counts as
 *  written, so neither is rounded at entry. */
function paramUses(f: FuncDecl, mod: ModCtx): ReadonlyMap<string, ParamUse> {
  const uses = new Map<string, ParamUse>();
  const types = new Map<string, ShaderType>();
  for (const p of f.params) {
    uses.set(p.name, { reads: 0, wrapped: 0, written: uses.has(p.name) });
    types.set(p.name, p.type);
  }
  const shaped = (t: ShaderType, decl: ShaderType): boolean => {
    const w = widthOf(decl);
    return w === undefined ? isScalar(t) : widthOf(t) === w;
  };
  const write = (e: Expr | undefined): void => {
    let x = e;
    while (x !== undefined && (x.op === 'member' || x.op === 'index' || x.op === 'call'))
      x = x.op === 'call' ? x.args[0] : x.base;
    if (x !== undefined && (x.op === 'param' || x.op === 'varref')) {
      const u = uses.get(x.name);
      if (u !== undefined) u.written = true;
    }
  };
  const visit = (x: Expr): void => {
    if (x.op === 'param' || x.op === 'varref') {
      const u = uses.get(x.name);
      if (u !== undefined) u.reads++;
      return;
    }
    if (x.op !== 'call') return;
    const a = x.args[0];
    if (
      x.fn === '__fround' &&
      x.args.length === 1 &&
      !(x.declRef !== undefined && mod.fnNames.has(x.fn)) &&
      a !== undefined &&
      a.op === 'param'
    ) {
      const u = uses.get(a.name);
      const t = types.get(a.name);
      if (u !== undefined && t !== undefined && shaped(a.type, t) && shaped(x.type, t)) u.wrapped++;
    }
    if (x.declRef === undefined && isAtomicIntrinsic(x.fn)) write(a);
    mod.params.get(x.fn)?.forEach((p, i) => {
      if (p.mode === 'inout') write(x.args[i]);
    });
  };
  const stmt = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') {
      const u = uses.get(s.name);
      if (u !== undefined) u.written = true;
    }
    if (s.s === 'assign' || s.s === 'assignOp') write(s.target);
    eachStmtExpr(s, (e) => eachExpr(e, visit), stmt);
  };
  for (const s of f.body) stmt(s);
  return uses;
}

/** What {@link generateModuleJs} writes for a module: the source of the factory
 *  {@link compileModuleJs} hands to `new Function`, and the pieces it is made of, for a caller
 *  that writes the code into a module of its own instead (the Vite plugin, through
 *  `src/compiler/ts/host-face.ts`, Rule 11.7). */
export interface GeneratedModuleJs {
  /** The module the code was generated from: the input after the shared preamble (`validate`,
   *  `autoVars`, and `froundF32` in `'f32'` precision). */
  readonly module: ModuleDecl;
  /** The factory's declarations: one `const` per runtime function the code calls through a
   *  binding (`Math.fround` as `$fr`, a builtin or a helper as `$h<k>`), then one
   *  `const $C_i = …;` or `const $O_i = …;` statement per module constant and override. */
  readonly decls: readonly string[];
  /** The JavaScript id each module constant has among {@link decls}, by the constant's name. */
  readonly constIds: ReadonlyMap<string, string>;
  /** One `"name": function(…) {…}` property per function this generator could emit, plus
   *  `"$initPrivates"` when the module has a private variable. */
  readonly fns: readonly string[];
  /** The functions it could not emit, which {@link compileModuleJs} runs on the interpreter. */
  readonly fallbacks: readonly string[];
  /** The factory body: {@link decls}, then `return { …fns };`. It reads everything through its
   *  one parameter, `$`, a {@link CodegenRuntime}. */
  readonly factorySource: string;
}

/** Generate the JavaScript source of every function of `m` for the CPU, without building it.
 *  {@link compileModuleJs} is this followed by `new Function`; the precision is the same
 *  option it takes. */
export function generateModuleJs(
  m: ModuleDecl,
  opts?: { precision?: CpuPrecision },
): GeneratedModuleJs {
  // Identical preamble to compileModule so the generated code walks the SAME IR
  // the interpreter would (validate rejects malformed modules; autoVars
  // materialises plain-const assignables into var bindings; froundF32 makes f32
  // arithmetic round like the target's — X-GIS #2426, and it must be the same rewrite in
  // the same place, or the two engines stop being differentials of each other).
  validate(m);
  const av = autoVars(m);
  const mv = opts?.precision === 'f32' ? froundF32(av) : av;

  const mod: ModCtx = {
    structs: new Map(mv.structs.map((s) => [s.name, s])),
    constId: new Map(),
    overrideId: new Map(),
    fnNames: new Set(mv.funcs.map((f) => f.name)),
    varNames: new Set((mv.vars ?? []).map((v) => v.name)),
    bindingNames: new Set(mv.bindings.map((b) => b.name)),
    params: new Map(mv.funcs.map((f) => [f.name, f.params])),
    trees: treeLoops(av, mv),
    f32: opts?.precision === 'f32',
    bound: new Map(),
    pure: new WeakMap(),
  };

  // ── Module-scope decls (consts + overrides) as factory-local `const`s ──
  // A scalar const embeds its full-precision cpuValue; a valueExpr const runs
  // the same op tree (may reference earlier consts). Overrides read as their
  // default (the un-specialized mirror), matching the interpreter.
  const constDecls: string[] = [];
  // A const valueExpr is a pure literal expression (no params / bindings), so a
  // throwaway FnCtx with empty varId is the right compile env; a later const may
  // reference an earlier one via constId. A temporary it needs is declared at the factory's
  // top, with the bindings.
  const constEnv: FnCtx = { mod, varId: new Map(), hoisted: [], n: 0, rounded: new Map() };
  mv.consts.forEach((c, i) => {
    const id = `$C_${i}`;
    mod.constId.set(c.name, id);
    const rhs = c.valueExpr ? emitExpr(c.valueExpr, constEnv) : jsNum(c.cpuValue);
    constDecls.push(`const ${id} = ${rhs};`);
  });
  (mv.overrides ?? []).forEach((o, i) => {
    const id = `$O_${i}`;
    mod.overrideId.set(o.name, id);
    constDecls.push(`const ${id} = ${jsNum(o.default)};`);
  });

  // ── Per-fn codegen (hybrid: a body that can't be emitted falls back) ──
  const fnSrcs: string[] = [];
  const fallbackNames: string[] = [];
  // Module variables (roadmap 0.2 item 5). A `workgroup` one is allocated once, zero, as one
  // implicit workgroup's memory; the `private` ones are set from their initializers at every
  // host-facing call, which is one invocation, by the `$initPrivates` function the factory
  // returns beside the module's own. The initializer is emitted the way a const's is.
  const privates = (mv.vars ?? []).filter((v) => v.space === 'private');
  if (privates.length > 0) {
    const varEnv: FnCtx = { mod, varId: new Map(), hoisted: [], n: 0, rounded: new Map() };
    const lines = privates.map(
      (v) =>
        `$.vars[${q(v.name)}] = ${v.init ? bindJs(emit(v.init, varEnv), v.type, varEnv) : zeroLit(v.type, mod.structs)};`,
    );
    const hoist = varEnv.hoisted.length ? `let ${varEnv.hoisted.join(', ')};\n` : '';
    fnSrcs.push(`"$initPrivates": function() {\n${hoist}${lines.join('\n')}\n}`);
  }
  const writes = fnWrites(mv);
  for (const f of mv.funcs) {
    try {
      const S: FnCtx = { mod, varId: new Map(), hoisted: [], n: 0, rounded: new Map() };
      const params = f.params.map((p, i) => {
        const id = `$a${i}`;
        S.varId.set(p.name, id);
        return id;
      });
      // The interpreter's entry, line for line: an aggregate by-value parameter of a function
      // that writes anything is a copy, and a function with an `inout` parameter publishes
      // what its parameters hold at every return (cpu-runtime.ts).
      //
      // An `f32` parameter the precision pass rounds at every read (`__fround(p)`) is rounded
      // once here instead, into `$p<i>` (`$p<i>_<k>` per component of a vector), when nothing
      // writes it: every read then yields what rounding it there would, a vector as a new
      // array as before. A parameter read ONLY that way needs no copy either, since nothing
      // reads the caller's value after this point.
      const copies = copiedParams(f.params, (writes.get(f.name)?.size ?? 0) > 0);
      const uses = paramUses(f, mod);
      const entry: string[] = [];
      f.params.forEach((p, i) => {
        const id = params[i]!;
        const u = uses.get(p.name)!;
        const round = p.mode !== 'inout' && isF32ish(p.type) && u.wrapped > 0 && !u.written;
        if (copies[i] && !(round && u.reads === u.wrapped))
          entry.push(`${id} = ${helper(S, 'clone')}(${id});`);
        if (!round) return;
        const fr = bound(S, 'Math.fround');
        const w = widthOf(p.type);
        const ids = w === undefined ? [`$p${i}`] : range(w).map((k) => `$p${i}_${k}`);
        S.hoisted.push(...ids);
        S.rounded.set(p.name, ids);
        ids.forEach((r, k) => entry.push(`${r} = ${fr}(${w === undefined ? id : `${id}[${k}]`});`));
      });
      if (f.params.some((p) => p.mode === 'inout')) {
        S.inoutPublish = `$.inout.values = [${params.join(', ')}]`;
      }
      const bodySrc = emitBody(f.body, S);
      const exit = S.inoutPublish !== undefined ? `\n${S.inoutPublish};` : '';
      const hoist = S.hoisted.length ? `let ${S.hoisted.join(', ')};\n` : '';
      fnSrcs.push(
        `${q(f.name)}: function(${params.join(', ')}) {\n${hoist}${entry.map((l) => `${l}\n`).join('')}${bodySrc}${exit}\n}`,
      );
    } catch (err) {
      if (err instanceof CodegenUnsupported) {
        fallbackNames.push(f.name);
        continue;
      }
      throw err;
    }
  }

  // The runtime functions the code calls, bound once for every function, then the constants.
  const decls = [
    ...[...mod.bound].map(([rhs, id]) => `const ${id} = ${rhs};`),
    ...(constEnv.hoisted.length > 0 ? [`let ${constEnv.hoisted.join(', ')};`] : []),
    ...constDecls,
  ];
  return {
    module: mv,
    decls,
    constIds: mod.constId,
    fns: fnSrcs,
    fallbacks: fallbackNames,
    factorySource: `${decls.join('\n')}\nreturn {\n${fnSrcs.join(',\n')}\n};`,
  };
}

/** Compile a module for the CPU by generating JavaScript, returning the same
 *  {@link CpuModule} shape {@link compileModule} returns and the same results bit for bit.
 *  Prefer it on any hot path.
 *
 *  Bit identity holds by construction: every operation calls the exact runtime helper the
 *  interpreter calls, or, for a vector the IR types say it can, the scalar operation that
 *  helper applies to each component, so the two cannot drift apart. What differs is when the
 *  work happens. Instead of walking the IR node by node on every invocation, this walks each
 *  function body once, emits a JavaScript source string and builds it with `new Function`, so
 *  each call runs straight-line code with real local variables.
 *
 *  The interpreter is the reference and the fallback. A function body holding a shape this
 *  generator cannot emit bit-identically (a raw statement, a placeholder statement, an
 *  assignment target with no expression form) falls back to the interpreter for that function
 *  alone, so a returned module can be part compiled and part interpreted with nothing to do at
 *  the call site. Where `new Function` itself is unavailable, as on a host whose content
 *  security policy forbids `unsafe-eval`, construction throws, and the caller catches it and
 *  calls {@link compileModule} instead. Reach for the interpreter directly when debugging, too,
 *  since it puts no generated source between you and the IR.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to evaluate.
 *  @param opts - the same `precision` and `gpuStubs` {@link compileModule} takes.
 *  @returns the compiled module: `fns` by name, and `setBinding`.
 *  @throws `Error` when the host forbids `new Function`, which is the case to catch and fall
 *    back to {@link compileModule} for. It also throws {@link ValidationError} when the module
 *    fails a core rule, and, once a function runs, the same errors {@link compileModule}
 *    documents for a GPU-only intrinsic called with `gpuStubs` off or a raw statement reached.
 *
 *  @example
 *  ```ts
 *  import { compileModuleJs, compileModule } from 'typeshade'
 *
 *  const cpu = (() => {
 *    try {
 *      return compileModuleJs(MODULE)
 *    } catch {
 *      return compileModule(MODULE) // no new Function on this host
 *    }
 *  })()
 *  ```
 *
 *  @see {@link compileModule} for the interpreter this matches.
 */
export function compileModuleJs(
  m: ModuleDecl,
  opts?: { gpuStubs?: boolean; precision?: CpuPrecision; consoleSink?: ConsoleSink },
): CpuModule {
  const gen = generateModuleJs(m, opts);
  const mv = gen.module;
  const fallbackNames = gen.fallbacks;
  const factorySrc = gen.factorySource;
  // `new Function` construction is what a CSP `unsafe-eval` host blocks — let it
  // throw so the caller (cpu-projections) can fall the whole module back.
  const factory = new Function('$', factorySrc) as (
    $: CodegenRuntime,
  ) => Record<string, (...a: CpuValue[]) => CpuValue>;

  const runtime = createCodegenRuntime(opts);

  const jsFns = factory(runtime);
  const structs = new Map(mv.structs.map((s) => [s.name, s]));
  for (const v of mv.vars ?? [])
    if (v.space === 'workgroup') runtime.vars[v.name] = zeroOf(v.type, structs);
  const initPrivates = jsFns['$initPrivates'] as (() => void) | undefined;

  // Only build the interpreter twin when a fn actually needs it — its fns supply
  // the fallback bodies AND its own consts/bindings so a fallback fn (and any fn
  // it transitively calls through ITS ctx) runs fully in the interpreter.
  const interp: CpuModule | null = fallbackNames.length ? compileModule(m, opts) : null;

  const F: Record<string, (...a: CpuValue[]) => CpuValue> = {};
  for (const f of mv.funcs) {
    F[f.name] = jsFns[f.name] ?? interp!.fns[f.name]!;
  }
  runtime.F = F;

  // A host-facing call is one invocation and starts its private variables over; a call from
  // inside the module (`$.F`) is the same invocation. Without private variables the two
  // tables are one object, as they always were.
  let fns = F;
  if (initPrivates !== undefined) {
    fns = {};
    for (const f of mv.funcs) {
      const inner = F[f.name]!;
      fns[f.name] = (...a: CpuValue[]): CpuValue => {
        initPrivates();
        return inner(...a);
      };
    }
  }
  return {
    fns,
    setBinding: (name, value) => {
      runtime.bindings[name] = value;
      interp?.setBinding(name, value);
    },
    // Lockstep needs the interpreter's generators; the compiled functions run one invocation
    // to completion. The bindings are the runtime's own table, so arrays are shared.
    dispatch: (entry, workgroups) => dispatchCompute(m, entry, workgroups, runtime.bindings, opts),
  };
}
