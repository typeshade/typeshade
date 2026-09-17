// ═══ Shader DSL: the stepping tree-walk (docs/debugging.md §2.1) ═══
//
// The CPU oracle's walk, re-spelled as a generator that yields at every statement boundary.
// A debug session drives it: each `yield` is a pause carrying the statement about to run and
// the live frame stack, and resuming continues exactly where it stopped.
//
// A THIRD WALK, NOT A THIRD SEMANTICS. Everything that decides a VALUE (the builtin table,
// the GPU stubs, `applyBin`'s integer rules, the saturating float-to-integer conversions,
// `zeroOf`, `FIELD_IDX`) comes from `cpu-runtime.ts`, the single authority `oracle.ts` and
// `cpu-codegen.ts` already share. This file owns only the CONTROL FLOW, which is the half
// that has to suspend. That is the same split the `new Function` twin makes, and it gets the
// same protection, in two files because the corpora live in two places:
// `step-differential.test.ts` sweeps the seeded random-IR corpus, and
// `examples/debug-step.test.ts` sweeps all 44 registered examples; both run every function
// through this walk and `compileModule` and require equality.
//
// The second of those was added after a review found what the first cannot see: `random-ir.ts`
// builds vectors of f32 scalars only, so WGSL's element-CONVERTING constructor `vecN<T>(v:
// vecN<S>)` was never generated, and this walk's `construct` arm had missed the conversion
// that `oracle.ts` applies. A generated corpus is only as wide as its generator; the
// registered examples are as wide as the language the backends accept.
//
// WHY NOT MAKE `oracle.ts` ITSELF A GENERATOR. `docs/debugging.md` §2.5 puts that option
// first and asks for a measurement rather than a guess. `scripts/bench-stepping.ts` is that
// measurement, committed so it can be re-run: a 32-iteration `sin` accumulation loop, 2000
// invocations, nine interleaved repetitions, median reported with the spread.
//
//   new Function codegen       ~0.3 µs / invocation
//   oracle tree-walk          ~13 µs / invocation
//   this generator walk       ~63 µs / invocation
//
// ABOUT FIVE TIMES the tree-walk, and that looseness is the honest form. The script's median
// has come back between 4.7x and 5.8x on different runs of the same tree, and repetitions
// inside one run span roughly 4x to 7x. An earlier version of this comment quoted 3.1x from a
// single run and a reviewer measuring the same thing got 4.1x; neither is wrong so much as
// over-precise. Run the script and read the band it prints rather than trusting this comment.
//
// The conclusion does not turn on the exact multiple: making the reference backend steppable
// would put SOME several-fold cost on every use of it, and `compileModule` is production-used
// and sits under property suites that already run for over a minute. The walk is therefore
// duplicated and differentially gated, which is §2.5's option 3. The multiple is irrelevant
// where it is paid: one invocation is still well under a millisecond, and stepping is for one
// invocation (§1.3), never a frame.
//
// PAUSE POINTS. Before each statement in a body, including the `init` and each `update` of a
// `for`. The condition of an `if`, a `for` or a `switch` is evaluated as part of pausing on
// that statement, never on its own: a shader statement is the unit the author wrote.

import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt, StructDecl } from '../ir/index.js'
import type { SourceSpan } from '../ir/span.js'
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
  elemKindOf,
  convertComponent,
  convertComponents,
} from '../cpu-runtime.js'

/** One call frame of a paused run, innermost last. Mutable on purpose: the session reads a
 *  frame's `current` at each pause, and a snapshot is taken there rather than here. */
export interface StepFrame {
  readonly fnName: string
  readonly fnSpan: SourceSpan | undefined
  /** The span of the call that created this frame; absent on the entry frame. */
  readonly callSpan: SourceSpan | undefined
  readonly env: Map<string, CpuValue>
  /** The declared type of every name this frame can hold: its parameters, and every `let` or
   *  `var` its body declares. Without it a pause has values and no way to render them: a
   *  `vec3` and a three-element array are the same `number[]` at runtime. */
  readonly types: ReadonlyMap<string, ShaderType>
  /** The statement this frame is about to execute, set at every pause. */
  current: Stmt | undefined
}

