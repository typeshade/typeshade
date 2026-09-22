// ═══ Derivative uniformity: the control flow a sample may be reached under (§54) ═══
//
// WGSL's `derivative_uniformity` rule (wgsl.txt:17477-17482) says that `textureSample`,
// `textureSampleBias`, `textureSampleCompare` and the screen-space derivatives must be called
// from UNIFORM control flow — every invocation of the quad reaches the call, or none does —
// because the implicit level of detail is a difference between neighbouring invocations, and
// an invocation that did not run has no value to difference against. Its default severity is
// `error` (wgsl.txt:1646-1648). `workgroupBarrier` has the same shape for a different reason:
// a workgroup where some invocations reach the barrier and some do not waits forever.
//
// Measured on the two Chromium builds this repository compiles against — 141
// (`chromium_headless_shell-1194`) and 153 (`chromium_headless_shell-1243`, what CI installs)
// — with the broken-shader instrument check passing first. IDENTICAL on both:
//
//   textureSample under `if (uv.x > 0.5)` on a fragment input
//     'textureSample' must only be called from uniform control flow
//   the same with `diagnostic(off, derivative_uniformity);` at module scope   ACCEPTED
//   the same with `@diagnostic(off, derivative_uniformity)` on the entry      ACCEPTED
//   textureSample under `if (k > 0.5)` on a uniform buffer value              ACCEPTED
//   textureSampleLevel under a condition on a fragment input                  ACCEPTED
//   dpdx under a condition on a fragment input
//     'dpdx' must only be called from uniform control flow
//   workgroupBarrier under a condition on a uniform buffer value              ACCEPTED
//   workgroupBarrier under `if (id.x > 4u)` on local_invocation_id
//     'workgroupBarrier' must only be called from uniform control flow
//   workgroupBarrier under a non-uniform condition WITH `diagnostic(off, …)`
//     'workgroupBarrier' must only be called from uniform control flow — the filter is the
//     DERIVATIVE rule's; a barrier's requirement is not filterable, so the off switch must
//     not silence it either
//
// Every one of those is reported by `createShaderModule`, not only by `createRenderPipeline`,
// so the compile gate already runs this check on every example; #161's acceptance item asking
// for a pipeline leg rests on a premise the measurement disproves.
//
// THREE-VALUED, deliberately. A two-valued analysis has to choose which way to be wrong, and
// the two callers want opposite answers:
//
//   • A DERIVATIVE is refused only when its control flow is DEFINITELY non-uniform. Anything
//     this walk cannot follow stays `unknown` and is allowed through to Tint, which owns the
//     complete rule. A false positive here would refuse a program both targets run.
//   • A BARRIER is reported unless its control flow is DEFINITELY uniform. The rule it
//     replaces refused every branch outright, so `unknown` keeps that refusal and the
//     relaxation can only ever admit a condition this walk has proven.
//
// FLOW-SENSITIVE, and that is not a refinement — it is what makes both thresholds true. An
// earlier version joined every write to a name regardless of order, which is wrong in both
// directions at once: `let g = uv.x; g = 0.25; if (g > 0.5) { textureSample(…) }` was refused
// though Tint accepts it, and a copy chain three deep (`a = b; b = c; c = f32(lid.x)`) settled
// at `uniform` for a name that is not, so a barrier under it was ADMITTED though Tint refuses
// it. An environment threaded in statement order, with branches merged at their join, answers
// both correctly, and a loop body is iterated to a fixpoint so a value carried round the loop
// is seen.
//
// INTERPROCEDURAL, for the same reason. A barrier at a helper's top level is uniform only if
// every call of that helper is. The walk therefore runs to a fixpoint over the call graph, and
// each call site hands its callee TWO things: the control flow the call is reached under, and
// the class of each ARGUMENT, joined per parameter position. Entries start at `uniform`; a
// helper nothing calls starts there too, on its own terms, since there is no caller to claim
// anything wrong about.
//
// Both halves of that are a hole when missing, and each was measured. Dropping the arguments
// at the CALL made `if (edge(v.uv.x)) { textureSample(…) }` compile, where `edge` is
// `x > 0.5`; seeding a helper's PARAMETERS `unknown` regardless made `shade(v.uv.x, v.uv)`
// compile, where `shade` samples under `if (x > 0.5)`. Tint refuses both, and refuses the
// inline form of each — which the walk already caught, so the same program passed or failed on
// whether it went through a one-line helper. A helper is not a policy boundary.
//
// WHAT IT DOES NOT REACH, stated rather than implied. It runs in the `"use typeshade"` front
// end only, so an EDSL-assembled `ModuleDecl` is not checked here — the front end is where a
// diagnostic can point at the authoring line, and an EDSL module reaches Tint, which owns the
// complete rule, unchanged. A `raw` statement's text is opaque to it. And the seeds are the
// spec's: anything outside them is `unknown`, never `uniform`.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js'
import { stageOf } from '../ir/nodes.js'
import { eachExpr, eachStmtExpr } from '../ir/visit.js'
import { DERIVATIVE_INTRINSICS, isBarrierIntrinsic, isKnownIntrinsic } from '../intrinsics.js'
import type { SourceSpan } from '../ir/span.js'

