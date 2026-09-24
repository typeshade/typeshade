// ═══ Shader DSL — fp64 lowering pass (f64 → vec2<f32> + df64_* calls) ═══
//
// The SINGLE authority for f64 semantics. Authoring carries f64 as a first-
// class ShaderType (`a.add(b)`, `sqrt(x)` — byte-identical surface to f32);
// this pre-emit pass rewrites every f64-typed IR node into the two-f32
// emulation (core/fp64/df64-lib.ts) so no backend ever sees the type:
//
//   lit(f64 v)            → vec2<f32>(hi, lo)            (splitF64 at build time)
//   a + - * / b           → df64_add/sub/mul/div(a, b)
//   a * a                 → df64_sqr(a)                  (one operand, no effect)
//   a * c, c * a, a / c   → pair * s                     (s = c or 1/c, ±2^k: exact;
//                                                         |s| > 1 needs a run-time a)
//   a < <= > >= == != b   → df64_lt/le/gt/ge/eq/ne(a, b)
//     on vecN<f64>        → df64_vN_lt/…/ne(a, b)        (a vecN<bool>, lane by lane)
//   -a                    → -(vec2 pair)                 (componentwise, exact)
//   sqrt/abs/min/max/mix/floor/fract/round/sin/cos → df64_*
//   abs/min/max/mix/floor/fract/round/normalize/sin/cos on vecN<f64> → df64_vN_*
//   f64(x)  (toF64)       → vec2<f32>(x, 0.0)            (exact widen)
//   f32(x)  (toF32 on f64)→ df64_narrow(x)               (hi + lo)
//   f64 param/var/field/binding/const → vec2<f32>        (type map)
//
// A mixed f64∘f32 operand (legal per binResultType) widens the f32 side as
// vec2<f32>(x, 0.0) — the widen authority lives HERE, nowhere else. Every
// OTHER builtin over an f64 operand is SD0041 (fail-loud, never native vec2
// math); an interpolated @location IO field of f64 is SD0044; the injected
// `df64_` name prefix is reserved (SD0043). A module whose lowering used any
// emulation helper additionally gets the `_fp64` guard uniform AUTO-INJECTED
// (see injectGuard below; a conflicting `_fp64`/`Fp64Guard` declaration is
// SD0042) — the host writes 1.0f into it (df64-lib's header explains why the
// guard must be a runtime input). The guard is read ONCE per function that calls
// a helper and handed down as a parameter, never fetched per helper call (see
// "The guard: fold its chains, read it once per function" below).
//
// Wiring: inside lowerForBackend (core/emit.ts), AFTER match-lower and BEFORE
// the backend optimizer — so WGSL, GLSL, and any future backend lower
// identically, and the optimizer only ever sees ordinary vec2/f32 IR plus
// opaque df64_* calls. The CPU oracle (oracle.ts) is deliberately NOT wired:
// it evaluates f64 natively as a JS number (JS numbers ARE f64 — the
// definitional semantics), which makes `oracle(fp64Lower(m)) ≈ oracle(m)` a
// metamorphic gate on this pass. Identity for modules with no f64 anywhere —
// same object out, so non-f64 emits stay byte-identical by construction.

import type {
  Expr,
  Stmt,
  FuncDecl,
  ModuleDecl,
  StructDecl,
  BindingDecl,
  ConstDecl,
  ModuleVarDecl,
  BinOp,
  CmpOp,
} from '../ir/nodes.js';
import { stageOf } from '../ir/nodes.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { F64_SCALAR_TWIN_FN, F64_VEC_TWIN_KIND } from '../fp64/twins.js';
import {
  type ShaderType,
  f32T,
  u32T,
  boolT,
  vec2fT,
  isF64,
  isVec64,
  isMat64,
  structT,
  typeKey,
} from '../ir/types.js';
import { dslError } from '../diagnostics/error.js';
import {
  DF64_FNS,
  DF64_ORDER,
  DF64_VEC_STRUCTS,
  DF64_MAT_STRUCTS,
  FP64_GUARD_NAME,
  FP64_GUARD_TYPE,
  splitF64,
} from '../fp64/df64-lib.js';
import { DF64_FNS_INT, DF64_ORDER_INT } from '../fp64/df64-int.js';
import { intElemOf, keyOf } from './opt/expr-utils.js';
import { exprHasEffect, fnWrites, type FnWrites } from './effects.js';

// ── Flavor (which EFT primitive registry backs the df64_* names) ──
//
// 'float'   — df64-lib's guarded float EFTs (the default; byte-identical emit).
// 'integer' — df64-int's integer-exact EFT primitives: the compositions are
//             shared, only the twoSum/twoProd/div/sqrt leaves (and the vec
//             twins) swap to integer bit arithmetic that a downstream shader
//             compiler's fast-math cannot reassociate. Proven on the Apple/
//             Metal oracle where every float formulation collapses; also
//             immune to ANGLE-D3D11/FXC's composed-tree folding. No `_fp64`
//             guard binding is injected (the integer bodies never read it).
/** Which arithmetic primitives back the emulated-double (`df64`) helper functions that
 *  {@link fp64Lower} injects. Both flavours compute the same values; they differ in what a
 *  target's shader compiler is able to do to them.
 *
 *  - `'float'`: the default. Error-free transforms written in float arithmetic, protected from
 *    constant folding by a runtime guard binding, `_fp64`, that the host fills with `1.0`.
 *  - `'integer'`: the `twoSum`, `twoProd`, division and square-root leaves are written in
 *    integer bit arithmetic; the compositions above them are shared with `'float'`. A fast-math
 *    pass cannot reassociate integer operations, so the hi/lo split survives on compilers that
 *    fold the float form (Apple Metal, and the ANGLE Direct3D 11 path through FXC). No guard
 *    binding is injected, because the integer bodies never read it.
 *
 *  Choose `'integer'` when a target's compiler folds the float primitives. The symptom is
 *  emulated-double results degrading to f32 precision on one platform while every other target
 *  is fine. {@link recommendFp64Flavor} picks a flavour from a device's adapter or renderer
 *  information.
 *
 *  Exported from `typeshade`.
 */
export type Fp64Flavor = 'float' | 'integer';

/** Options for {@link fp64Lower}.
 *
 *  Exported from `typeshade`.
 */
export interface Fp64LowerOptions {
  /** Which primitives back the injected `df64_*` helper functions. Omitting it selects
   *  `'float'`; see {@link Fp64Flavor} for when `'integer'` is the right choice. */
  readonly flavor?: Fp64Flavor;
}
import { isKnownIntrinsic } from '../intrinsics.js';

// ── Type mapping ──

/** Does this type contain f64 / vec64 / mat64 anywhere (directly or via arrays)? */
function containsF64(t: ShaderType): boolean {
  if (isF64(t) || isVec64(t) || isMat64(t)) return true;
  if (t.kind === 'array') return containsF64(t.elem);
  return false;
}

const vec64StructName = (n: 2 | 3 | 4): string => `DF64Vec${n}`;
const mat64StructName = (n: 2 | 3 | 4): string => `DF64Mat${n}`;
const vecFT = (n: 2 | 3 | 4): ShaderType => ({ kind: 'vec', n, elem: 'f32' });

/** f64 → vec2<f32>, vecN<f64> → DF64VecN, matNxN<f64> → DF64MatN, recursively
 *  through arrays; everything else unchanged. */
function mapType(t: ShaderType): ShaderType {
  if (isF64(t)) return vec2fT;
  if (isVec64(t)) return structT(vec64StructName(t.n));
  if (isMat64(t)) return structT(mat64StructName(mat64Dim(t)));
  if (t.kind === 'array' && containsF64(t.elem))
    return {
      kind: 'array',
      elem: mapType(t.elem),
      ...(t.size !== undefined ? { size: t.size } : {}),
    };
  return t;
}

const BINOP_FN: Partial<Record<BinOp, string>> = {
  '+': 'df64_add',
  '-': 'df64_sub',
  '*': 'df64_mul',
  '/': 'df64_div',
};
const CMP_FN: Record<CmpOp, string> = {
  '<': 'df64_lt',
  '>': 'df64_gt',
  '<=': 'df64_le',
  '>=': 'df64_ge',
  '==': 'df64_eq',
  '!=': 'df64_ne',
};
/** Whitelisted builtin ids on f64 operands → their df64 twin, and the shape of the
 *  componentwise `vec64` twins. Both tables live in fp64/twins.ts, because the front end
 *  reads them to refuse at the call span exactly what this pass cannot lower (#151). */
const CALL_FN = F64_SCALAR_TWIN_FN;
const VEC_CALL_KIND = F64_VEC_TWIN_KIND;

/** The dimension of an emulated-double matrix.
 *
 *  The df64 matrix library has one body per DIMENSION — `DF64MatN`, `df64_mN_matmul`,
 *  `df64_mN_matvec`, `df64_mN_transpose` — not one per shape, so only a SQUARE matrix of
 *  doubles can be lowered. The front end refuses a non-square one where it is written
 *  (`matCxR<f64>` in type-map.ts) and `binResultType` refuses one built any other way, so
 *  reaching here with cols !== rows means a module was hand-built past both: fail loud rather
 *  than emit a `DF64Mat3` for a `mat3x2<f64>` and let the backend spell nonsense (#149). */
const mat64Dim = (t: Extract<ShaderType, { kind: 'mat' }>): 2 | 3 | 4 => {
  if (t.cols !== t.rows) throw dslError('SD0041', `${typeKey(t)} — the df64 matrices are square`);
  return t.cols;
};

const litF32 = (v: number): Expr => ({ op: 'lit', type: f32T, value: v });
/** vec2<f32>(hi, lo) — the lowered spelling of an f64 literal. */
const pairLit = (v: number): Expr => {
  const [hi, lo] = splitF64(v);
  return { op: 'construct', type: vec2fT, args: [litF32(hi), litF32(lo)] };
};
/** vec2<f32>(x, 0.0) — the exact f32 → f64 widen. */
const widen = (x: Expr): Expr => ({ op: 'construct', type: vec2fT, args: [x, litF32(0)] });

/** An f32 literal the optimizer may not look THROUGH — the raw-IR spelling of
 *  `optBarrier` (ir/node.ts): `bitcast<f32>(bitcast<u32>(v))` on WGSL,
 *  `uintBitsToFloat(floatBitsToUint(v))` on GLSL, identity on the CPU oracle. The
 *  value is bit-identical to `v` on every target, and both halves are `call` nodes,
 *  so this buys opacity at zero arithmetic. */
const opaqueF32 = (v: number): Expr => ({
  op: 'call',
  type: f32T,
  fn: 'bitcastF32',
  args: [{ op: 'call', type: u32T, fn: 'bitcastU32', args: [litF32(v)] }],
});