/** What the interpreter hands the driver at a statement boundary. */
export interface StepEvent {
  readonly stmt: Stmt
  /** Frame stack, outermost first. Live, so read it before resuming. */
  readonly frames: readonly StepFrame[]
  /** Set on the event yielded when a CALLEE HAS JUST RETURNED and control is back in the
   *  caller, part-way through the statement that made the call. `stmt` is that caller's
   *  statement, and the callee's frame is already gone.
   *
   *  It exists for `stepOut`, which `docs/debugging.md` §2.1 defines as "returns to the same
   *  statement with `f`'s frame gone", so that a following `stepIn` enters the SECOND call of
   *  `return f(x) + g(y)`. Without it a step-out could only be "run until the stack is
   *  shallower", which reaches the caller's NEXT statement and skips `g` entirely.
   *
   *  No other move stops here: `stepIn` and `stepOver` would otherwise stop twice on one
   *  statement, which is not what either means. */
  readonly afterCall?: true
}

/** Everything the walk needs that is not the program: the module's declarations, the host's
 *  binding values, and the two switches `compileModule` takes. */
export interface StepCtx {
  readonly consts: Map<string, CpuValue>
  readonly overrides: Map<string, CpuValue>
  readonly decls: Map<string, FuncDecl>
  readonly bindings: Record<string, CpuValue>
  readonly structs: Map<string, StructDecl>
  /** The module's declared uniform and storage names, so a binding nobody supplied is NAMED
   *  rather than reported as an unbound local. Since #18 a binding read is a `varref` like any
   *  other name, and this set is what tells the two apart. */
  readonly bindingNames: Set<string>
  readonly gpuStubs: boolean
  readonly frames: StepFrame[]
  /** The INTRINSICS that stood in during this run, by name: `dpdx`, `textureSample`.
   *
   *  Not, as this said before a review caught it, "names whose value came from a stub". It
   *  holds `e.fn`, the intrinsic's own name, so it answers whether anything stood in and what,
   *  and cannot distinguish one local from another. Marking a VALUE is `docs/debugging.md`
   *  §2.4's other half and arrives with the milestone that delivers it. */
  readonly stubbed: Set<string>
}

/** A generator that yields statement pauses and finally produces `T`. */
export type Step<T> = Generator<StepEvent, T, void>

/** The non-local exits a body can take, exactly as `oracle.ts` spells them. */
export type Signal =
  | { kind: 'normal' }
  | { kind: 'return'; value: CpuValue | undefined }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'discard' }
const NORMAL: Signal = { kind: 'normal' }

/** A binding the module declares and the session was not given a value for. Named rather than
 *  read as a zero: a debugger that invents an input silently answers a question about a
 *  different program. */
const noValueFor = (name: string): Error =>
  new Error(
    `shader-dsl/debug: no value supplied for binding '${name}'; pass it in the session's bindings`,
  )