/** How a value varies across the invocations that run together. */
export type Uniformity = 'uniform' | 'non-uniform' | 'unknown'

/** The built-in values WGSL declares uniform (wgsl.txt:17870-17883). Every OTHER builtin and
 *  every user input varies by invocation — that is the whole of the seed table, and it is
 *  short because the spec's is. */
const UNIFORM_BUILTINS: ReadonlySet<string> = new Set([
  'workgroup_id',
  'num_workgroups',
  'subgroup_size',
  'num_subgroups',
])

/** Join along control flow: two values that meet are uniform only if both were, and
 *  non-uniform as soon as either is — an invocation taking the other path already makes them
 *  differ. */
function join(a: Uniformity, b: Uniformity): Uniformity {
  if (a === 'non-uniform' || b === 'non-uniform') return 'non-uniform'
  return a === 'uniform' && b === 'uniform' ? 'uniform' : 'unknown'
}

/** One call this walk has an answer about. */
export interface UniformityViolation {
  /** The function the call sits in. */
  readonly fn: string
  /** The intrinsic called: `textureSample`, `dpdx`, `workgroupBarrier`, … */
  readonly callee: string
  /** `'derivative'` when the call needs uniform control flow for its implicit LOD or because
   *  it IS a derivative, `'barrier'` when it needs it so the workgroup can rejoin. */
  readonly kind: 'derivative' | 'barrier'
  /** Whether the callee is one of `dpdx` / `dpdy` / `fwidth` and their variants — the ones
   *  with no explicit-LOD alternative to name as a fix, since a screen-space derivative is
   *  what they ARE. */
  readonly isDerivativeBuiltin: boolean
  /** What made the control flow non-uniform, as a phrase a message can carry:
   *  `"uv" (a fragment input at @location(0))`. */
  readonly cause: string
  /** Where the call was authored, when the IR carries it. */
  readonly span?: SourceSpan
}

/** A value's class, with the phrase a diagnostic uses for it. */
interface Known {
  readonly at: Uniformity
  readonly why: string
}

const UNKNOWN: Known = { at: 'unknown', why: 'a value this compiler cannot classify' }

/** Join two classes, keeping the phrase that names the one an author would act on: the
 *  non-uniform side if there is one, since that is the value to change. */
function joinKnown(a: Known, b: Known): Known {
  const at = join(a.at, b.at)
  if (a.at === 'non-uniform') return { at, why: a.why }
  if (b.at === 'non-uniform') return { at, why: b.why }
  return { at, why: a.why }
}

/** The environment: what this walk knows about each local, at a point in the statement order. */
type Env = Map<string, Known>