/** vec2<f32>(0.0, 0.0) — the additive identity a raw df64 operand is renormalized
 *  against before a cancelling op (see the binop lowering; Apple df64 fix).
 *
 *  THE ZERO IS BARRIERED, and that is load-bearing rather than decorative. Written
 *  as a plain literal it is a `vec2(0, 0)` construct, and the moment ANY pass can
 *  resolve a member through its binding — `_cseN.x` back to the `0.0` it was built
 *  from, which `member-fold` now does — const-prop carries that zero into
 *  `df64_twoSum`'s `s = a + b` and the pre-existing `x + 0 -> x` identity deletes
 *  the add. That add IS the renorm: it is what launders a LOADED lo into a COMPUTED
 *  one, and X-GIS #915 paid for it on Apple `sub` and Blackwell WebGL2 `div`. Measured
 *  before the barrier: 408 flattened arithmetic ops -> 400.
 *
 *  Opacity here is by CONSTRUCTION, not by which folds happen to be absent —
 *  the distinction X-GIS #1972 was opened to correct. `member-fold.test.ts` pins both
 *  directions: the twoSum dies without this barrier and survives with it. */
const RENORM_ZERO: Expr = { op: 'construct', type: vec2fT, args: [opaqueF32(0), opaqueF32(0)] };

// ── vec64 expr utilities (post-lowering shapes over the DF64VecN struct) ──

const VEC_BINOP_FN: Partial<Record<BinOp, string>> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
};
const VEC_CMP_FN: Record<CmpOp, string> = {
  '<': 'lt',
  '>': 'gt',
  '<=': 'le',
  '>=': 'ge',
  '==': 'eq',
  '!=': 'ne',
};
/** base.hi / base.lo (base = a LOWERED DF64VecN expr). */
const plane = (base: Expr, n: 2 | 3 | 4, which: 'hi' | 'lo'): Expr => ({
  op: 'member',
  type: vecFT(n),
  base,
  field: which,
});
/** The f64 pair of one lane / a swizzle of lanes, reassembled from the planes.
 *  `base` is a pure lowered expr — it appears in BOTH planes (cse dedupes). */
const laneSwizzle = (base: Expr, n: 2 | 3 | 4, comps: string): Expr => {
  const pick = (which: 'hi' | 'lo'): Expr => ({
    op: 'member',
    type: comps.length === 1 ? f32T : vecFT(comps.length as 2 | 3 | 4),
    base: plane(base, n, which),
    field: comps,
  });
  return comps.length === 1
    ? { op: 'construct', type: vec2fT, args: [pick('hi'), pick('lo')] }
    : {
        op: 'construct',
        type: structT(vec64StructName(comps.length as 2 | 3 | 4)),
        args: [pick('hi'), pick('lo')],
      };
};
/** Splat a lowered f64 PAIR onto n lanes: DF64VecN(vecN(p.x), vecN(p.y)). */
const splatPair = (pair: Expr, n: 2 | 3 | 4): Expr => {
  const comp = (c: 'x' | 'y'): Expr => ({ op: 'member', type: f32T, base: pair, field: c });
  const fill = (c: 'x' | 'y'): Expr => ({ op: 'construct', type: vecFT(n), args: [comp(c)] });
  return { op: 'construct', type: structT(vec64StructName(n)), args: [fill('x'), fill('y')] };
};

// ── The per-module rewriter ──

interface LowerCtx {
  /** df64 helper names the rewrite referenced (pre-closure). */
  readonly used: Set<string>;
  /** vec64 lane counts seen anywhere — drives DF64VecN struct injection. */
  readonly vecWidths: Set<2 | 3 | 4>;
  /** mat64 dimensions seen — drives DF64MatN struct injection (and forces the
   *  matching DF64VecN, since a DF64MatN nests DF64VecN columns). */
  readonly matWidths: Set<2 | 3 | 4>;
  /** What each of the module's functions writes (passes/effects.ts): whether an operand may
   *  be evaluated once where it is written twice ("Cheaper multiplies" below). */
  readonly writes: FnWrites;
  /** The module's bindings and module-scope variables, name to lowered type key: a read of one
   *  is a run-time value (runtimeValue, "Cheaper multiplies" below). */
  readonly runtimeNames: ReadonlyMap<string, string>;
  /** The lowered type keys of the module's consts: the types a local or a parameter can take
   *  from a const by copy propagation (runtimeValue). */
  readonly constTypes: ReadonlySet<string>;
  /** The module's own function names: a call to one is never a constant (runtimeValue). */
  readonly fnNames: ReadonlySet<string>;
}

function callHelper(ctx: LowerCtx, name: string, type: ShaderType, args: Expr[]): Expr {
  ctx.used.add(name);
  return { op: 'call', type, fn: name, args };
}

/** A df64_* helper output — an already-normalized pair whose lo word was COMPUTED
 *  on-GPU (via a twoSum), so it survives a cancelling op. A non-helper operand (a
 *  uniform/attribute/texture LOAD, a widen, a lane swizzle over a loaded vec64)
 *  instead carries a LOADED lo that a driver's fast-math (Apple Metal, ANGLE/fxc)
 *  drops before the cancellation.
 *
 *  A SCALAR helper output scaled by a power of two other than ±1 (scalePair below) is one
 *  too: each word is multiplied by the literal on its own, so the lo word is the computed lo,
 *  exactly scaled. Before the scaling existed that operand WAS a call, `df64_mul(h, (2, 0))`,
 *  and read as a helper output here; seeing through the multiply keeps those decisions where
 *  they were. Three scaled operands are renormed before a cancelling op where the df64_mul
 *  (df64_vN_mul) they replace was not, because its quickTwoSums had recomputed their lo:
 *    - a scaled LOADED pair: its lo is the loaded lo, scaled, renormed like any loaded pair;
 *    - `h * -1.0`, which lowers to the negation `-h` and is renormed as an authored `-h`
 *      always was (this see-through reads the scale's multiply, not a negation);
 *    - a vec64 scale, which is a DF64VecN constructor over the planes of a named vector or of
 *      another constructor (never of a helper output: see "Cheaper multiplies"), and is
 *      renormed as any constructor is.
 *  Each renorm is one df64_add (df64_vN_add), and the scale plus the renorm still costs less
 *  than the multiply it replaced. */
const isHelperOutput = (x: Expr): boolean =>
  (x.op === 'call' && x.fn.startsWith('df64_')) || (isScaledPair(x) && isHelperOutput(x.a));

/** Renorm a raw df64 pair through df64_add(x, 0) before it feeds a CANCELLING op
 *  (sub/div): the twoSum recomputes the pair, turning a loaded lo into a computed
 *  lo that survives fast-math. Idempotent (exact for a normalized pair → oracle /
 *  metamorphic / render value unchanged) and opaque (a df64_ call, not a `+ 0`
 *  binop the optimizer would fold). A helper-output operand is already computed-lo
 *  and left as-is. On-device validated: probe dg_launder0 (Apple sub) and the
 *  Blackwell WebGL2 `div` recovery (X-GIS #915); extended here to the distance()
 *  composition's per-lane sub, whose raw operand is a lane of a loaded vec64. */
const renormForCancel = (ctx: LowerCtx, x: Expr): Expr =>
  isHelperOutput(x) ? x : callHelper(ctx, 'df64_add', vec2fT, [x, RENORM_ZERO]);

/** The vec64 twin of renormForCancel: renorm a raw DF64VecN through
 *  df64_v{n}_add(x, 0) before it feeds a cancelling vec64 op — binop sub/div, or a
 *  builtin whose body cancels per lane (fract → sub, mix → sub, normalize → div).
 *  splatPair(RENORM_ZERO) is DF64VecN(vecN(0), vecN(0)); same idempotent + opaque
 *  guarantees as the scalar renorm. abs/floor/min/max don't cancel and are left
 *  untouched. */
const renormForCancelVec = (ctx: LowerCtx, x: Expr, n: 2 | 3 | 4): Expr =>
  isHelperOutput(x)
    ? x
    : callHelper(ctx, `df64_v${n}_add`, structT(vec64StructName(n)), [
        x,
        splatPair(RENORM_ZERO, n),
      ]);