export function* evalExpr(e: Expr, env: Map<string, CpuValue>, ctx: StepCtx): Step<CpuValue> {
  switch (e.op) {
    case 'lit':
      return e.value
    case 'constref': {
      const v = ctx.consts.get(e.name)
      if (v === undefined) throw new Error(`shader-dsl/debug: unknown const ${e.name}`)
      return v
      // This arm once also resolved a BINDING named by a constref, because the front end
      // spelled a read of `declare const camera: uniform<Camera>` that way and the oracle
      // therefore threw `unknown const` on any source-compiled module with a binding. #18
      // (issue #14) changed the lowering to a `varref`, so that shape can no longer be built
      // by either surface, and the resolution moved to the `param`/`varref` case above. The
      // workaround is gone rather than kept: unreachable code that answers differently from
      // `oracle.ts` is a divergence nothing exercises, which is exactly what
      // `step-differential.test.ts` exists to prevent.
    }
    case 'overrideref': {
      const v = ctx.overrides.get(e.name)
      if (v === undefined) throw new Error(`shader-dsl/debug: unknown override ${e.name}`)
      return v
    }
    case 'externref':
      throw new Error(`shader-dsl/debug: host-provided global '${e.name}' has no CPU value`)
    case 'param':
    case 'varref': {
      if (env.has(e.name)) return env.get(e.name) as CpuValue
      if (e.name in ctx.bindings) return ctx.bindings[e.name]
      if (ctx.bindingNames.has(e.name)) throw noValueFor(e.name)
      throw new Error(`shader-dsl/debug: unbound ${e.name}`)
    }
    case 'binop': {
      const av = yield* evalExpr(e.a, env, ctx)
      const bv = yield* evalExpr(e.b, env, ctx)
      if (
        e.bop === '*' &&
        e.a.type.kind === 'mat' &&
        (e.b.type.kind === 'vec' || e.b.type.kind === 'vec64')
      ) {
        return matVec(av as number[], bv as number[])
      }
      if (e.bop === '*' && e.a.type.kind === 'mat' && e.b.type.kind === 'mat') {
        return matMul(av as number[], bv as number[])
      }
      if (e.bop === '*' && e.a.type.kind === 'vec' && e.b.type.kind === 'mat') {
        throw new Error(
          'shader-dsl/debug: vec*mat (row-vector form) is not implemented; use mat*vec',
        )
      }
      return applyBin(e.bop, av, bv, numKindOf(e.type))
    }
    case 'unop': {
      const a = yield* evalExpr(e.a, env, ctx)
      return isArr(a) ? a.map((v) => -(v as number)) : -(a as number)
    }
    case 'compare': {
      const a = (yield* evalExpr(e.a, env, ctx)) as number
      const b = (yield* evalExpr(e.b, env, ctx)) as number
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
        default:
          return f32cmp ? Math.fround(a) !== Math.fround(b) : a !== b
      }
    }
    case 'logical': {
      const a = (yield* evalExpr(e.a, env, ctx)) as boolean
      if (e.lop === '&&') return a ? ((yield* evalExpr(e.b, env, ctx)) as boolean) : false
      return a ? true : ((yield* evalExpr(e.b, env, ctx)) as boolean)
    }
    case 'call': {
      const args: CpuValue[] = []
      for (const a of e.args) args.push(yield* evalExpr(a, env, ctx))
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
            `shader-dsl/debug: '${e.fn}' is GPU-only and not computable here; start the session with gpuStubs: true to accept placeholder values`,
          )
        }
        ctx.stubbed.add(e.fn)
        return stub(...args)
      }
      const decl = ctx.decls.get(e.fn)
      if (decl) return yield* callFunction(decl, args, e.span, ctx)
      throw new Error(`shader-dsl/debug: unknown fn ${e.fn}`)
    }
    case 'member': {
      const base = yield* evalExpr(e.base, env, ctx)
      if (isArr(base)) {
        if (e.field.length > 1) return [...e.field].map((c) => base[FIELD_IDX[c]!] as number)
        return base[FIELD_IDX[e.field]] as CpuValue
      }
      return (base as Record<string, CpuValue>)[e.field]
    }
    case 'construct': {
      if (e.type.kind === 'array') {
        const out: CpuValue[] = []
        for (const a of e.args) out.push(yield* evalExpr(a, env, ctx))
        return out as CpuValue
      }
      if (e.type.kind === 'struct') {
        const decl = ctx.structs.get(e.type.name)
        if (decl === undefined)
          throw new Error(`shader-dsl/debug: struct '${e.type.name}' not declared`)
        const obj: Record<string, CpuValue> = {}
        for (let i = 0; i < decl.fields.length; i++) {
          obj[decl.fields[i]!.name] = yield* evalExpr(e.args[i]!, env, ctx)
        }
        return obj as CpuValue
      }
      // Vector constructor. Each component is converted to the constructed vector's element
      // kind, exactly as `oracle.ts` does it and out of the same op library: for an ordinary
      // composing constructor every kind already matches and `convertComponent(s)` hands the
      // value back untouched, and for WGSL's element-CONVERTING form `vecN<T>(v: vecN<S>)` it
      // applies the same saturating and reinterpreting rules the scalar cast path applies.
      //
      // Pushing the raw components instead is what the review caught: `vec2u(v)` skipped the
      // saturation, so a stepped `convert-grid:fs` answered -3 where the oracle answers 0.
      const elem = e.type.kind === 'vec' ? e.type.elem : undefined
      const out: number[] = []
      for (const a of e.args) {
        const v = yield* evalExpr(a, env, ctx)
        const from = elemKindOf(a.type)
        if (elem === undefined || from === undefined) {
          if (isArr(v)) out.push(...(v as number[]))
          else out.push(v as number)
          continue
        }
        if (isArr(v)) out.push(...convertComponents(v as number[], from, elem))
        else out.push(convertComponent(v as number, from, elem))
      }
      if ((e.type.kind === 'vec' || e.type.kind === 'vec64') && out.length === 1)
        return new Array(e.type.n as number).fill(out[0])
      return out
    }
    case 'select': {
      const c = (yield* evalExpr(e.cond, env, ctx)) as boolean
      return c ? yield* evalExpr(e.ifTrue, env, ctx) : yield* evalExpr(e.ifFalse, env, ctx)
    }
    case 'index': {
      const base = (yield* evalExpr(e.base, env, ctx)) as CpuValue[]
      const idx = (yield* evalExpr(e.idx, env, ctx)) as number
      return base[idx]
    }
    case 'matchExpr': {
      const sv = (yield* evalExpr(e.scrutinee, env, ctx)) as number
      const hit = e.cases.find(([v]) => v === sv)
      return yield* evalExpr(hit ? hit[1] : e.default, env, ctx)
    }
  }
}