/** `true` when two environments agree on every name either holds — the loop fixpoint's test. */
function sameEnv(a: Env, b: Env): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const o = b.get(k)
    if (o === undefined || o.at !== v.at) return false
  }
  return true
}

/** `true` when two per-position argument lists agree — the other half of the call-graph
 *  fixpoint's settling test, beside the control-flow classes. */
function sameArgs(a: readonly Known[] | undefined, b: readonly Known[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b
  if (a.length !== b.length) return false
  return a.every((x, i) => x.at === b[i]?.at)
}

/** Merge two environments at a control-flow join: a name either side does not hold is one
 *  whose value before the branch is still live, so the caller passes the entry environment in
 *  as one of the two. */
function mergeEnv(a: Env, b: Env): Env {
  const out: Env = new Map(a)
  for (const [k, v] of b) {
    const prior = out.get(k)
    out.set(k, prior === undefined ? v : joinKnown(prior, v))
  }
  return out
}

/** How an entry parameter varies, and the phrase that names it. */
function paramUniformity(
  m: ModuleDecl,
  f: FuncDecl,
  p: FuncDecl['params'][number],
): Known | undefined {
  const stage = stageOf(f)
  if (stage === undefined) return undefined
  if (p.builtin !== undefined) {
    return UNIFORM_BUILTINS.has(p.builtin)
      ? { at: 'uniform', why: `"${p.name}" (@builtin(${p.builtin}), uniform across the group)` }
      : { at: 'non-uniform', why: `"${p.name}" (@builtin(${p.builtin}))` }
  }
  if (p.location !== undefined) {
    return {
      at: 'non-uniform',
      why: `"${p.name}" (a ${stage} input at @location(${String(p.location)}))`,
    }
  }
  // A struct entry parameter: the whole value is only as uniform as the field that is read,
  // which `member` below answers. Nothing is claimed about the struct itself.
  const t = p.type
  if (t.kind === 'struct' && m.structs.some((s) => s.name === t.name)) {
    return { at: 'unknown', why: `"${p.name}"` }
  }
  return undefined
}

/** How a struct field of an entry parameter varies. */
function fieldUniformity(
  m: ModuleDecl,
  structName: string,
  field: string,
  stage: string,
): Known | undefined {
  const s = m.structs.find((x) => x.name === structName)
  const f = s?.fields.find((x) => x.name === field)
  if (!f) return undefined
  if (f.builtin !== undefined) {
    return UNIFORM_BUILTINS.has(f.builtin)
      ? {
          at: 'uniform',
          why: `"${structName}.${field}" (@builtin(${f.builtin}), uniform across the group)`,
        }
      : { at: 'non-uniform', why: `"${structName}.${field}" (@builtin(${f.builtin}))` }
  }
  if (f.location !== undefined) {
    return {
      at: 'non-uniform',
      why: `"${structName}.${field}" (a ${stage} input at @location(${String(f.location)}))`,
    }
  }
  return undefined
}

/** What a walk of one function reads that does not change as it steps: the module, the
 *  function, and the class each PARAMETER was called with.
 *
 *  `paramAt` is the caller's half of the interprocedural answer, and it is the half the walk
 *  used to throw away. A helper's parameters were seeded `unknown` unconditionally, so
 *  `function shade(x: f32, uv: vec2) { if (x > 0.5) { textureSample(…) } }` called as
 *  `shade(v.uv.x, v.uv)` compiled silently while Tint answers `'textureSample' must only be
 *  called from uniform control flow` — the same program the walk refuses when the condition is
 *  written inline. A one-line helper is not a policy boundary, so the classes at the call
 *  sites are joined per position and seeded here. A parameter no call site reached stays
 *  absent, which reads back as `unknown` and keeps a helper nothing calls exactly as it was. */
interface Cx {
  readonly m: ModuleDecl
  readonly f: FuncDecl
  readonly paramAt: ReadonlyMap<string, Known>
}

/** How one expression varies, read against the environment at this point. */
function classify(cx: Cx, env: Env, e: Expr): Known {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return { at: 'uniform', why: 'a constant' }
    // A pipeline-overridable constant is one value for the whole dispatch.
    case 'overrideref':
      return { at: 'uniform', why: `override "${e.name}"` }
    case 'param': {
      const p = cx.f.params.find((x) => x.name === e.name)
      // An ENTRY's parameter is answered by its own attribute — a `@builtin` or a `@location`
      // is a fact about the declaration, and no caller can change it (§52 refuses calling an
      // entry). A HELPER's parameter is answered by its call sites, which `paramAt` carries.
      const own = p && paramUniformity(cx.m, cx.f, p)
      if (own) return own
      return cx.paramAt.get(e.name) ?? { at: 'unknown', why: `"${e.name}"` }
    }
    case 'varref': {
      const local = env.get(e.name)
      if (local) return local
      const b = cx.m.bindings.find((x) => x.name === e.name)
      // A `uniform` buffer holds one value for every invocation. A `storage` buffer does too,
      // but a READ of one is only as uniform as the index, which this walk does not follow —
      // so it stays `unknown` rather than claiming either answer. A module-scope `var` is
      // `unknown` for the same reason: `var<private>` is per-invocation.
      if (b) {
        return b.space === 'uniform'
          ? { at: 'uniform', why: `uniform "${e.name}"` }
          : { at: 'unknown', why: `"${e.name}"` }
      }
      return { at: 'unknown', why: `"${e.name}"` }
    }
    case 'member': {
      const base = e.base
      if (base.op === 'param') {
        const p = cx.f.params.find((x) => x.name === base.name)
        const stage = stageOf(cx.f)
        if (p?.type.kind === 'struct' && stage !== undefined) {
          const known = fieldUniformity(cx.m, p.type.name, e.field, stage)
          if (known) return known
        }
      }
      return classify(cx, env, base)
    }
    case 'call': {
      // A derivative's own result varies by invocation by construction.
      if (DERIVATIVE_INTRINSICS.has(e.fn)) {
        return { at: 'non-uniform', why: `${e.fn}(…), which differences neighbouring invocations` }
      }
      const fromArgs = joinAll(cx, env, e.args, `${e.fn}(…)`)
      // An INTRINSIC is a pure function of its arguments, so it is exactly as uniform as they
      // are — and a nullary one (there are none that return a value, but the arm has to be
      // right) has nothing to read, so it claims nothing.
      if (isKnownIntrinsic(e.fn)) {
        return e.args.length === 0 ? { at: 'unknown', why: `${e.fn}(…)` } : fromArgs
      }
      // A call into a USER function is AT LEAST `unknown` and AT MOST as uniform as its
      // arguments. Both halves are load-bearing and each was wrong on its own:
      //
      //   • Never `uniform`, whatever the arguments say, because the body can read a module
      //     `var`, a storage buffer or a built-in value this walk never sees — so reading the
      //     arguments alone would PROVE uniform a call that is not one, and that proof is what
      //     the barrier rule rests on.
      //   • Never MORE uniform than its arguments either. Returning a bare `unknown` laundered
      //     a definitely non-uniform value: a one-line `function edge(x: f32): bool { return x
      //     > 0.5 }` put `if (edge(v.uv.x)) { textureSample(…) }` straight past this walk,
      //     while the same condition written inline was refused — the same program passing or
      //     failing on whether its condition went through a helper. Measured on Chromium 141,
      //     with the broken-shader instrument reporting first: Tint refuses all four shapes
      //     (the sample inside the branch and after it, an identity helper, and `dpdx`), and
      //     accepts `edge(k)` on a uniform.
      //
      // Joining `unknown` with the arguments is exactly those two rules: `edge(k)` stays
      // `unknown` (allowed through, as Tint allows it), and `edge(v.uv.x)` is `non-uniform`.
      return {
        at: join('unknown', fromArgs.at),
        why: fromArgs.at === 'non-uniform' ? fromArgs.why : `${e.fn}(…)`,
      }
    }
    case 'binop':
    case 'compare':
    case 'logical':
      return joinAll(cx, env, [e.a, e.b], 'the expression')
    case 'unop':
      return classify(cx, env, e.a)
    case 'construct':
      return e.args.length === 0 ? UNKNOWN : joinAll(cx, env, e.args, 'the expression')
    case 'index':
      return joinAll(cx, env, [e.base, e.idx], 'the expression')
    case 'select':
      return joinAll(cx, env, [e.cond, e.ifTrue, e.ifFalse], 'the expression')
    case 'matchExpr':
      return joinAll(
        cx,
        env,
        [e.scrutinee, ...e.cases.map(([, v]) => v), e.default],
        'the expression',
      )
    // A host global: nothing is claimed.
    default:
      return UNKNOWN
  }
}