// ── Cheaper multiplies: the square, and exact power-of-two scaling ──
//
// Two kinds of f64 multiply do not need df64_mul's general two-product.
//
// THE SQUARE. `x * x` lowers to `df64_sqr(x)` (df64-lib says why it is exact and why its one
// renormalization is enough): one Veltkamp split instead of two, one cross term instead of two,
// one quickTwoSum instead of two. The Julia and Mandelbrot escape loops square both
// coordinates twice per iteration. It needs the two factors to be ONE value, evaluated once,
// which is two conditions on the AUTHORED operands:
//   - the same expression, by keyOf (opt/expr-utils.ts), the structural key CSE and GVN merge
//     on. Two operands with one key are the same tree — the same operators, the same names, the
//     same literal values and literal types — and the two sides of one binop are read in one
//     scope, so they name the same variables. Reusing the optimizer's own key means this pass
//     merges nothing the optimizer would keep apart.
//   - evaluating it has no effect (passes/effects.ts, the table the optimizer consults before
//     it dedupes a call). `f() * f()` over an `f` that writes a binding runs `f` twice as
//     written, and `df64_sqr(f())` would run it once, so that product stays df64_mul. Without
//     an effect nothing can change between the two evaluations: the IR has no assignment
//     EXPRESSION, so the second evaluation reads exactly what the first one read.
// The lowering's own lane squares (`length`, `distance`, and `dot(v, v)` under the same two
// conditions) take df64_sqr as well. A vec64 `v * v` stays df64_vN_mul: its square would need
// a whole-plane twoSqr the vector library does not have.
//
// POWER-OF-TWO SCALING. `x * c`, `c * x` and `x / c`, where c is a LITERAL (an f64 `lit`, the
// `f64(lit)` widen, or an f32 literal the mixed operand widens) and the scale s — c, or 1/c
// for the divide — is ±2^k with 2^-126 ≤ |s| ≤ 2^127, lower to `pair * s`: the vec2<f32> times
// an f32 literal, two multiplies where df64_mul(x, (s, 0)) is 37 operations. Exact under
// round-to-nearest: scaling by a power of two moves each word's exponent and leaves its
// significand alone, so hi·s and lo·s are both exact, barring a word that overflows or leaves
// the normal range (df64_mul gives the same words there, and its split overflows sooner). A
// normalized pair stays normalized: |lo| ≤ ulp(hi)/2 scales to |lo·s| ≤ ulp(hi·s)/2. A pair
// that is NOT normalized (a hand-packed uniform, an `f64FromParts` of two arbitrary words) stays
// exactly as un-normalized as it came in, where df64_mul's quickTwoSums would have renormalized
// it; that input is outside the emulation's contract either way (f64FromParts says so), and a
// comparison, which decides on hi first, already answered wrongly for it before any scale. The
// range keeps s a NORMAL f32, so the literal is exactly s on every target (splitF64 gives
// hi = s, lo = 0) and no target can flush it to zero. df64-property.test.ts compares the scaled
// pair against the df64_mul it replaces on random inputs of both signs across 2^±60.
//   - s == 1 is the identity: the operand, and no multiply.
//   - s == -1 is the componentwise negation `-x` already lowers to.
//   - any other negative s is the same scaling: negating a word is exact too.
//   - c == 0 is not a power of two and keeps df64_mul. `x * 0` moves no exponent, and its sign
//     and its answer for a NaN or infinite x are df64_mul's to give, not a new rule here.
// A divide by such a c is a multiply, so it cancels nothing and takes no renormForCancel:
// there is no error-free transform downstream of it for a fast-math compiler to fold, only two
// independent word multiplies.
//
// A SCALE THAT CAN GROW A WORD NEEDS A RUN-TIME OPERAND. WGSL evaluates a const-expression when
// it creates the shader module and an override-expression when it creates the pipeline, and a
// result outside the f32 range is an ERROR there, not an infinity. Measured on Tint:
// `vec2<f32>(9.999999680285692e+37, …) * 4.0` (from `f64(1e38) * 4.`) fails createShaderModule
// with "cannot be represented as 'f32'", and `vec2<f32>(scale, 0.0) * 2^100` over an override
// `scale = 3e30` fails createRenderPipeline the same way, although the branch holding it may
// never run. df64_mul over the same operand is a call, which WGSL evaluates at run time, where the
// overflow is an infinity as in any other f64 operation; WebGL2 compiles both spellings. So a scale
// with |s| > 1 is taken only over an operand `runtimeValue` proves is computed at run time, and
// stays so through the optimizer that runs after this pass. That second half is where the cases
// hide: const-prop turns the local `k` of `let k = 1e38` into the literal inside
// `vec2<f32>(k, 0.0)`, and copy-prop turns a copy of a module const into the const. |s| ≤ 1 needs
// no proof: it cannot grow a word, and an underflowing constant word is not an error (Tint accepts
// `vec2<f32>(1e-38, 1e-45) * 0.5` and `vec2<f32>(1e-30, 1e-37) * 2^-120`). Every scaling in the
// fp64 examples scales a df64 helper's output, which is a call and so a run-time value; none of
// them is given up.
//
// The vec64 form falls out of the plane layout: `v * c` is `DF64VecN(v.hi * s, v.lo * s)`, which
// spells `v` in both planes. It is taken only where that costs nothing: `v` is a NAMED value (a
// local, a parameter, a binding, a member or an element of one), read twice and computed never,
// or a DF64VecN constructor, whose two plane arguments are scaled where they stand. Any other `v`,
// a df64_vN_* helper's output above all, would be COMPUTED twice wherever CSE does not run: at O0,
// and in every function with an effectful call, which cse, gvn and licm skip. That `v` keeps
// df64_vN_mul, and pays for it where CSE would have shared the planes: a compute entry whose
// vec3 midpoint is `(u + w) * 0.5` counts 206 f32 operations (callees expanded) against 105
// scaled. Where CSE does not reach, the scale was the expensive one: an entry with a writing call
// and `normalize(u * w) * 2.0` counts 884 against 1556 scaled. A df64_vN_scale helper would take
// the vector once and scale it inside; it does not exist yet. A `v` that is taken must also pass
// the same run-time test as a scalar operand.

/** `a` and `b` are one value evaluated once: the same expression under the optimizer's key,
 *  and an evaluation with no effect. Both are the AUTHORED operands. */
const oneValue = (a: Expr, b: Expr, ctx: LowerCtx): boolean =>
  typeKey(a.type) === typeKey(b.type) && keyOf(a) === keyOf(b) && !exprHasEffect(a, ctx.writes);

/** The numeric value of a literal f64 operand: an f64 `lit`, an f32 `lit` (a mixed operand
 *  widens it exactly), or the `f64(lit)` widen of one. */
function literalValue(x: Expr): number | undefined {
  if (x.op === 'call' && x.fn === 'f64' && x.args.length === 1) return literalValue(x.args[0]!);
  if (x.op !== 'lit' || typeof x.value !== 'number') return undefined;
  return isF64(x.type) || (x.type.kind === 'scalar' && x.type.scalar === 'f32')
    ? x.value
    : undefined;
}

/** The scale an operand literal applies — c for a multiply, 1/c for a divide — when that is
 *  ±2^k within the normal f32 range; undefined for anything else, 0 included. */
function exactScale(x: Expr, divide: boolean): number | undefined {
  const c = literalValue(x);
  if (c === undefined) return undefined;
  const s = divide ? 1 / c : c;
  const m = Math.abs(s);
  // The range test also turns away 0 (whose reciprocal is ∞), NaN and ∞.
  if (!(m >= 2 ** -126 && m <= 2 ** 127)) return undefined;
  return 2 ** Math.round(Math.log2(m)) === m ? s : undefined;
}

/** `x` is a lowered pair scaled by scalePair: `pair * <f32 literal>`. No other lowering
 *  multiplies a pair natively, so the shape is scalePair's alone. */
function isScaledPair(x: Expr): x is Extract<Expr, { op: 'binop' }> {
  return (
    x.op === 'binop' && x.bop === '*' && typeKey(x.type) === typeKey(vec2fT) && x.b.op === 'lit'
  );
}

/** A lowered f64 pair times the exact power-of-two scale `s`. */
function scalePair(pair: Expr, s: number): Expr {
  if (s === 1) return pair;
  if (s === -1) return { op: 'unop', type: vec2fT, a: pair };
  return { op: 'binop', type: vec2fT, bop: '*', a: pair, b: litF32(s) };
}

/** A LOWERED expression is a run-time value: WGSL cannot evaluate it while it creates the shader
 *  module or the pipeline, and no pass after this one can make it a constant ("Cheaper
 *  multiplies" says why a scale asks). Conservative: false means "not proven", and costs only
 *  the cheaper multiply.
 *   - A df64_* helper call, or a call to one of the module's functions. WGSL evaluates no user
 *     function as a constant, and no optimizer pass folds a call. (The opt-in inline plugins
 *     lift an inlined body's result into a `let`, which is a run-time value.)
 *   - A binding or a module-scope variable: its value arrives at run time.
 *   - A local or a parameter of a NON-SCALAR type that none of the module's consts has.
 *     const-prop substitutes only a local bound to a `lit`, which is a scalar, and copy-prop only
 *     a bare copy, so such a name can become a constant only as a copy of a const of its own
 *     type. A scalar name is not proven: `let k = 1e38` becomes the literal. A parameter is
 *     treated as a local because the opt-in inline plugins bind it to a `let` of its argument.
 *   - A member, an element, a negation or a constructor of a run-time value; a float binop with
 *     a run-time operand (opt/algebraic.ts drops only a literal float operand); a builtin call
 *     with a run-time argument (const-fold folds a builtin only over literals); a select whose
 *     two arms both are (its condition may fold to either).
 *  Anything else is not proven: literals, consts, overrides, host externs (the host may declare
 *  one `const`), integer arithmetic (whose `i * 0` rewrite drops an operand), comparisons. */
function runtimeValue(x: Expr, ctx: LowerCtx): boolean {
  const rt = (y: Expr): boolean => runtimeValue(y, ctx);
  const namedNonScalar = (t: ShaderType): boolean =>
    t.kind !== 'scalar' && !ctx.constTypes.has(typeKey(t));
  switch (x.op) {
    case 'varref':
      return ctx.runtimeNames.get(x.name) === typeKey(x.type) || namedNonScalar(x.type);
    case 'param':
      return namedNonScalar(x.type);
    case 'call':
      return x.fn.startsWith('df64_') || ctx.fnNames.has(x.fn) || x.args.some(rt);
    case 'member':
    case 'index':
      return rt(x.base);
    case 'unop':
      return rt(x.a);
    case 'construct':
      return x.args.some(rt);
    case 'binop':
      return intElemOf(x.type) === undefined && (rt(x.a) || rt(x.b));
    case 'select':
      return rt(x.ifTrue) && rt(x.ifFalse);
    default:
      return false;
  }
}

/** The scale `s` may be applied to the lowered operand `pair` without a constant overflowing
 *  at shader or pipeline creation: it cannot grow a word, or the operand is a run-time value. */
const scaleIsSafe = (pair: Expr, s: number, ctx: LowerCtx): boolean =>
  Math.abs(s) <= 1 || runtimeValue(pair, ctx);

/** A lowered DF64VecN's two planes, each spelled once, when naming them costs nothing: a
 *  constructor's own two arguments, or the `.hi` / `.lo` of a named value (a local, a parameter,
 *  a const, a binding, or a member or element of one at a named or literal index), which is read
 *  twice and computed never. undefined for anything that would be computed twice. */
function vecPlanes(v: Expr, n: 2 | 3 | 4): [hi: Expr, lo: Expr] | undefined {
  if (v.op === 'construct' && v.args.length === 2) return [v.args[0]!, v.args[1]!];
  const named = (x: Expr): boolean =>
    x.op === 'varref' || x.op === 'param' || x.op === 'constref'
      ? true
      : x.op === 'member'
        ? named(x.base)
        : x.op === 'index'
          ? named(x.base) && (x.idx.op === 'lit' || named(x.idx))
          : false;
  return named(v) ? [plane(v, n, 'hi'), plane(v, n, 'lo')] : undefined;
}

/** A lowered DF64VecN's planes times the exact power-of-two scale `s` (never 1). */
function scaleVec(planes: [Expr, Expr], n: 2 | 3 | 4, s: number): Expr {
  const scaled = (p: Expr): Expr =>
    s === -1
      ? { op: 'unop', type: vecFT(n), a: p }
      : { op: 'binop', type: vecFT(n), bop: '*', a: p, b: litF32(s) };
  return {
    op: 'construct',
    type: structT(vec64StructName(n)),
    args: [scaled(planes[0]), scaled(planes[1])],
  };
}

/** `f`, evaluated at most once: an operand lowered for the cheaper form is the same lowered
 *  operand the general helper takes when the cheaper form is turned down. */
function once(f: () => Expr): () => Expr {
  let v: Expr | undefined;
  return () => (v ??= f());
}

/** The cheaper lowering of an f64 `a * b` or `a / b` over AUTHORED operands, or undefined
 *  when neither applies and the product takes df64_mul / df64_div. `la` / `lb` lower an
 *  operand to its pair (the caller's widen rules), once. */
function cheapMulDiv(
  bop: '*' | '/',
  a: Expr,
  b: Expr,
  ctx: LowerCtx,
  la: () => Expr,
  lb: () => Expr,
): Expr | undefined {
  const sb = exactScale(b, bop === '/');
  if (sb !== undefined && scaleIsSafe(la(), sb, ctx)) return scalePair(la(), sb);
  if (bop === '/') return undefined;
  const sa = exactScale(a, false);
  if (sa !== undefined && scaleIsSafe(lb(), sa, ctx)) return scalePair(lb(), sa);
  return isF64(a.type) && oneValue(a, b, ctx)
    ? callHelper(ctx, 'df64_sqr', vec2fT, [la()])
    : undefined;
}