/** Push a frame, run the callee's body with pauses, pop. This is what makes "step into" a
 *  frame change rather than a jump: the call site's own span rides on the frame, so a stack
 *  trace can say where each caller stopped. */
export function* callFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
): Step<CpuValue> {
  const r = yield* runFunction(decl, args, callSpan, ctx)
  // The callee's frame has been popped by now (`runFunction`'s `finally`), so this event
  // reports the CALLER, stopped part-way through the statement that made the call. See
  // `StepEvent.afterCall`.
  const caller = ctx.frames[ctx.frames.length - 1]
  if (caller?.current) yield { stmt: caller.current, frames: ctx.frames, afterCall: true }
  // A void function invoked as a statement never has its value read, exactly as the oracle
  // bridges `undefined` here.
  return r.kind === 'return' ? (r.value as CpuValue) : (undefined as unknown as CpuValue)
}

/** The same call, handing back the whole {@link Signal} rather than just a value, which is what an
 *  entry point needs, because `discard` is an outcome a fragment debugger has to report and a
 *  returned value cannot express. */
export function* runFunction(
  decl: FuncDecl,
  args: readonly CpuValue[],
  callSpan: SourceSpan | undefined,
  ctx: StepCtx,
): Step<Signal> {
  const env = new Map<string, CpuValue>()
  decl.params.forEach((p, i) => env.set(p.name, args[i] as CpuValue))
  const frame: StepFrame = {
    fnName: decl.name,
    fnSpan: decl.span,
    callSpan,
    env,
    types: declaredTypes(decl),
    current: undefined,
  }
  ctx.frames.push(frame)
  try {
    return yield* execBody(decl.body, env, ctx)
  } finally {
    ctx.frames.pop()
  }
}