function joinAll(cx: Cx, env: Env, es: readonly Expr[], fallback: string): Known {
  let out: Known = { at: 'uniform', why: fallback }
  for (const e of es) out = joinKnown(out, classify(cx, env, e))
  return out
}

/** The state a statement walk carries: the environment, the control flow it is under, and
 *  whether an earlier `return` or `discard` under non-uniform control flow has already made
 *  the rest of this function non-uniform. */
interface Flow {
  env: Env
  at: Uniformity
  why: string
  /** Set once a `return` runs under control flow that is not uniform: those invocations are
   *  gone, so everything after is reached by a subset of them. Measured — `if (id.x > 4u)
   *  { return }` above a barrier is `'workgroupBarrier' must only be called from uniform
   *  control flow`, and above a `textureSample` the same of it.
   *
   *  `return` ONLY, which is also measured and is not an omission. A `discard` under the same
   *  condition is ACCEPTED above both a `fwidth` and a `textureSample`: the invocation is
   *  demoted to a helper rather than ended, so it goes on contributing the neighbour a
   *  derivative differences against — which is why `discard` beside `fwidth` is the ordinary
   *  antialiased-cutout idiom and `examples/cutout.shade.ts` compiles on Tint. A `break` out
   *  of a loop under a non-uniform condition, above a barrier, is ACCEPTED too. */
  diverged: Known | undefined
}