function lowerExpr(e: Expr, ctx: LowerCtx): Expr {
  const walk = (x: Expr): Expr => lowerExpr(x, ctx);
  if (isVec64(e.type)) ctx.vecWidths.add(e.type.n);
  // A DF64MatN nests DF64VecN columns, so a mat width forces its vec width too.
  if (isMat64(e.type)) {
    const n = mat64Dim(e.type);
    ctx.matWidths.add(n);
    ctx.vecWidths.add(n);
  }
  /** Lower an expr that must land as an f64 PAIR: an f64 operand lowers to its
   *  vec2 form; a (legal) f32 operand widens exactly. Anything else is a gate
   *  bug upstream — binResultType/cmp admit only f64 and f32-scalar here. */
  const pairOperand = (x: Expr): Expr => {
    if (isF64(x.type)) return walk(x);
    if (x.type.kind === 'scalar' && x.type.scalar === 'f32') return widen(walk(x));
    throw dslError('SD0041', `f64 op with a ${typeKey(x.type)} operand`);
  };
  /** Lower an expr that must land as a DF64VecN struct: a vec64 operand lowers
   *  directly; an f64 / f32 scalar broadcasts onto the lanes. */
  const vecOperand = (x: Expr, n: 2 | 3 | 4): Expr => {
    if (isVec64(x.type)) return walk(x);
    return splatPair(pairOperand(x), n);
  };
  /** The f64 pair of lane i of a lowered vec64 expr. */
  const lane = (lowered: Expr, n: 2 | 3 | 4, i: number): Expr =>
    laneSwizzle(lowered, n, 'xyzw'[i]!);

  switch (e.op) {
    case 'lit':
      return isF64(e.type) ? pairLit(e.value as number) : e;
    case 'constref':
    case 'externref': // X-GIS #1713 — a host-provided global is spelled by the host, never lowered
    case 'overrideref': // X-GIS #923 — a specialization constant is a WGSL scalar, never f64
    case 'param':
    case 'varref':
      return containsF64(e.type) ? { ...e, type: mapType(e.type) } : e;
    case 'binop': {
      // mat64 as the LEFT operand: M*v (→ vec64) or M*M (→ mat64). Intercepted
      // on the operand type, not e.type — a matvec RESULT is itself a vec64 and
      // would misroute into the componentwise vec64 branch below.
      if (isMat64(e.a.type)) {
        if (e.bop !== '*') throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.a.type)}`);
        const n = mat64Dim(e.a.type);
        if (isMat64(e.b.type))
          return callHelper(ctx, `df64_m${n}_matmul`, structT(mat64StructName(n)), [
            walk(e.a),
            walk(e.b),
          ]);
        if (isVec64(e.b.type))
          return callHelper(ctx, `df64_m${n}_matvec`, structT(vec64StructName(n)), [
            walk(e.a),
            walk(e.b),
          ]);
        throw dslError('SD0041', `matNxN<f64> '*' with a ${typeKey(e.b.type)} operand`);
      }
      if (isVec64(e.type)) {
        const n = e.type.n;
        const op = VEC_BINOP_FN[e.bop];
        if (op === undefined)
          throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.type)}`);
        // A vec64 times (or over) an exact power-of-two literal scales its two planes
        // ("Cheaper multiplies" above): over a vector whose planes are named without computing
        // it twice, and with a scale that is safe for WGSL's constant evaluation. Neither form
        // vecPlanes accepts evaluates anything twice, so an effect needs no check of its own:
        // a writing call is not a named value, and a constructor's plane arguments are used once.
        const va = once(() => vecOperand(e.a, n));
        const vb = once(() => vecOperand(e.b, n));
        if (op === 'mul' || op === 'div') {
          const sb = isVec64(e.a.type) ? exactScale(e.b, op === 'div') : undefined;
          const sa = op === 'mul' && isVec64(e.b.type) ? exactScale(e.a, false) : undefined;
          const [lv, s] = sb !== undefined ? [va, sb] : [vb, sa];
          if (s !== undefined) {
            if (s === 1) return lv();
            const planes = vecPlanes(lv(), n);
            if (planes !== undefined && scaleIsSafe(lv(), s, ctx)) return scaleVec(planes, n, s);
          }
        }
        // Same raw-operand renorm as the scalar path — a cancelling vec64 sub/div
        // over a loaded DF64VecN drops its lo plane under fast-math.
        const renorm = (x: Expr): Expr =>
          op === 'sub' || op === 'div' ? renormForCancelVec(ctx, x, n) : x;
        return callHelper(ctx, `df64_v${n}_${op}`, structT(vec64StructName(n)), [
          renorm(va()),
          renorm(vb()),
        ]);
      }
      if (isF64(e.type)) {
        const fnName = BINOP_FN[e.bop];
        if (fnName === undefined)
          throw dslError('SD0041', `binary op '${e.bop}' on ${typeKey(e.a.type)}`);
        const la = once(() => pairOperand(e.a));
        const lb = once(() => pairOperand(e.b));
        // A square or an exact power-of-two scale ("Cheaper multiplies" above).
        if (e.bop === '*' || e.bop === '/') {
          const cheap = cheapMulDiv(e.bop, e.a, e.b, ctx, la, lb);
          if (cheap !== undefined) return cheap;
        }
        // Apple/ANGLE df64 fix: a RAW df64 operand feeding a CANCELLING op
        // (sub/div) loses its loaded lo word under fast-math — renorm it first
        // (see renormForCancel). add/mul don't cancel and are left untouched.
        const renorm = (x: Expr): Expr =>
          fnName === 'df64_sub' || fnName === 'df64_div' ? renormForCancel(ctx, x) : x;
        return callHelper(ctx, fnName, vec2fT, [renorm(la()), renorm(lb())]);
      }
      return { ...e, a: walk(e.a), b: walk(e.b) };
    }
    case 'unop': {
      // Componentwise negation of a (hi, lo) pair is exact — no helper needed.
      if (isF64(e.type)) return { op: 'unop', type: vec2fT, a: pairOperand(e.a) };
      if (isVec64(e.type)) {
        const n = e.type.n;
        const base = walk(e.a);
        const negPlane = (which: 'hi' | 'lo'): Expr => ({
          op: 'unop',
          type: vecFT(n),
          a: plane(base, n, which),
        });
        return {
          op: 'construct',
          type: structT(vec64StructName(n)),
          args: [negPlane('hi'), negPlane('lo')],
        };
      }
      return { ...e, a: walk(e.a) };
    }
    case 'compare':
      if (isF64(e.a.type) || isF64(e.b.type)) {
        return callHelper(ctx, CMP_FN[e.cop], boolT, [pairOperand(e.a), pairOperand(e.b)]);
      }
      // Two vec64s of one width compare lane by lane into a vector of bools (§27), each operand
      // evaluated once, as the helper's argument. Any other vec64 comparison was built past the
      // front end: WGSL compares no scalar with a vector, and a scalar bool result is the
      // mistyping that sent `if (a < b)` to WGSL as a `<` on two structs.
      if (isVec64(e.a.type) || isVec64(e.b.type)) {
        const t = e.a.type;
        if (
          !isVec64(t) ||
          typeKey(e.b.type) !== typeKey(t) ||
          typeKey(e.type) !== typeKey({ kind: 'vec', n: t.n, elem: 'bool' })
        ) {
          throw dslError(
            'SD0041',
            `compare '${e.cop}' of ${typeKey(e.a.type)} and ${typeKey(e.b.type)} typed ` +
              `${typeKey(e.type)}; two vec64s of one width compare into a vector of bools`,
          );
        }
        return callHelper(ctx, `df64_v${t.n}_${VEC_CMP_FN[e.cop]}`, e.type, [walk(e.a), walk(e.b)]);
      }
      return { ...e, a: walk(e.a), b: walk(e.b) };
    case 'logical':
      return { ...e, a: walk(e.a), b: walk(e.b) };
    case 'call': {
      // toF64 / the f64() widen call — exact, no helper.
      if (e.fn === 'f64') {
        const a = e.args[0]!;
        return isF64(a.type) ? walk(a) : widen(walk(a));
      }
      // f64FromParts(hi, lo) — the pair IS the representation: construct it.
      if (e.fn === 'f64FromParts') {
        return { op: 'construct', type: vec2fT, args: [walk(e.args[0]!), walk(e.args[1]!)] };
      }
      // f64Parts(x) — identity: post-lowering an f64 already is its vec2 pair.
      if (e.fn === 'f64Parts') {
        return walk(e.args[0]!);
      }
      // toF32 on an f64 argument — the explicit narrow (hi + lo).
      if (e.fn === 'f32' && e.args.length === 1 && isF64(e.args[0]!.type)) {
        return callHelper(ctx, 'df64_narrow', f32T, [walk(e.args[0]!)]);
      }
      // transpose(M) on a mat64 → df64_mN_transpose (gathers lane i of every
      // old column into new column i — no new numerics, only a reshuffle).
      if (e.fn === 'transpose' && isMat64(e.args[0]!.type)) {
        const n = mat64Dim(e.args[0]!.type);
        return callHelper(ctx, `df64_m${n}_transpose`, structT(mat64StructName(n)), [
          walk(e.args[0]!),
        ]);
      }
      // Any OTHER builtin over a mat64 operand is unsupported — fail loud rather
      // than leak a bare `transpose`/`inverse`/… call the backend can't spell.
      if (isMat64(e.type) || e.args.some((a) => isMat64(a.type))) {
        if (isKnownIntrinsic(e.fn)) throw dslError('SD0041', `${e.fn}() on mat64 operands`);
      }
      // Cross-lane reductions on vec64 — composed from the SCALAR df64 fns
      // (dot must accumulate in extended precision anyway). The walked base
      // exprs repeat per lane, for cse/the driver to dedupe (the caveat is below).
      if (
        (e.fn === 'dot' || e.fn === 'length' || e.fn === 'distance') &&
        isVec64(e.args[0]!.type)
      ) {
        const n = (e.args[0]!.type as Extract<ShaderType, { kind: 'vec64' }>).n;
        // Each lane is squared by df64_sqr, which takes the lane once where df64_mul(li, li)
        // took it twice ("Cheaper multiplies" above). That halves the copies of the vector
        // operand, and does not remove them: every lane still spells the lowered vector in its
        // hi and its lo swizzle, so a vector operand is written 2n times, and a call inside it
        // runs 2n times wherever CSE does not merge the copies. For a call that writes, that is
        // wrong, not just slow; it predates the square and is not fixed here.
        const sumSquares = (laneAt: (i: number) => Expr): Expr => {
          let acc: Expr | undefined;
          for (let i = 0; i < n; i++) {
            const sq = callHelper(ctx, 'df64_sqr', vec2fT, [laneAt(i)]);
            acc = acc === undefined ? sq : callHelper(ctx, 'df64_add', vec2fT, [acc, sq]);
          }
          return acc!;
        };
        if (e.fn === 'dot') {
          // dot(v, v) is Σ vᵢ² when v is one value evaluated once.
          if (oneValue(e.args[0]!, e.args[1]!, ctx)) {
            const v = walk(e.args[0]!);
            return sumSquares((i) => lane(v, n, i));
          }
          const a = walk(e.args[0]!);
          const b = walk(e.args[1]!);
          let acc: Expr | undefined;
          for (let i = 0; i < n; i++) {
            const prod = callHelper(ctx, 'df64_mul', vec2fT, [lane(a, n, i), lane(b, n, i)]);
            acc = acc === undefined ? prod : callHelper(ctx, 'df64_add', vec2fT, [acc, prod]);
          }
          return acc!;
        }
        if (e.fn === 'length') {
          const a = walk(e.args[0]!);
          return callHelper(ctx, 'df64_sqrt', vec2fT, [sumSquares((i) => lane(a, n, i))]);
        }
        // distance: √Σ (aᵢ − bᵢ)²  — per-lane scalar subtraction. Each lane is a
        // raw pair sliced out of a loaded vec64 (loaded lo), so this cancelling
        // sub needs the same renorm the scalar binop path applies (Blackwell
        // WebGL2 `loran` collapse — the vec64 twin of the X-GIS #915 scalar sub/div bug).
        const a = walk(e.args[0]!);
        const b = walk(e.args[1]!);
        return callHelper(ctx, 'df64_sqrt', vec2fT, [
          sumSquares((i) =>
            callHelper(ctx, 'df64_sub', vec2fT, [
              renormForCancel(ctx, lane(a, n, i)),
              renormForCancel(ctx, lane(b, n, i)),
            ]),
          ),
        ]);
      }
      // Componentwise vec64 builtins → their df64_vN_* twins. Each helper
      // composes the verified SCALAR df64 fns lane by lane INSIDE its body
      // (abs/min/max/floor branch per lane — no whole-plane form exists
      // without a per-lane select), so the operand is evaluated exactly once
      // as the call argument.
      if (isVec64(e.type) && VEC_CALL_KIND[e.fn] !== undefined) {
        const n = e.type.n;
        const sTy = structT(vec64StructName(n));
        const kind = VEC_CALL_KIND[e.fn]!;
        if (kind === 'unary') {
          // fract and round (per-lane sub), normalize (per-lane div), and sin/cos
          // (their reduction's per-lane df64_div/df64_sub) cancel internally, so a
          // loaded operand needs the renorm; abs/floor do not cancel.
          const arg = vecOperand(e.args[0]!, n);
          const cancels =
            e.fn === 'fract' ||
            e.fn === 'round' ||
            e.fn === 'normalize' ||
            e.fn === 'sin' ||
            e.fn === 'cos';
          const a = cancels ? renormForCancelVec(ctx, arg, n) : arg;
          return callHelper(ctx, `df64_v${n}_${e.fn}`, sTy, [a]);
        }
        if (kind === 'binary') {
          return callHelper(ctx, `df64_v${n}_${e.fn}`, sTy, [
            vecOperand(e.args[0]!, n),
            vecOperand(e.args[1]!, n),
          ]);
        }
        // mix(a, b, t): a/b are vec64 (or broadcast); t stays a SCALAR f32 —
        // the same contract as the scalar df64_mix (per-lane vec t unsupported).
        const t = e.args[2]!;
        if (!(t.type.kind === 'scalar' && t.type.scalar === 'f32')) {
          throw dslError(
            'SD0041',
            `mix() on vec64 needs a scalar f32 interpolant, got ${typeKey(t.type)}`,
          );
        }
        // mix's body cancels via df64_sub(b, a) per lane — renorm a/b (not t).
        return callHelper(ctx, `df64_v${n}_mix`, sTy, [
          renormForCancelVec(ctx, vecOperand(e.args[0]!, n), n),
          renormForCancelVec(ctx, vecOperand(e.args[1]!, n), n),
          walk(t),
        ]);
      }
      // Any OTHER builtin over a vec64 is unsupported — fail loud.
      if (isVec64(e.type) || e.args.some((a) => isVec64(a.type))) {
        if (isKnownIntrinsic(e.fn) || e.fn === 'i32' || e.fn === 'u32' || e.fn === 'f32') {
          throw dslError('SD0041', `${e.fn}() on vec64 operands`);
        }
      }
      const touchesF64 = isF64(e.type) || e.args.some((a) => isF64(a.type));
      if (touchesF64) {
        const mapped = CALL_FN[e.fn];
        if (mapped !== undefined) {
          if (e.fn === 'mix') {
            // mix(a, b, t): a/b are the f64 pair operands; t stays f32. The body
            // cancels via df64_sub(b, a), so a raw operand needs the renorm.
            const t = e.args[2]!;
            if (isF64(t.type))
              throw dslError('SD0041', 'mix() interpolant t must be f32 (narrow it with toF32)');
            return callHelper(ctx, mapped, vec2fT, [
              renormForCancel(ctx, pairOperand(e.args[0]!)),
              renormForCancel(ctx, pairOperand(e.args[1]!)),
              walk(t),
            ]);
          }
          // fract's body cancels via df64_sub(a, floor(a)); sin/cos cancel on the
          // operand too (the reduction's df64_div(a, 2π) / df64_sub(a, …) are the
          // FIRST ops on a, so a loaded lo must be recomputed first). The other
          // whitelisted scalar builtins (sqrt/abs/floor/min/max) don't cancel.
          if (e.fn === 'fract' || e.fn === 'round' || e.fn === 'sin' || e.fn === 'cos') {
            return callHelper(ctx, mapped, vec2fT, [renormForCancel(ctx, pairOperand(e.args[0]!))]);
          }
          const ret = isF64(e.type) ? vec2fT : mapType(e.type);
          return callHelper(ctx, mapped, ret, e.args.map(pairOperand));
        }
        // Any OTHER builtin on f64 is unsupported — fail loud, never emit
        // native vec2 math for it. User/extern fns pass through (their param
        // types are mapped with their decls; the type checker already matched
        // the f64 signature at authoring).
        if (isKnownIntrinsic(e.fn) || e.fn === 'i32' || e.fn === 'u32') {
          throw dslError('SD0041', `${e.fn}() on f64 operands`);
        }
      }
      return { ...e, type: mapType(e.type), args: e.args.map(walk) };
    }
    case 'member':
      // A component / swizzle of a vec64 reassembles from the hi/lo planes:
      // v.x → vec2<f32>(v.hi.x, v.lo.x); v.xy → DF64Vec2(v.hi.xy, v.lo.xy).
      if (isVec64(e.base.type)) {
        return laneSwizzle(walk(e.base), e.base.type.n, e.field);
      }
      return { ...e, type: mapType(e.type), base: walk(e.base) };
    case 'construct': {
      // vecNf64(…) — gather the lowered lane pairs into the two planes:
      // DF64VecN(vecN(p0.x, p1.x, …), vecN(p0.y, p1.y, …)). A single argument
      // splats (WGSL-style) via the same shape.
      if (e.type.kind === 'vec64') {
        const n = e.type.n;
        const pairs = e.args.map(pairOperand);
        const planeOf = (c: 'x' | 'y'): Expr => ({
          op: 'construct',
          type: vecFT(n),
          args: pairs.map((pr): Expr => ({ op: 'member', type: f32T, base: pr, field: c })),
        });
        return {
          op: 'construct',
          type: structT(vec64StructName(n)),
          args: [planeOf('x'), planeOf('y')],
        };
      }
      // matNf64(col0, …, col(N-1)) — gather the lowered vec64 columns into a
      // DF64MatN. Each column arg lowers via vecOperand (vec64 direct, scalar
      // broadcast), so the column-major struct is assembled directly.
      if (e.type.kind === 'mat' && e.type.elem === 'f64') {
        const n = mat64Dim(e.type);
        return {
          op: 'construct',
          type: structT(mat64StructName(n)),
          args: e.args.map((a) => vecOperand(a, n)),
        };
      }
      // array<f64, N>(…) and struct constructors may legally take f64 args
      // (the element/field types map alongside); a vec/mat construct with an
      // f64 / vec64 component has no meaning — reject.
      if (
        (e.type.kind === 'vec' || e.type.kind === 'mat') &&
        e.args.some((a) => isF64(a.type) || isVec64(a.type))
      ) {
        throw dslError('SD0041', `${typeKey(e.type)} constructor with an f64 component`);
      }
      return { ...e, type: mapType(e.type), args: e.args.map(walk) };
    }
    case 'select':
      return {
        ...e,
        type: mapType(e.type),
        cond: walk(e.cond),
        ifTrue: walk(e.ifTrue),
        ifFalse: walk(e.ifFalse),
      };
    case 'index':
      return { ...e, type: mapType(e.type), base: walk(e.base), idx: walk(e.idx) };
    case 'matchExpr': {
      // Normally already lowered (match-lower runs first in lowerForBackend);
      // handled anyway so a direct fp64Lower(m) call (tests, oracle
      // metamorphic gate) accepts an authored module.
      if (isF64(e.scrutinee.type))
        throw dslError('SD0041', 'matchExpr scrutinee must be an integer scalar, got f64');
      return {
        ...e,
        type: mapType(e.type),
        scrutinee: walk(e.scrutinee),
        cases: e.cases.map(([v, x]) => [v, walk(x)] as const),
        default: walk(e.default),
      };
    }
  }
}

