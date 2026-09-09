// ═══ Shader DSL — CPU (f64) tree-walk interpreter ═══
//
// The tree-walk interpreter over the SAME IR the WGSL backend emits. This is
// the generated replacement for the hand-maintained projection-wgsl-mirror.ts:
// it runs the identical operation tree in f64 with Math.* (no fround), so it
// reproduces the mirror's numbers (AC2-spike (a): ≤1mm vs canonical).
//
// The CPU value model + operation library (the builtin / GPU-stub tables, the
// scalar / vector / matrix op helpers, FIELD_IDX, zeroOf) lives in cpu-runtime.ts
// — the SINGLE authority this interpreter shares with the perf-critical
// js-source backend (cpu-codegen.ts / compileModuleJs). Both walk the same IR
// and call the same op-library, so the `new Function` twin is BIT-IDENTICAL to
// this tree-walk by construction (differential-gated in cpu-codegen.test.ts).
//
// Module-level consts use their cpuValue (full-precision Math.PI / Math.PI/180)
// so the projection math matches the f64 mirror, while the WGSL backend emits
// the truncated shader constants — the two-tolerance reality, structural.
//
// Vectors are number[] (mutable, by reference so `p.x = …` assigns in place).
// ─── CAVEAT — this is an f64 ALGEBRA oracle, NOT an f32-precision oracle ───
//
// Every value here is a JS f64 evaluated with Math.* and NO `fround`. That makes
// this backend structurally BLIND to the codebase's worst bug class: f32-precision
// loss on the GPU. It validates that the IR's ALGEBRA is correct (the right ops in
// the right order, matching the f64 mirror to ≤1mm), and nothing about what that
// algebra does once it is rounded to 32-bit floats per-vertex on a real driver.
//
// Concretely, it CANNOT catch:
//   • #392 (polygon fill displaced from outline) — fill arm fed f32 abs-degree
//     positions; the displacement is purely an f32-rounding artifact, invisible in f64.
//   • #360 (globe polar-cap black hole) — tail slot read as f32 garbage; the cull
//     fires only under f32 truncation, never in this interpreter.
// A CPU↔CPU pass here is therefore NOT evidence of GPU precision parity. The only
// real f32 differential is a headless-GPU gate that runs the EXECUTED shader and
// diffs it against this f64 result under an f32/truncated-const tolerance
// (today: playground/_shader-math-parity.spec.ts, ~100m, requires a WebGPU adapter).
// Treat this oracle as the ALGEBRA half of a two-oracle contract; the f32 half lives
// on the GPU.

import type { Expr, Stmt, ModuleDecl, StructDecl } from './ir/index.js'
import { validate } from './passes/validate.js'
import { autoVars } from './passes/opt/index.js'
import { froundF32 } from './passes/precision.js'
import {
  type CpuValue,
  FIELD_IDX,
  isArr,
  applyBin,
  BUILTINS,
  GPU_STUBS,
  zeroOf,
  matVec,
  matMul,
  f32ToU32Sat,
  f32ToI32Sat,
  numKindOf,
} from './cpu-runtime.js'

// Preserve the historical `@xgis/shader-dsl` oracle surface: the value-model
// types + the builtin/stub name sets moved to cpu-runtime.ts (single authority),
// re-exported here so existing importers of `./oracle` are unaffected.
export type { CpuValue, CpuStruct } from './cpu-runtime.js'
export { ORACLE_BUILTIN_NAMES, ORACLE_GPU_STUB_NAMES } from './cpu-runtime.js'

interface Ctx {
  consts: Map<string, CpuValue>
  /** Specialization constants (#923) → their DEFAULT value. The CPU oracle is the
   *  un-specialized mirror: an override reads as its declared default (pipeline
   *  specialization is a GPU-driver concept with no CPU analogue). */
  overrides: Map<string, CpuValue>
  fns: Record<string, (...args: CpuValue[]) => CpuValue>
  bindings: Record<string, CpuValue>
  structs: Map<string, StructDecl>
  /** Opt-in GPU stubs (#763 O3): textureSample/fwidth return placeholder values
   *  instead of throwing. OFF by default — plausible-wrong is the worst failure
   *  mode for a reference backend. */
  gpuStubs: boolean
}