/** Runs the analysis over `m` and returns every call it has an answer about.
 *
 *  A `derivative` violation is reported only when the enclosing control flow is DEFINITELY
 *  non-uniform; a `barrier` one whenever it is not definitely uniform. See the header for why
 *  the two thresholds differ. */
export function uniformityViolations(m: ModuleDecl): UniformityViolation[] {
  const byName = new Map(m.funcs.map((f) => [f.name, f]))
  const isEntry = (name: string): boolean => {
    const f = byName.get(name)
    return f !== undefined && stageOf(f) !== undefined
  }
  const entrySeed = (name: string): Known =>
    isEntry(name)
      ? { at: 'uniform', why: 'the entry' }
      : // A function NOTHING calls is analysed on its own, by WGSL and by this walk alike, so
        // its body starts uniform: there is no caller to claim anything wrong about. A
        // pessimistic seed refused a barrier at the top level of a helper-only module — under
        // no branch at all, with a message about moving it out of one — and no spelling got
        // such a module through, since the diagnostic filter does not reach the barrier rule.
        { at: 'uniform', why: 'no call of it' }

  // A DESCENDING fixpoint over the call graph. Every function starts uniform and degrades as
  // the classes at its call sites come in; a round that changes no start class is the last.
  //
  // Recomputed into a FRESH map each round, not accumulated into one. Accumulating made the
  // answer depend on declaration order: a helper walked before its caller in round 0 seeded
  // its own callees from a start class nothing had set yet, and `joinKnown` can only degrade,
  // so a function two calls below an entry stayed at that first guess forever — the same
  // program with the entry declared first compiled, and with the helpers first it did not.
  /** The ARGUMENT classes a callee was called with, joined per parameter position, keyed by
   *  parameter name. Carried alongside the control-flow class because the two answer different
   *  halves of the same question: `startAt` says what flow the body runs under, `startArgs`
   *  says what its parameters hold. Both are the caller's to supply and both were needed. */
  const seedArgs = (name: string, positions: readonly Known[]): Map<string, Known> => {
    const f = byName.get(name)
    const out = new Map<string, Known>()
    if (f === undefined) return out
    f.params.forEach((p, i) => {
      const at = positions[i]
      if (at !== undefined) out.set(p.name, at)
    })
    return out
  }

  let startAt = new Map<string, Known>(m.funcs.map((f) => [f.name, entrySeed(f.name)]))
  let startArgs = new Map<string, readonly Known[]>()
  for (let round = 0; round <= m.funcs.length + 1; round++) {
    const next = new Map<string, Known>()
    const nextArgs = new Map<string, readonly Known[]>()
    const record = (callee: string, at: Known, args: readonly Known[]): void => {
      // An entry cannot be called (§52 refuses it), so nothing degrades one.
      if (!byName.has(callee) || isEntry(callee)) return
      const prior = next.get(callee)
      next.set(callee, prior === undefined ? at : joinKnown(prior, at))
      // Per POSITION, so two call sites of one helper give each parameter the join of what
      // each was handed — `shade(v.uv.x, …)` and `shade(k, …)` leave `x` non-uniform, which
      // is the answer WGSL gives a function it analyses once for every call of it.
      const priorArgs = nextArgs.get(callee)
      nextArgs.set(
        callee,
        priorArgs === undefined
          ? args
          : args.map((a, i) => {
              const p = priorArgs[i]
              return p === undefined ? a : joinKnown(p, a)
            }),
      )
    }
    // The findings of a fixpoint round are thrown away: only the LAST pass, over the settled
    // start classes, reports.
    for (const f of m.funcs) {
      walkFunction(
        m,
        f,
        startAt.get(f.name),
        seedArgs(f.name, startArgs.get(f.name) ?? []),
        [],
        record,
      )
    }
    for (const f of m.funcs) if (!next.has(f.name)) next.set(f.name, entrySeed(f.name))
    const settled =
      m.funcs.every((f) => next.get(f.name)?.at === startAt.get(f.name)?.at) &&
      m.funcs.every((f) => sameArgs(nextArgs.get(f.name), startArgs.get(f.name)))
    startAt = next
    startArgs = nextArgs
    if (settled) break
  }

  const found: UniformityViolation[] = []
  for (const f of m.funcs) {
    walkFunction(
      m,
      f,
      startAt.get(f.name),
      seedArgs(f.name, startArgs.get(f.name) ?? []),
      found,
      () => undefined,
    )
  }
  // One call, one violation. A loop body is walked more than once — the fixpoint that follows
  // a value carried round the loop — so a barrier inside one was reported once per iteration,
  // and an author saw the same sentence twice about the same line.
  const seen = new Set<string>()
  return found.filter((v) => {
    const key = `${v.fn}|${v.callee}|${v.kind}|${v.span?.start ?? -1}|${v.cause}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function walkFunction(
  m: ModuleDecl,
  f: FuncDecl,
  start: Known | undefined,
  paramAt: ReadonlyMap<string, Known>,
  found: UniformityViolation[],
  record: (callee: string, at: Known, args: readonly Known[]) => void,
): void {
  const cx: Cx = { m, f, paramAt }
  const entry: Flow = {
    env: new Map(),
    at: start?.at ?? 'unknown',
    why: start?.why ?? 'the control flow this function is called under',
    diverged: undefined,
  }

  /** Every call inside one Expr TREE, checked under the control flow `flow` is at. */
  const checkExpr = (e: Expr, flow: Flow): void => {
    eachExpr(e, (x) => {
      if (x.op !== 'call') return
      // The divergence's OWN class, not the literal `non-uniform`: an early `return` under a
      // condition this walk cannot follow leaves the rest of the function `unknown`, which is
      // what the header promises and what keeps a derivative under it from being refused
      // though Tint accepts it. The barrier threshold is unchanged, since `unknown` is still
      // not `uniform`.
      const at = flow.diverged ? join(flow.at, flow.diverged.at) : flow.at
      const why = flow.diverged ? flow.diverged.why : flow.why
      // The flow the call is under, AND the class of each argument: a helper's body needs
      // both, and seeding its parameters `unknown` regardless of what it was handed is what
      // let a derivative under `if (x > 0.5)` inside it pass while Tint refused it.
      record(
        x.fn,
        { at, why },
        x.args.map((a) => classify(cx, flow.env, a)),
      )
      if (DERIVATIVE_INTRINSICS.has(x.fn)) {
        if (at === 'non-uniform') {
          found.push({
            fn: f.name,
            callee: x.fn,
            kind: 'derivative',
            isDerivativeBuiltin: /^(dpdx|dpdy|fwidth)/.test(x.fn),
            cause: why,
            span: x.span,
          })
        }
      } else if (isBarrierIntrinsic(x.fn) && at !== 'uniform') {
        found.push({
          fn: f.name,
          callee: x.fn,
          kind: 'barrier',
          isDerivativeBuiltin: false,
          cause: at === 'non-uniform' ? why : `${why}, which this compiler cannot prove uniform`,
          span: x.span,
        })
      }
    })
  }

  /** Walks `stmts` in order, threading `flow`, and returns the flow after them. */
  const walk = (stmts: readonly Stmt[], flow: Flow): Flow => {
    let cur = flow
    for (const s of stmts) {
      // Every Expr this statement holds directly, read under the control flow reaching it.
      eachStmtExpr(
        s,
        (e) => checkExpr(e, cur),
        () => undefined,
      )
      switch (s.s) {
        case 'let':
          cur = { ...cur, env: bind(cur, s.name, classify(cx, cur.env, s.expr)) }
          break
        case 'var':
          cur = {
            ...cur,
            env: bind(cur, s.name, s.init ? classify(cx, cur.env, s.init) : UNKNOWN),
          }
          break
        case 'assign':
        case 'assignOp': {
          // A write under a branch is only as uniform as the branch: the invocations that did
          // not take it keep the old value, so the two differ afterwards.
          //
          // The ROOT of the target, not the target itself. `v.x = f32(lid.x)` and
          // `v[0] = f32(lid.x)` write `v`, and reading only a bare `varref` left `v` at the
          // class its initialiser had — so `if (v.x > 4.) { workgroupBarrier() }` was ACCEPTED
          // where Tint answers `'workgroupBarrier' must only be called from uniform control
          // flow`. That is a false PROOF, not a conservative gap, which is the one thing the
          // barrier threshold cannot tolerate. A write through a member joins rather than
          // replaces: the other lanes of `v` keep what they had.
          const root = rootVarref(s.target)
          if (root !== undefined) {
            const v = classify(cx, cur.env, s.expr)
            const under: Known = { at: cur.at, why: cur.why }
            const whole = joinKnown(v, under)
            const prior = s.target.op === 'varref' ? undefined : cur.env.get(root)
            cur = {
              ...cur,
              env: bind(cur, root, prior === undefined ? whole : joinKnown(prior, whole)),
            }
          }
          break
        }
        case 'if': {
          let merged: Env | undefined
          let after = cur
          let armsCond: Known = { at: 'uniform', why: cur.why }
          for (const arm of s.arms) {
            const c = classify(cx, cur.env, arm.cond)
            armsCond = joinKnown(armsCond, c)
            const inner = walk(arm.body, {
              env: new Map(cur.env),
              at: join(cur.at, c.at),
              why: c.at === 'uniform' ? cur.why : c.why,
              diverged: cur.diverged,
            })
            merged = merged === undefined ? inner.env : mergeEnv(merged, inner.env)
            if (inner.diverged !== undefined && cur.diverged === undefined) {
              after = { ...after, diverged: inner.diverged }
            }
          }
          // The `else` runs under the negation of every arm's condition, so it is exactly as
          // uniform as the arms are.
          if (s.elseBody) {
            const inner = walk(s.elseBody, {
              env: new Map(cur.env),
              at: join(cur.at, armsCond.at),
              why: armsCond.at === 'uniform' ? cur.why : armsCond.why,
              diverged: cur.diverged,
            })
            merged = merged === undefined ? inner.env : mergeEnv(merged, inner.env)
            if (inner.diverged !== undefined && cur.diverged === undefined) {
              after = { ...after, diverged: inner.diverged }
            }
          }
          cur = { ...after, env: merged === undefined ? cur.env : mergeEnv(cur.env, merged) }
          break
        }
        case 'for': {
          // The init runs once, before the condition; the body and the update run under it.
          // A value carried round the loop is seen by iterating to a fixpoint, which is what
          // makes `a = b; b = c; c = <non-uniform>` reach `a` however long the chain is.
          let outer = walk([s.init], cur)
          for (let i = 0; i <= s.body.length + 2; i++) {
            const c = classify(cx, outer.env, s.cond)
            const body = walk(s.body, {
              env: new Map(outer.env),
              at: join(outer.at, c.at),
              why: c.at === 'uniform' ? outer.why : c.why,
              diverged: outer.diverged,
            })
            const afterUpdate = walk([s.update], body)
            const next = mergeEnv(outer.env, afterUpdate.env)
            const settled = sameEnv(next, outer.env)
            outer = {
              env: next,
              at: outer.at,
              why: outer.why,
              diverged: outer.diverged ?? afterUpdate.diverged,
            }
            if (settled) break
          }
          cur = outer
          break
        }
        case 'switch': {
          const c = classify(cx, cur.env, s.scrut)
          const inner = join(cur.at, c.at)
          const w = c.at === 'uniform' ? cur.why : c.why
          let merged: Env | undefined
          let diverged = cur.diverged
          for (const body of [
            ...s.cases.map((x) => x.body),
            ...(s.defaultBody ? [s.defaultBody] : []),
          ]) {
            const out = walk(body, {
              env: new Map(cur.env),
              at: inner,
              why: w,
              diverged: cur.diverged,
            })
            merged = merged === undefined ? out.env : mergeEnv(merged, out.env)
            diverged = diverged ?? out.diverged
          }
          cur = {
            ...cur,
            diverged,
            env: merged === undefined ? cur.env : mergeEnv(cur.env, merged),
          }
          break
        }
        case 'return':
          if (cur.at !== 'uniform' && cur.diverged === undefined) {
            cur = { ...cur, diverged: { at: cur.at, why: cur.why } }
          }
          break
        default:
          break
      }
    }
    return cur
  }

  walk(f.body, entry)
}

/** The name a write ultimately lands on: `v` for `v`, `v.x`, `v[0]`, `v.a[i].b`. `undefined`
 *  when the write does not reach a local at all — a storage or module binding, which this
 *  walk claims nothing about anyway. */
function rootVarref(target: Expr): string | undefined {
  switch (target.op) {
    case 'varref':
      return target.name
    case 'member':
      return rootVarref(target.base)
    case 'index':
      return rootVarref(target.base)
    default:
      return undefined
  }
}

/** `env` with `name` bound, without mutating the environment a sibling branch holds. */
function bind(flow: Flow, name: string, value: Known): Env {
  const next = new Map(flow.env)
  next.set(name, value)
  return next
}