function lowerStmt(s: Stmt, ctx: LowerCtx): Stmt {
  const walk = (x: Expr): Expr => lowerExpr(x, ctx);
  switch (s.s) {
    case 'let':
      return { ...s, expr: walk(s.expr) };
    case 'var':
      return {
        ...s,
        type: mapType(s.type),
        ...(s.init !== undefined ? { init: walk(s.init) } : {}),
      };
    case 'assign': {
      // A vec64 target takes a vec64 value only (no implicit scalar splat on
      // assignment — WGSL has none either).
      if (isVec64(s.target.type) && !isVec64(s.expr.type)) {
        throw dslError(
          'SD0041',
          `assign of ${typeKey(s.expr.type)} to a ${typeKey(s.target.type)} target`,
        );
      }
      // An f64 target may legally receive an f32 value (ArithArg widen) —
      // wrap it here, the one widen authority.
      if (isF64(s.target.type) && !isF64(s.expr.type)) {
        const value =
          s.expr.type.kind === 'scalar' && s.expr.type.scalar === 'f32'
            ? widen(walk(s.expr))
            : (() => {
                throw dslError('SD0041', `assign of ${typeKey(s.expr.type)} to an f64 target`);
              })();
        return { s: 'assign', target: walk(s.target), expr: value };
      }
      return { ...s, target: walk(s.target), expr: walk(s.expr) };
    }
    case 'call':
      return { ...s, expr: walk(s.expr) };
    case 'assignOp': {
      // `x += v` on a vec64 target — rewrite to `x = df64_vN_add(x, v)`.
      if (isVec64(s.target.type)) {
        const n = s.target.type.n;
        const op = VEC_BINOP_FN[s.bop];
        if (op === undefined)
          throw dslError('SD0041', `compound assign '${s.bop}=' on ${typeKey(s.target.type)}`);
        const target = lowerExpr(s.target, ctx);
        ctx.used.add(`df64_v${n}_${op}`);
        const rhs = isVec64(s.expr.type)
          ? lowerExpr(s.expr, ctx)
          : (() => {
              throw dslError('SD0041', `'${s.bop}=' of ${typeKey(s.expr.type)} on vec64`);
            })();
        return {
          s: 'assign',
          target,
          expr: {
            op: 'call',
            type: structT(vec64StructName(n)),
            fn: `df64_v${n}_${op}`,
            args: [target, rhs],
          },
        };
      }
      // `x += v` on an f64 target has no native spelling — rewrite to
      // `x = df64_add(x, v)`.
      if (isF64(s.target.type)) {
        const fnName = BINOP_FN[s.bop];
        if (fnName === undefined) throw dslError('SD0041', `compound assign '${s.bop}=' on f64`);
        const target = walk(s.target);
        const rhs = once(() =>
          isF64(s.expr.type)
            ? walk(s.expr)
            : s.expr.type.kind === 'scalar' && s.expr.type.scalar === 'f32'
              ? widen(walk(s.expr))
              : (() => {
                  throw dslError('SD0041', `'${s.bop}=' of ${typeKey(s.expr.type)} on f64`);
                })(),
        );
        // `x *= x`, `x *= 2.0` and `x /= 4.0` are the binop's square and scalings: `x *= c`
        // means `x = x * c`, and the two spellings lower alike ("Cheaper multiplies" above).
        if (s.bop === '*' || s.bop === '/') {
          const cheap = cheapMulDiv(s.bop, s.target, s.expr, ctx, () => target, rhs);
          if (cheap !== undefined) return { s: 'assign', target, expr: cheap };
        }
        // Registered the way the vec64 arm above registers its own: this arm EMITS a call to
        // `fnName`, so the module must carry its helper. Without this the emitted shader called
        // df64_add / df64_sub with no declaration anywhere and no `_fp64` binding, which Tint
        // rejects — reachable through every compound write to an f64 lvalue (`xs[i] += y` on a
        // storage array, and with #8 A2 the member and element `++` / `--` forms as well).
        ctx.used.add(fnName);
        return {
          s: 'assign',
          target,
          expr: { op: 'call', type: vec2fT, fn: fnName, args: [target, rhs()] },
        };
      }
      return { ...s, target: walk(s.target), expr: walk(s.expr) };
    }
    case 'return':
      return s.expr !== undefined ? { ...s, expr: walk(s.expr) } : s;
    case 'if':
      return {
        ...s,
        arms: s.arms.map((arm) => ({
          cond: walk(arm.cond),
          body: arm.body.map((b) => lowerStmt(b, ctx)),
        })),
        ...(s.elseBody ? { elseBody: s.elseBody.map((b) => lowerStmt(b, ctx)) } : {}),
      };
    case 'for':
      return {
        ...s,
        init: lowerStmt(s.init, ctx),
        cond: walk(s.cond),
        update: lowerStmt(s.update, ctx),
        body: s.body.map((b) => lowerStmt(b, ctx)),
      };
    case 'switch':
      return {
        ...s,
        scrut: walk(s.scrut),
        cases: s.cases.map((c) => ({ ...c, body: c.body.map((b) => lowerStmt(b, ctx)) })),
        ...(s.defaultBody ? { defaultBody: s.defaultBody.map((b) => lowerStmt(b, ctx)) } : {}),
      };
    case 'break':
    case 'continue':
    case 'discard':
    case 'placeholder':
    case 'raw':
      return s;
  }
}