/** The shape both CPU backends return, so a caller can compile with {@link compileModuleJs}
 *  and fall back to {@link compileModule} without touching call sites (for example when the
 *  host forbids `new Function` under a Content Security Policy). `fns` is a table of the
 *  module's declared functions by name, each taking its parameters positionally in declaration
 *  order. `setBinding` supplies a storage or uniform binding's value before a function that
 *  reads it runs. The two backends return the same value for the same call:
 *  `compileModuleJs(m).fns.f(args)` and `compileModule(m).fns.f(args)` agree under `Object.is`,
 *  element for element.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface CpuModule {
  /** The module's declared functions by name. Parameters are positional, in declaration
   *  order; the return value is the function's result as a {@link CpuValue}. */
  fns: Record<string, (...args: CpuValue[]) => CpuValue>
  /** Supply a storage or uniform binding's value by its declared name, before invoking a
   *  function that reads it. */
  setBinding(name: string, value: CpuValue): void
}

function evalExpr(e: Expr, env: Map<string, CpuValue>, ctx: Ctx): CpuValue {
  switch (e.op) {
    case 'lit':
      return e.value
    case 'constref': {
      const v = ctx.consts.get(e.name)
      if (v === undefined) throw new Error(`shader-dsl/cpu: unknown const ${e.name}`)
      return v
    }
    case 'overrideref': {
      const v = ctx.overrides.get(e.name)
      if (v === undefined) throw new Error(`shader-dsl/cpu: unknown override ${e.name}`)
      return v
    }
    // #1713 — see cpu-codegen: no host here, so no value. Throw rather than fabricate.
    case 'externref':
      throw new Error(`shader-dsl/cpu: host-provided global '${e.name}' has no CPU value`)
    case 'param':
    case 'varref': {
      if (env.has(e.name)) return env.get(e.name) as CpuValue
      if (e.name in ctx.bindings) return ctx.bindings[e.name]
      throw new Error(`shader-dsl/cpu: unbound ${e.name}`)
    }
    case 'binop': {
      const av = evalExpr(e.a, env, ctx),
        bv = evalExpr(e.b, env, ctx)
      // mat * vec (column-major) — the MVP transform. Dispatched by the
      // operand's static type since values are type-blind number[] at runtime.
      if (
        e.bop === '*' &&
        e.a.type.kind === 'mat' &&
        (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
      ) {
        return matVec(av as number[], bv as number[])
      }
      // A real column-major matrix product — needed for the mat64 (emulated
      // double) matmul path, whose metamorphic gate evaluates the AUTHORED
      // module here. (The native-mat*mat case stays supported by the same code.)
      if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat') {
        return matMul(av as number[], bv as number[])
      }
      if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat') {
        throw new Error(
          'shader-dsl/cpu: vec*mat (row-vector form) is not implemented — use mat*vec',
        )
      }
      // The RESULT type's numeric kind drives WGSL integer semantics (wrap, truncating
      // `/`, `x / 0 = x`, i32 arithmetic `>>`) in the shared scalarBin (#2274).
      return applyBin(e.bop, av, bv, numKindOf(e.type))
    }
    case 'unop': {
      const a = evalExpr(e.a, env, ctx)
      return isArr(a) ? a.map((v) => -(v as number)) : -(a as number)
    }
    case 'compare': {
      const a = evalExpr(e.a, env, ctx) as number,
        b = evalExpr(e.b, env, ctx) as number
      // == / != reflect f32 rounding when comparing f32 operands — the GPU
      // computes f32, so exact f64 equality silently disagrees with it on
      // equality branches (#13). Ordering ops keep f64 (rounding rarely flips an
      // inequality, and f64 is the stricter mirror for thresholds).
      const f32cmp = e.a.type.kind === 'scalar' && e.a.type.scalar === 'f32'
      switch (e.cop) {
        case '<':
          return a < b
        case '>':
          return a > b
        case '<=':
          return a <= b
        case '>=':
          return a >= b
        case '==':
          return f32cmp ? Math.fround(a) === Math.fround(b) : a === b
        case '!=':
          return f32cmp ? Math.fround(a) !== Math.fround(b) : a !== b
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'logical': {
      const a = evalExpr(e.a, env, ctx) as boolean
      if (e.lop === '&&') return a ? (evalExpr(e.b, env, ctx) as boolean) : false
      return a ? true : (evalExpr(e.b, env, ctx) as boolean)
    }
    case 'call': {
      const args = e.args.map((a) => evalExpr(a, env, ctx))
      // f32→u32/i32 SATURATES per WGSL (integer sources keep wrapping — see
      // cpu-runtime's f32To*Sat). The value alone cannot tell the sources apart,
      // so branch on the ARG's static type; cpu-codegen bakes the same branch at
      // compile time, keeping the twins bit-identical.
      if (e.fn === 'u32' || e.fn === 'i32') {
        const src = e.args[0]!.type
        if (src.kind === 'f64' || (src.kind === 'scalar' && src.scalar === 'f32')) {
          return e.fn === 'u32' ? f32ToU32Sat(args[0] as number) : f32ToI32Sat(args[0] as number)
        }
      }
      const b = BUILTINS[e.fn]
      if (b) return b(...args)
      const stub = GPU_STUBS[e.fn]
      if (stub) {
        if (!ctx.gpuStubs) {
          throw new Error(
            `shader-dsl/cpu: '${e.fn}' is GPU-only and not computable here — pass compileModule(m, { gpuStubs: true }) to accept placeholder values (#763 O3)`,
          )
        }
        return stub(...args)
      }
      const user = ctx.fns[e.fn]
      if (user) return user(...args)
      throw new Error(`shader-dsl/cpu: unknown fn ${e.fn}`)
    }
    case 'member': {
      const base = evalExpr(e.base, env, ctx)
      if (isArr(base)) {
        // Multi-char swizzle (.rgb / .xy) → a new vector; single → a scalar.
        if (e.field.length > 1) return [...e.field].map((c) => base[FIELD_IDX[c]!] as number)
        return base[FIELD_IDX[e.field]] as CpuValue
      }
      return (base as Record<string, CpuValue>)[e.field]
    }
    case 'construct': {
      // Array literal: keep each element intact (array<vec2,N> → [[x,y],…]).
      if (e.type.kind === 'array') return e.args.map((a) => evalExpr(a, env, ctx)) as CpuValue
      // Struct constructor: `MyStruct(a, b, …)` → a field-keyed object in decl order (the
      // same shape the field-by-field `assign(out.f, …)` build produces).
      if (e.type.kind === 'struct') {
        const decl = ctx.structs.get(e.type.name)
        if (decl === undefined) throw new Error(`oracle: struct '${e.type.name}' not declared`)
        const obj: Record<string, CpuValue> = {}
        decl.fields.forEach((f, i) => {
          obj[f.name] = evalExpr(e.args[i]!, env, ctx)
        })
        return obj as CpuValue
      }
      // Vector constructor: flatten scalar/vec args into one component list.
      const out: number[] = []
      for (const a of e.args) {
        const v = evalExpr(a, env, ctx)
        if (isArr(v)) out.push(...(v as number[]))
        else out.push(v as number)
      }
      // WGSL splat: vecN<T>(singleScalar) fills all N components (e.g. vec3(0.5) = [0.5,0.5,0.5]).
      if ((e.type.kind === 'vec' || e.type.kind === 'vec64') && out.length === 1)
        return new Array(e.type.n as number).fill(out[0])
      return out
    }
    case 'select': {
      const c = evalExpr(e.cond, env, ctx) as boolean
      return c ? evalExpr(e.ifTrue, env, ctx) : evalExpr(e.ifFalse, env, ctx)
    }
    case 'index': {
      const base = evalExpr(e.base, env, ctx) as CpuValue[]
      return base[evalExpr(e.idx, env, ctx) as number]
    }
    case 'matchExpr': {
      // CPU semantics mirror the WGSL pre-emit lowering: evaluate the
      // scrutinee, find the matching case (by ===), return its value.
      // No fall-through. Default fires when no case matches.
      const sv = evalExpr(e.scrutinee, env, ctx) as number
      const hit = e.cases.find(([v]) => v === sv)
      return evalExpr(hit ? hit[1] : e.default, env, ctx)
    }
  }
}

function setLValue(target: Expr, value: CpuValue, env: Map<string, CpuValue>, ctx: Ctx): void {
  if (target.op === 'varref' || target.op === 'param') {
    env.set(target.name, value)
    return
  }
  if (target.op === 'member') {
    const base = evalExpr(target.base, env, ctx)
    if (isArr(base)) base[FIELD_IDX[target.field]] = value as number
    else (base as Record<string, CpuValue>)[target.field] = value
    return
  }
  if (target.op === 'index') {
    const base = evalExpr(target.base, env, ctx) as CpuValue[]
    base[evalExpr(target.idx, env, ctx) as number] = value
    return
  }
  throw new Error(`shader-dsl/cpu: bad assignment target ${target.op}`)
}

type Signal =
  | { kind: 'normal' }
  | { kind: 'return'; value: CpuValue | undefined }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'discard' }