function* setLValue(
  target: Expr,
  value: CpuValue,
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<void> {
  if (target.op === 'varref' || target.op === 'param') {
    env.set(target.name, value)
    return
  }
  if (target.op === 'member') {
    const base = yield* evalExpr(target.base, env, ctx)
    if (isArr(base)) base[FIELD_IDX[target.field]] = value as number
    else (base as Record<string, CpuValue>)[target.field] = value
    return
  }
  if (target.op === 'index') {
    const base = (yield* evalExpr(target.base, env, ctx)) as CpuValue[]
    const idx = (yield* evalExpr(target.idx, env, ctx)) as number
    base[idx] = value
    return
  }
  throw new Error(`shader-dsl/debug: bad assignment target ${target.op}`)
}

export function* execBody(
  body: readonly Stmt[],
  env: Map<string, CpuValue>,
  ctx: StepCtx,
): Step<Signal> {
  const frame = ctx.frames[ctx.frames.length - 1]
  for (const s of body) {
    if (frame) frame.current = s
    yield { stmt: s, frames: ctx.frames }
    switch (s.s) {
      case 'let':
        env.set(s.name, yield* evalExpr(s.expr, env, ctx))
        break
      case 'var':
        env.set(s.name, s.init ? yield* evalExpr(s.init, env, ctx) : zeroOf(s.type))
        break
      case 'assign':
        yield* setLValue(s.target, yield* evalExpr(s.expr, env, ctx), env, ctx)
        break
      case 'assignOp': {
        const cur = yield* evalExpr(s.target, env, ctx)
        const kind = numKindOf(s.target.type)
        const rhs = yield* evalExpr(s.expr, env, ctx)
        yield* setLValue(s.target, applyBin(s.bop, cur, rhs, kind), env, ctx)
        break
      }
      case 'return':
        return { kind: 'return', value: s.expr ? yield* evalExpr(s.expr, env, ctx) : undefined }
      case 'break':
        return { kind: 'break' }
      case 'continue':
        return { kind: 'continue' }
      case 'discard':
        return { kind: 'discard' }
      case 'if': {
        let taken = false
        for (const arm of s.arms) {
          if (yield* evalExpr(arm.cond, env, ctx)) {
            const r = yield* execBody(arm.body, env, ctx)
            if (r.kind !== 'normal') return r
            taken = true
            break
          }
        }
        if (!taken && s.elseBody) {
          const r = yield* execBody(s.elseBody, env, ctx)
          if (r.kind !== 'normal') return r
        }
        break
      }
      case 'for': {
        yield* execBody([s.init], env, ctx)
        while (yield* evalExpr(s.cond, env, ctx)) {
          const r = yield* execBody(s.body, env, ctx)
          if (r.kind === 'break') break
          if (r.kind === 'return' || r.kind === 'discard') return r
          yield* execBody([s.update], env, ctx)
        }
        break
      }
      case 'switch': {
        const v = (yield* evalExpr(s.scrut, env, ctx)) as number
        const hit = s.cases.find((c) => c.value === v)
        const chosen = hit ? hit.body : s.defaultBody
        if (chosen) {
          const r = yield* execBody(chosen, env, ctx)
          if (r.kind !== 'normal' && r.kind !== 'break') return r
        }
        break
      }
      case 'placeholder':
        throw new Error(
          `shader-dsl/debug: placeholder Stmt reached the stepping backend; composer forgot to splice tag=${s.tag}`,
        )
      case 'raw':
        throw new Error(
          'shader-dsl/debug: raw Stmt reached the stepping backend; raw passthrough is GPU-only',
        )
    }
  }
  return NORMAL
}

/** Build the evaluation context for `m`, with module constants already evaluated. The consts
 *  walk is not steppable: a module constant is fixed before any entry point runs, so there is
 *  no invocation to pause inside. Its pauses are drained rather than reported. */
export function makeCtx(m: ModuleDecl, gpuStubs: boolean): StepCtx {
  const ctx: StepCtx = {
    consts: new Map<string, CpuValue>(),
    overrides: new Map<string, CpuValue>((m.overrides ?? []).map((o) => [o.name, o.default])),
    decls: new Map(m.funcs.map((f) => [f.name, f])),
    bindings: {},
    structs: new Map(m.structs.map((s) => [s.name, s])),
    bindingNames: new Set(m.bindings.map((b) => b.name)),
    gpuStubs,
    frames: [],
    stubbed: new Set<string>(),
  }
  for (const c of m.consts) {
    ctx.consts.set(c.name, c.valueExpr ? drain(evalExpr(c.valueExpr, new Map(), ctx)) : c.cpuValue)
  }
  return ctx
}

/** Every name a call to `decl` can hold, with the type it was declared at: the parameters,
 *  then every `let` and `var` in the body, at every depth.
 *
 *  Flat, because the evaluator's environment is: `oracle.ts` keeps one `Map` per call with no
 *  per-block child scope, since the only way to reference a binding is the node the builder
 *  returned and the host language already scoped that lexically. A name declared twice in two
 *  sibling blocks therefore has one entry here, the last one seen, the same conflation the
 *  environment itself makes, so the type a pause reports always matches the value beside it.
 *
 *  Computed once per frame push. A body is walked in full, which is linear in its statements
 *  and happens once per call rather than once per pause.
 */
function declaredTypes(decl: FuncDecl): ReadonlyMap<string, ShaderType> {
  const out = new Map<string, ShaderType>()
  for (const p of decl.params) out.set(p.name, p.type)
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      switch (s.s) {
        case 'let':
          out.set(s.name, s.expr.type)
          break
        case 'var':
          out.set(s.name, s.type)
          break
        case 'if':
          for (const arm of s.arms) walk(arm.body)
          if (s.elseBody) walk(s.elseBody)
          break
        case 'for':
          walk([s.init])
          walk([s.update])
          walk(s.body)
          break
        case 'switch':
          for (const c of s.cases) walk(c.body)
          if (s.defaultBody) walk(s.defaultBody)
          break
        default:
          break
      }
    }
  }
  walk(decl.body)
  return out
}

/** Run a generator to completion, discarding its pauses. */
export function drain<T>(g: Step<T>): T {
  let r = g.next()
  while (!r.done) r = g.next()
  return r.value
}