// ── Fast identity scan (non-f64 modules must come out the SAME object) ──

function exprHasF64(e: Expr): boolean {
  if (containsF64(e.type)) return true;
  switch (e.op) {
    case 'lit':
    case 'constref':
    case 'externref':
    case 'overrideref':
    case 'param':
    case 'varref':
      return false;
    case 'binop':
    case 'compare':
    case 'logical':
      return exprHasF64(e.a) || exprHasF64(e.b);
    case 'unop':
      return exprHasF64(e.a);
    case 'call':
    case 'construct':
      return e.args.some(exprHasF64);
    case 'member':
      return exprHasF64(e.base);
    case 'select':
      return exprHasF64(e.cond) || exprHasF64(e.ifTrue) || exprHasF64(e.ifFalse);
    case 'index':
      return exprHasF64(e.base) || exprHasF64(e.idx);
    case 'matchExpr':
      return (
        exprHasF64(e.scrutinee) || e.cases.some(([, v]) => exprHasF64(v)) || exprHasF64(e.default)
      );
  }
}

function stmtHasF64(s: Stmt): boolean {
  switch (s.s) {
    case 'let':
      return exprHasF64(s.expr);
    case 'var':
      return containsF64(s.type) || (s.init !== undefined && exprHasF64(s.init));
    case 'assign':
    case 'assignOp':
      return exprHasF64(s.target) || exprHasF64(s.expr);
    case 'return':
      return s.expr !== undefined && exprHasF64(s.expr);
    case 'call':
      return exprHasF64(s.expr);
    case 'if':
      return (
        s.arms.some((a) => exprHasF64(a.cond) || a.body.some(stmtHasF64)) ||
        (s.elseBody?.some(stmtHasF64) ?? false)
      );
    case 'for':
      return (
        stmtHasF64(s.init) || exprHasF64(s.cond) || stmtHasF64(s.update) || s.body.some(stmtHasF64)
      );
    case 'switch':
      return (
        exprHasF64(s.scrut) ||
        s.cases.some((c) => c.body.some(stmtHasF64)) ||
        (s.defaultBody?.some(stmtHasF64) ?? false)
      );
    default:
      return false;
  }
}

function moduleUsesF64(m: ModuleDecl): boolean {
  return (
    m.consts.some((c) => containsF64(c.type)) ||
    m.structs.some((s) => s.fields.some((f) => containsF64(f.type))) ||
    m.bindings.some((b) => containsF64(b.type)) ||
    m.funcs.some(
      (f) =>
        containsF64(f.ret) || f.params.some((p) => containsF64(p.type)) || f.body.some(stmtHasF64),
    )
  );
}

// ── Helper closure + injection ──

/** df64 helper names called from a helper body (for the transitive closure). */
function helperCallees(d: FuncDecl): string[] {
  const out = new Set<string>();
  for (const s of d.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (x.op === 'call' && x.fn.startsWith('df64_')) out.add(x.fn);
      }),
    );
  return [...out];
}

/** Expand the directly-referenced helper set to its transitive closure and
 *  return the decls in the registry's order (fixed, dependency-first —
 *  byte-stable). The registry (float or integer) decides which decl backs
 *  each df64_* name; the closure walk itself is flavor-agnostic. */
function helperClosure(
  used: ReadonlySet<string>,
  fns: ReadonlyMap<string, FuncDecl>,
  order: readonly FuncDecl[],
): FuncDecl[] {
  const need = new Set(used);
  const queue = [...used];
  while (queue.length) {
    const d = fns.get(queue.pop()!);
    if (!d) continue;
    for (const callee of helperCallees(d)) {
      if (!need.has(callee)) {
        need.add(callee);
        queue.push(callee);
      }
    }
  }
  return order.filter((d) => need.has(d.name));
}

// ── The guard: fold its chains, read it once per function ──
//
// Every error term in a float helper body rides the runtime-opaque ONE, the `f64Guard`
// intrinsic (df64-lib's header says why it has to be a runtime input). The registry writes
// it where it GUARDS, inside each helper body, and read there it is a texel fetch per helper
// CALL: `acc * k + c` in a loop fetched eight times per iteration, every one inside the loop.
// Its value never changes within an invocation, so three rewrites move it:
//
//   1. foldGuardChain (here) — `guard(guard(x))` is `guard(x)`: `(x * G) * G` becomes
//      `x * G`. Once a value is a product with the opaque G, no compiler can prove it equal
//      to anything it could fold, and multiplying it by G again proves nothing more. The
//      value is the same too: at run time G is 1.0, and `x * 1.0` is exact.
//   2. threadHelper (here) — a helper that reads the guard, directly or through a helper it
//      calls, takes it as a trailing `_fp64_g: f32` parameter instead of fetching it, and
//      every call of such a helper from the module's own functions passes the FETCH itself
//      as that argument.
//   3. hoistGuardFetch (after the optimizer, core/emit.ts) — a function whose body fetches
//      the guard reads it ONCE, into a `let _fp64_g` at the top of its body, and every
//      fetch becomes that name. A loop in an entry reads the guard before the loop starts.
//
// WHY THE READ MOVES AFTER THE OPTIMIZER, NOT HERE. Until step 3 the fetch is an argument
// that reads only a binding, so a df64 call over loop-invariant operands is as input-only as
// it was when the helper fetched the guard itself: LICM still hoists `df64_mul(k, k, G)` out
// of a loop and CSE still shares it. Bound to a `let` here, the call would reference a LOCAL,
// and LICM (which hoists only what references no local) would leave it inside the loop,
// recomputed every iteration. The optimizer treats the fetch as a leaf for the same reason
// (opt/expr-utils.ts `isCompound`): binding it to a CSE temp would localise every call that
// carries it. Step 3 runs after every optimizer tier, so the single read holds at O0 too.
//
// WHY A PARAMETER AND NOT A MODULE-SCOPE VARIABLE. WGSL's uniformity analysis treats a read
// of `var<private>` as non-uniform, so a guard held in one would make every df64 value
// non-uniform, and with it every branch an f64 comparison decides. Measured with Tint: an f64
// comparison that decides a branch around `textureSample` is REFUSED with the guard in a
// `var<private>` and ACCEPTED with it passed as a parameter from a `let` at the top of the
// entry. A texel load at a constant coordinate is uniform, and a parameter is as uniform as
// its arguments.
//
// WHY IT STAYS A RUNTIME VALUE. The `let` holds the FETCH, never the literal 1.0 the fetch
// returns, and the helpers receive it as a parameter. Nothing downstream may treat it as a
// constant, and nothing can: const-prop substitutes only literal bindings, copy-prop only bare
// copies, and a `call` is neither. A guard a compiler could infer is 1.0 would guard nothing.
//
// User functions keep their signatures: the metamorphic gates call them by name on the
// lowered module (`compileModule(fp64Lower(m)).fns.k(...)`), and a stage entry's signature is
// its IO contract. Each one that calls a guarded helper therefore reads the texel once itself.