const NORMAL: Signal = { kind: 'normal' }

// One flat env per function call (no per-block child scope). This is safe
// because the ONLY way to reference a binding is the Node returned by
// b.let()/b.var()/forRange — the TS host already scopes those lexically, so a
// `var` declared in one branch can't be read from another. (A future
// "read a binding by name" API would expose the divergence from WGSL block
// scoping; don't add one without per-block scopes here.)
function execBody(body: readonly Stmt[], env: Map<string, CpuValue>, ctx: Ctx): Signal {
  for (const s of body) {
    switch (s.s) {
      case 'let':
        env.set(s.name, evalExpr(s.expr, env, ctx))
        break
      case 'var':
        env.set(s.name, s.init ? evalExpr(s.init, env, ctx) : zeroOf(s.type))
        break
      case 'assign':
        setLValue(s.target, evalExpr(s.expr, env, ctx), env, ctx)
        break
      case 'assignOp': {
        const cur = evalExpr(s.target, env, ctx)
        // #763 O6 — thread the numeric kind exactly as the binop path does
        // (oracle.ts binop case): `x >>= y` on an i32 target is an ARITHMETIC
        // shift; the flag was once applied to one of the two eval sites only.
        const kind = numKindOf(s.target.type)
        setLValue(s.target, applyBin(s.bop, cur, evalExpr(s.expr, env, ctx), kind), env, ctx)
        break
      }
      case 'return':
        return { kind: 'return', value: s.expr ? evalExpr(s.expr, env, ctx) : undefined }
      case 'break':
        return { kind: 'break' }
      case 'continue':
        return { kind: 'continue' }
      case 'discard':
        return { kind: 'discard' }
      case 'if': {
        let taken = false
        for (const arm of s.arms) {
          if (evalExpr(arm.cond, env, ctx)) {
            const r = execBody(arm.body, env, ctx)
            if (r.kind !== 'normal') return r
            taken = true
            break
          }
        }
        if (!taken && s.elseBody) {
          const r = execBody(s.elseBody, env, ctx)
          if (r.kind !== 'normal') return r
        }
        break
      }
      case 'for': {
        execBody([s.init], env, ctx)
        while (evalExpr(s.cond, env, ctx)) {
          const r = execBody(s.body, env, ctx)
          if (r.kind === 'break') break
          if (r.kind === 'return' || r.kind === 'discard') return r
          // 'continue' jumps straight to the update + next condition eval —
          // the body short-circuit already returned, just don't propagate.
          execBody([s.update], env, ctx)
        }
        break
      }
      case 'switch': {
        const v = evalExpr(s.scrut, env, ctx) as number
        const hit = s.cases.find((c) => c.value === v)
        const chosen = hit ? hit.body : s.defaultBody
        if (chosen) {
          const r = execBody(chosen, env, ctx)
          // A `break` in a case body exits the SWITCH only (WGSL and GLSL alike), so it
          // is consumed here. Everything else propagates to the statement that owns it —
          // `return`, `discard`, and a `continue` aimed at an enclosing loop (#2275: it
          // used to be dropped, so the loop body ran to completion on that iteration).
          if (r.kind !== 'normal' && r.kind !== 'break') return r
        }
        break
      }
      case 'placeholder': {
        // Phase 2.5 US-007 — the polygon composer (emitPolygonWgsl)
        // MUST swap every placeholder Stmt before emit. If one reaches
        // CPU eval, the composer forgot to splice — fail loudly rather
        // than silently no-op (the WGSL backend emits a defensive
        // comment, but on CPU there's no analogue and a silent
        // missing-return is much harder to localise).
        throw new Error(
          `shader-dsl/cpu: placeholder Stmt reached CPU backend — composer forgot to splice tag=${s.tag}`,
        )
      }
      case 'raw': {
        // Phase 2 PR 2e.B.2 — raw passthrough is GPU-only; it has no
        // CPU evaluation. Reaching here means a raw Stmt was placed on a
        // shader path that also runs through the CPU mirror (cpu-projections
        // / compute eval), which is a composition bug — fail loudly.
        throw new Error(
          'shader-dsl/cpu: raw Stmt reached CPU backend — raw passthrough is GPU-only',
        )
      }
    }
  }
  return NORMAL
}