/** The name of the guard VALUE: the parameter a guarded helper takes, and the `let` a
 *  function that fetches the guard reads it into (hoistGuardFetch). */
const GUARD_VALUE = '_fp64_g';

const isGuardFetch = (x: Expr): boolean => x.op === 'call' && x.fn === 'f64Guard';

/** One read of the guard texel. */
const guardFetch = (): Expr => ({ op: 'call', type: f32T, fn: 'f64Guard', args: [] });

/** `x` already rides the guard: the guard itself, or a product with it. */
const isGuarded = (x: Expr): boolean =>
  isGuardFetch(x) ||
  (x.op === 'binop' && x.bop === '*' && (isGuardFetch(x.a) || isGuardFetch(x.b)));

/** `guard(guard(x))` → `guard(x)`, bottom-up over one expression tree: a product with the
 *  guard whose other factor already rides the guard IS that factor. Folds `(x * G) * G`,
 *  `G * (x * G)` and `G * G`. Exported for its unit test; not part of the package surface. */
export function foldGuardChain(e: Expr): Expr {
  const r = mapChildren(e, foldGuardChain);
  if (r.op !== 'binop' || r.bop !== '*') return r;
  const other = isGuardFetch(r.b) ? r.a : isGuardFetch(r.a) ? r.b : undefined;
  return other !== undefined && isGuarded(other) && typeKey(other.type) === typeKey(r.type)
    ? other
    : r;
}

/** The helpers that need the guard: those whose body fetches it, and, to a fixpoint, those
 *  that call one that does, because they have to hand it on. Whether a helper is in the set
 *  depends only on the helper and its callees, so the answer over a whole registry is the
 *  answer over any closure of it. */
function guardUsers(decls: readonly FuncDecl[]): Set<string> {
  const users = new Set<string>();
  const callees = new Map<string, string[]>();
  for (const d of decls) {
    let reads = false;
    for (const s of d.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (isGuardFetch(x)) reads = true;
        }),
      );
    if (reads) users.add(d.name);
    callees.set(d.name, helperCallees(d));
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, cs] of callees)
      if (!users.has(name) && cs.some((c) => users.has(c))) {
        users.add(name);
        grew = true;
      }
  }
  return users;
}

/** Every guard fetch in `e` becomes `g`, and every call of a guard user gains `g` as its
 *  trailing argument. */
function passGuard(e: Expr, users: ReadonlySet<string>, g: Expr): Expr {
  if (isGuardFetch(e)) return g;
  const r = mapChildren(e, (c) => passGuard(c, users, g));
  if (r.op !== 'call' || !users.has(r.fn)) return r;
  // `declRef` would still name the decl WITHOUT the guard parameter. Nothing after module
  // assembly reads it (ir/nodes.ts), so it is dropped rather than left pointing at a
  // signature the call no longer matches.
  const { declRef: _stale, ...call } = r;
  return { ...call, args: [...r.args, g] };
}

/** A registry helper with its guard chains folded and, when it is a guard user, its guard
 *  taken as the trailing `_fp64_g` parameter. */
function threadHelper(d: FuncDecl, users: ReadonlySet<string>): FuncDecl {
  if (!users.has(d.name)) return d;
  const g: Expr = { op: 'param', type: f32T, name: GUARD_VALUE };
  return {
    ...d,
    params: [...d.params, { name: GUARD_VALUE, type: f32T }],
    body: d.body.map((s) => mapStmtExpr(s, (e) => passGuard(foldGuardChain(e), users, g))),
  };
}

/** Every name `f` binds: its parameters and each `let` / `var` at any depth. */
function boundNames(f: FuncDecl): Set<string> {
  const names = new Set(f.params.map((p) => p.name));
  const visit = (s: Stmt): void => {
    if (s.s === 'let' || s.s === 'var') names.add(s.name);
    eachStmtExpr(s, () => {}, visit);
  };
  for (const s of f.body) visit(s);
  return names;
}

/** Does `f`'s body contain an expression `hit` accepts? */
function bodyHas(f: FuncDecl, hit: (x: Expr) => boolean): boolean {
  let found = false;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (hit(x)) found = true;
      }),
    );
  return found;
}

/** `f` already has the shape hoistGuardFetch gives it: its first statement binds the one
 *  fetch in its body. A second run leaves it alone rather than binding the binding. */
function readsGuardOnce(f: FuncDecl): boolean {
  const first = f.body[0];
  if (first?.s !== 'let' || !isGuardFetch(first.expr)) return false;
  let n = 0;
  for (const s of f.body)
    eachStmtExpr(s, (e) =>
      eachExpr(e, (x) => {
        if (isGuardFetch(x)) n++;
      }),
    );
  return n === 1;
}

/** Read the fp64 guard once per function: a function whose body fetches the guard texel
 *  gets `let _fp64_g = <fetch>` as its first statement, and every fetch in it becomes that
 *  name. Step 3 of "The guard" above; `core/emit.ts` runs it after every optimizer tier, and
 *  it is the identity (the same object) for a module that never fetches the guard. The
 *  helpers {@link fp64Lower} injects take the guard as a parameter, so after this a module
 *  reads the texel at most once per function execution. */