/** How the CPU backends evaluate f32 arithmetic.
 *
 *  - `'f64'` (default): every value is a JavaScript double, so the result is the mathematically
 *    intended one to 53 bits. This is the reference an implementation is checked against.
 *  - `'f32'`: a correctly rounding f32 machine over the same IR the GPU receives. Every
 *    f32-typed operation rounds to f32 after it is evaluated, with ±Infinity on overflow. Use
 *    it when the question is what the target computes, so a parity gate can compare at ulp
 *    scale without a tolerance wide enough to hide a real error.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export type CpuPrecision = 'f64' | 'f32'

/** Compile a module for the CPU: a tree-walk interpreter over the same IR the GPU backends
 *  receive, returning a {@link CpuModule} whose `fns` are ordinary JavaScript functions. It is
 *  the differential reference a parity test compares a GPU result against.
 *
 *  `opts.precision` picks what the arithmetic means. `'f64'`, the default, is the algebra
 *  oracle: every value is a JavaScript double, so the result is the mathematically intended
 *  one to 53 bits. It proves the IR picked the right operations in the right order, and it is
 *  blind by construction to f32 rounding, which only appears once the target truncates.
 *  `'f32'` is a correctly-rounding f32 machine over the same IR: every f32-typed operation
 *  rounds to f32 afterwards, with infinities on overflow. Reach for `'f32'` when the question
 *  is what the target computes, so a parity gate can compare at ulp scale without a tolerance
 *  wide enough to hide a real error.
 *
 *  `opts.gpuStubs` decides what happens at an operation the CPU cannot perform. A texture
 *  read, a screen-space derivative and the rest of the GPU-only intrinsics have no CPU
 *  meaning, and by default a call to one throws, since a plausible wrong number is the worst
 *  failure mode for a reference. Turn it on and each stands in for its GPU value: an opaque
 *  black texture read, a zero derivative. Do that only where a placeholder is acceptable for
 *  the test at hand.
 *
 *  `setBinding(name, value)` supplies a uniform or storage binding by its declared name, since
 *  a CPU run has no bind groups. Call it before invoking an entry that reads that binding.
 *
 *  A raw statement has no CPU evaluation at all. Reaching one throws, whichever target its
 *  payload was written for, because raw text is opaque to the IR and the oracle has nothing to
 *  walk.
 *
 *  It runs {@link validate} and {@link autoVars} first, the same passes the GPU writers run, so
 *  it rejects the same malformed modules they do.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param m - the module to evaluate.
 *  @param opts - `precision` and `gpuStubs`, as above.
 *  @returns the compiled module: `fns` by name, and `setBinding`.
 *  @throws {@link ValidationError} when the module fails a core rule, and `Error` when a
 *    GPU-only intrinsic is called with `gpuStubs` off, or when a raw statement is reached.
 *
 *  @example
 *  ```ts
 *  import { compileModule } from '@xgis/shader-dsl'
 *
 *  const cpu = compileModule(MODULE, { precision: 'f32' })
 *  cpu.setBinding('u', { scale: 2, offset: [0.5, 0.5] })
 *  const got = cpu.fns.transform([1, 1])
 *  ```
 *
 *  @see {@link compileModuleJs} for the same results on a hot path.
 *  @see {@link CpuPrecision} for the two precision modes.
 */
export function compileModule(
  m: ModuleDecl,
  opts?: { gpuStubs?: boolean; precision?: CpuPrecision },
): CpuModule {
  // Same validation gate as the WGSL/GLSL writers — the oracle is the third
  // backend over the same IR, so it must reject a structurally-invalid module.
  validate(m)
  // Materialise auto-vars (plain `const x = …; assign(x, …)`) into real `var` bindings, exactly
  // as the WGSL backend does, so the CPU mirror evaluates the same assignable lvalues.
  m = autoVars(m)
  // …then, in f32 mode, round after every f32 operation. AFTER autoVars, so the `var` bindings
  // it materialises have their initialisers rounded like any other.
  if (opts?.precision === 'f32') m = froundF32(m)
  const ctx: Ctx = {
    consts: new Map<string, CpuValue>(),
    // #923 — an override reads as its default on the CPU mirror.
    overrides: new Map<string, CpuValue>((m.overrides ?? []).map((o) => [o.name, o.default])),
    fns: {},
    bindings: {},
    structs: new Map(m.structs.map((s) => [s.name, s])),
    gpuStubs: opts?.gpuStubs ?? false,
  }
  // Populate consts in declaration order so a later const may reference an
  // earlier one. A `valueExpr` const (vec / array / struct literal) is evaluated
  // through the same tree-walk; a scalar const uses its full-precision cpuValue.
  for (const c of m.consts) {
    ctx.consts.set(c.name, c.valueExpr ? evalExpr(c.valueExpr, new Map(), ctx) : c.cpuValue)
  }
  for (const f of m.funcs) {
    ctx.fns[f.name] = (...args: CpuValue[]): CpuValue => {
      const env = new Map<string, CpuValue>()
      f.params.forEach((p, i) => env.set(p.name, args[i]))
      const r = execBody(f.body, env, ctx)
      // Unread placeholder: a void (ret: voidT) fn is invoked as a STATEMENT — its value
      // is never consumed, so the undefined bridged to CpuValue here is never read.
      return r.kind === 'return' ? (r.value as CpuValue) : (undefined as unknown as CpuValue)
    }
  }
  return {
    fns: ctx.fns,
    setBinding: (name, value) => {
      ctx.bindings[name] = value
    },
  }
}