export function hoistGuardFetch(m: ModuleDecl): ModuleDecl {
  if (!m.funcs.some((f) => bodyHas(f, isGuardFetch) && !readsGuardOnce(f))) return m;
  const replace = (g: Expr): ((e: Expr) => Expr) => {
    const r = (e: Expr): Expr => (isGuardFetch(e) ? g : mapChildren(e, r));
    return r;
  };
  // A module-scope name the `let` would shadow is taken too: a function reading that
  // binding, constant or variable must still reach it.
  const moduleNames = new Set<string>([
    ...m.bindings.map((b) => b.name),
    ...m.consts.map((c) => c.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...(m.externs ?? []).map((v) => v.name),
    ...(m.overrides ?? []).map((o) => o.name),
    ...m.funcs.map((f) => f.name),
  ]);
  const funcs = m.funcs.map((f) => {
    if (!bodyHas(f, isGuardFetch) || readsGuardOnce(f)) return f;
    const taken = boundNames(f);
    let name = GUARD_VALUE;
    for (let i = 1; taken.has(name) || moduleNames.has(name); i++) name = `${GUARD_VALUE}${i}`;
    const to = replace({ op: 'varref', type: f32T, name });
    return {
      ...f,
      body: [
        { s: 'let' as const, name, expr: guardFetch() },
        ...f.body.map((s) => mapStmtExpr(s, to)),
      ],
    };
  });
  return { ...m, funcs };
}

/** A registry's guard users and its helpers rewritten for them, computed once per registry:
 *  the rewrite is a pure function of the registry, and a module takes a closure of it. */
interface GuardPlan {
  readonly users: ReadonlySet<string>;
  readonly helpers: ReadonlyMap<string, FuncDecl>;
}
const GUARD_PLANS = new WeakMap<readonly FuncDecl[], GuardPlan>();
function guardPlan(order: readonly FuncDecl[]): GuardPlan {
  let plan = GUARD_PLANS.get(order);
  if (plan === undefined) {
    const users = guardUsers(order);
    plan = { users, helpers: new Map(order.map((d) => [d.name, threadHelper(d, users)])) };
    GUARD_PLANS.set(order, plan);
  }
  return plan;
}

// ── Guard auto-injection ──
//
// The df64 helper bodies read a runtime-opaque 1.0 via the `f64Guard`
// intrinsic, which spells as a texel fetch on the `_fp64` TEXTURE binding
// (the anti-fast-math guard — see df64-lib's header for WHY it must be a
// runtime input a driver can never constant-fold; a uniform is defeated by
// uniform-value pipeline specialization). Authors declare NOTHING: any module
// whose lowering used a helper gets the `_fp64` texture_2d<f32> binding
// injected here, at a DETERMINISTIC slot — group 0, first binding index past
// the module's own group-0 bindings — so emit stays byte-stable and can never
// collide with the module's declared bindings. An author who must pin the
// slot to an engine's fixed bind-group layout declares
// `fp64Guard({ group, binding })` in `uses:`, which this function honours
// (matching name + type). A CONFLICTING `_fp64` declaration (wrong type) is
// SD0042 — the emulation would be precision-dead against a mis-shaped guard.

function injectGuard(bindings: BindingDecl[]): void {
  const at = bindings.findIndex((b) => b.name === FP64_GUARD_NAME);
  if (at >= 0) {
    const existing = bindings[at]!;
    if (typeKey(existing.type) !== typeKey(FP64_GUARD_TYPE)) {
      throw dslError(
        'SD0042',
        `binding '${FP64_GUARD_NAME}' exists but is ${existing.space} ${typeKey(existing.type)}`,
      );
    }
    // A guard declared by hand with no qualifier still reads at highp on GLSL (below).
    if (existing.precision === undefined) bindings[at] = { ...existing, precision: 'highp' };
  } else {
    const g0 = bindings.filter((b) => b.group === 0);
    const slot = g0.length ? Math.max(...g0.map((b) => b.binding)) + 1 : 0;
    bindings.push({
      group: 0,
      binding: slot,
      name: FP64_GUARD_NAME,
      space: 'uniform',
      type: FP64_GUARD_TYPE,
      // GLSL ES 3.00 gives `sampler2D` a DEFAULT precision of lowp, in both stages, and a
      // texel fetch returns its sampler's precision. 1.0 is exact at lowp, so the guard
      // reads correctly without this; it is what keeps it correct if the guard ever holds
      // a value lowp cannot, and under a host preamble that lowers the default.
      precision: 'highp',
    });
  }
}

// ── The pass ──

/** Rewrite every f64 value in a module into its two-f32 emulation, so that no backend has to
 *  spell the type. An f64 scalar becomes a `vec2<f32>` holding a (hi, lo) pair, `vecN<f64>`
 *  becomes a `DF64VecN` struct of two `vecN<f32>` planes, `matNxN<f64>` becomes a `DF64MatN`
 *  struct, and the arithmetic, comparisons and supported builtins over them become calls to
 *  injected `df64_*` helper functions, which are appended to the module's funcs. A module with
 *  no f64 anywhere is returned as the same object.
 *
 *  Supported on f64 operands: `+ - * /`, negation, the six comparisons, `sqrt`, `abs`, `min`,
 *  `max`, `mix` (with an f32 interpolant), `floor`, `fract`, `sin`, `cos`, widening from f32 and
 *  narrowing to f32. On `vecN<f64>` additionally `dot`, `length`, `distance`, `normalize` and
 *  the componentwise forms of the list above; on `matNxN<f64>`, `*` and `transpose`. Any other
 *  builtin on an f64 operand throws; narrow the operand to f32 first when you need one.
 *
 *  Two kinds of multiply take a cheaper form. `x * x`, when `x` has no side effect, is
 *  `df64_sqr(x)`, the multiply specialised to one operand. A multiply by a power-of-two
 *  literal, or a divide by such a literal, scales the two words of the pair by an f32 literal,
 *  which is exact barring overflow and underflow. A scale that can grow the value (|s| > 1)
 *  is taken only when `x` is computed at run time, so that WGSL never evaluates a constant
 *  that overflows while it creates the shader; a constant `x` keeps the general multiply.
 *
 *  When an injected helper reads the runtime guard, the pass also declares the `_fp64` guard
 *  binding at group 0, first index past the module's own group-0 bindings. Declare
 *  {@link fp64Guard} in the module to pin that slot yourself. The host writes `1.0` into it.
 *  Those helpers take the guard as a trailing `_fp64_g: f32` parameter rather than fetching
 *  it themselves, and every call of one from the module's own functions passes the texel
 *  fetch as that argument. The emit functions then read it once per function, into a `let`
 *  named `_fp64_g` at the top of the body, after the optimizer has run.
 *
 *  The emit functions run this pass for you; pass `fp64Flavor` in {@link EmitOptions} to select
 *  the flavour there. Call it directly when you want to inspect the lowered module.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to lower.
 *  @param opts - `flavor` selects which primitives back the helpers; see {@link Fp64Flavor}.
 *  @returns a new module with its f64 declarations and bodies rewritten and the helper functions
 *    appended, or `m` itself when it contains no f64.
 *  @throws SD0041 for an operation on f64 operands that has no emulation.
 *  @throws SD0042 when the module declares a `_fp64` binding whose type differs from the guard's.
 *  @throws SD0043 when the module declares a function named `df64_*` or a struct named
 *    `DF64Vec*` or `DF64Mat*`; those names are reserved for the injected helpers.
 *  @throws SD0044 for an f64 in an interpolated `@location` struct field, a fragment input, or a
 *    stage entry's return value; interpolating a (hi, lo) pair is numerically wrong.
 *
 *  @example
 *  ```ts
 *  import { fp64Lower } from 'typeshade'
 *
 *  // authored: a ModuleDecl whose functions use f64
 *  const lowered = fp64Lower(authored, { flavor: 'integer' })
 *  // lowered.funcs ends with the df64_* helpers the module needs
 *  ```
 */
export function fp64Lower(m: ModuleDecl, opts?: Fp64LowerOptions): ModuleDecl {
  if (!moduleUsesF64(m)) return m;
  const integer = opts?.flavor === 'integer';
  const REG_FNS = integer ? DF64_FNS_INT : DF64_FNS;
  const REG_ORDER = integer ? DF64_ORDER_INT : DF64_ORDER;

  // The injected names are reserved — an authored collision would silently
  // shadow the emulation.
  for (const f of m.funcs) {
    if (f.name.startsWith('df64_')) throw dslError('SD0043', `fn '${f.name}'`);
  }
  for (const st of m.structs) {
    if (st.name.startsWith('DF64Vec') || st.name.startsWith('DF64Mat'))
      throw dslError('SD0043', `struct '${st.name}'`);
  }

  const ctx: LowerCtx = {
    used: new Set(),
    vecWidths: new Set(),
    matWidths: new Set(),
    writes: fnWrites(m),
    runtimeNames: new Map(
      [...m.bindings, ...(m.vars ?? [])].map((d) => [d.name, typeKey(mapType(d.type))]),
    ),
    constTypes: new Set(m.consts.map((c) => typeKey(mapType(c.type)))),
    fnNames: new Set(m.funcs.map((f) => f.name)),
  };
  const recordWidths = (t: ShaderType): void => {
    if (isVec64(t)) ctx.vecWidths.add(t.n);
    // A mat width forces its vec width — DF64MatN nests DF64VecN columns.
    else if (isMat64(t)) {
      const n = mat64Dim(t);
      ctx.matWidths.add(n);
      ctx.vecWidths.add(n);
    } else if (t.kind === 'array') recordWidths(t.elem);
  };

  const consts: ConstDecl[] = m.consts.map((c) => {
    if (!containsF64(c.type)) return c;
    recordWidths(c.type);
    // An f64 module const becomes a vec2 pair const. The scalar dual-value
    // form splits its full-precision cpuValue; a valueExpr lowers recursively.
    const valueExpr = c.valueExpr !== undefined ? lowerExpr(c.valueExpr, ctx) : pairLit(c.cpuValue);
    return { name: c.name, type: mapType(c.type), wgslValue: 0, cpuValue: 0, valueExpr };
  });

  const structs: StructDecl[] = m.structs.map((s) => {
    if (!s.fields.some((f) => containsF64(f.type))) return s;
    return {
      ...s,
      fields: s.fields.map((f) => {
        if (!containsF64(f.type)) return f;
        // Interpolating a (hi, lo) pair is numerically wrong — an f64 varying
        // (an @location IO-struct field) is rejected, not silently averaged.
        if (f.location !== undefined) throw dslError('SD0044', `${s.name}.${f.name}`);
        recordWidths(f.type);
        return { ...f, type: mapType(f.type) };
      }),
    };
  });

  const bindings: BindingDecl[] = m.bindings.map((b) => {
    if (!containsF64(b.type)) return b;
    recordWidths(b.type);
    return { ...b, type: mapType(b.type) };
  });

  // A module variable (§24) is rewritten as a binding is, with its initializer. The front end
  // folds an f64 initializer to literals (`1.5 * 2.` is the literal 3), so it lowers to pair
  // literals and stays the constant expression a module-scope initializer must be on both
  // targets. Left out, an `f64` variable reached the writers as `f64` (SD0040).
  const vars: ModuleVarDecl[] | undefined = m.vars?.map((v) => {
    if (!containsF64(v.type)) return v;
    recordWidths(v.type);
    return {
      ...v,
      type: mapType(v.type),
      ...(v.init !== undefined ? { init: lowerExpr(v.init, ctx) } : {}),
    };
  });

  const funcs: FuncDecl[] = m.funcs.map((f) => {
    const stage = stageOf(f);
    const params = f.params.map((p) => {
      if (!containsF64(p.type)) return p;
      // A vertex @location param is an ATTRIBUTE (one vec2<f32> slot — fine
      // for SCALAR f64; a vec64 would need two slots — pass hi/lo lanes as
      // two vecN<f32> @locations and rebuild with f64FromParts per lane);
      // a fragment @location param is an interpolated varying — rejected.
      if (stage === 'fragment' && p.location !== undefined)
        throw dslError('SD0044', `fragment input '${p.name}'`);
      if (p.location !== undefined && isVec64(p.type))
        throw dslError(
          'SD0041',
          `vec64 vertex attribute '${p.name}' — pass hi/lo as two vecN<f32> @locations and rebuild lanes with f64FromParts`,
        );
      recordWidths(p.type);
      return { ...p, type: mapType(p.type) };
    });
    let ret = f.ret;
    if (containsF64(f.ret)) {
      // A stage output f64 is a varying / render-target write — meaningless.
      if (stage !== undefined) throw dslError('SD0044', `${stage} entry '${f.name}' return`);
      recordWidths(f.ret);
      ret = mapType(f.ret);
    }
    const body = f.body.map((s) => lowerStmt(s, ctx));
    return { ...f, params, ret, body };
  });

  // DF64VecN struct decls for every lane width the module carries (needed
  // even for type-only pass-through, where no helper fires).
  for (const n of [2, 3, 4] as const) {
    if (ctx.vecWidths.has(n)) structs.push(DF64_VEC_STRUCTS.get(n)!);
  }
  // DF64MatN decls AFTER the vec structs — a DF64MatN nests DF64VecN columns
  // and GLSL needs define-before-use (recordWidths forced the vec width above).
  for (const n of [2, 3, 4] as const) {
    if (ctx.matWidths.has(n)) structs.push(DF64_MAT_STRUCTS.get(n)!);
  }

  // `opaque: true` is the emit optimizer's instruction to keep these calls intact
  // (X-GIS #1926). Stamped HERE rather than at each of the 48 registry definitions
  // because this is the ONLY route by which a df64 helper enters a module — the
  // `df64_` prefix is reserved (SD0043) and authors never list them — so one site
  // covers both the float and integer registries and any future one.
  const plan = guardPlan(REG_ORDER);
  const helpers = helperClosure(ctx.used, REG_FNS, REG_ORDER).map((d) => ({
    ...plan.helpers.get(d.name)!,
    opaque: true,
  }));
  // Only a module that READS the guard gets the binding. The comparisons (df64_lt/le/gt/ge/
  // eq/ne) and df64_narrow carry no error term and never read it, and a binding the shader
  // never reads is stripped from a WebGPU `layout: 'auto'` bind-group layout by Tint/Dawn:
  // a bind-group mismatch, and a no-op draw on D3D12/NVIDIA (WebKit keeps the unused binding
  // and GLSL has no such layout, hence the WGSL-only, vendor-specific break).
  if (helpers.some((d) => plan.users.has(d.name))) injectGuard(bindings);
  // The module's own functions pass the FETCH to a guarded helper; hoistGuardFetch reads it
  // into one `let` per function after the optimizer has run (see "The guard" above).
  const threaded = funcs.map((f) =>
    bodyHas(f, (x) => x.op === 'call' && plan.users.has(x.fn))
      ? {
          ...f,
          body: f.body.map((s) => mapStmtExpr(s, (e) => passGuard(e, plan.users, guardFetch()))),
        }
      : f,
  );
  // A const initialiser is a literal by the builder's contract and calls no helper; were it
  // ever to, the call reads the guard in place rather than losing its trailing argument.
  const guardedConsts = consts.map((c) =>
    c.valueExpr === undefined
      ? c
      : { ...c, valueExpr: passGuard(c.valueExpr, plan.users, guardFetch()) },
  );

  // SPREAD the source module, then override the four fields this pass actually rewrites
  // — the sibling idiom every other rebuilding pass uses. That carries `overrides`,
  // `enables`, and any FUTURE optional ModuleDecl field for free; hand-listing the
  // survivors is what dropped `enables` here in the first place (X-GIS #1670), invisibly: tsc
  // cannot see it (the field is optional), and every emit path read the AUTHORED module,
  // so the loss only surfaced through a consumer deriving from the LOWERED module —
  // reflect() of a lowered module (emitModuleWithReflection) losing `requiredFeatures` on
  // f64 modules ONLY. Pinned by backends/extension-profile.test.ts.
  return {
    ...m,
    consts: guardedConsts,
    structs,
    bindings,
    ...(vars !== undefined ? { vars } : {}),
    funcs: [...threaded, ...helpers],
  };
}
