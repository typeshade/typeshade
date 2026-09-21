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
// every call of that helper is. The walk therefore runs to a fixpoint over the call graph:
// entries start at `uniform`, a helper starts at the join of the control flow at its call
// sites, and a helper nothing calls starts at `unknown`, which keeps its barrier refused.
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

/** How one expression varies, read against the environment at this point. */
function classify(m: ModuleDecl, f: FuncDecl, env: Env, e: Expr): Known {
  switch (e.op) {
    case 'lit':
    case 'constref':
      return { at: 'uniform', why: 'a constant' }
    // A pipeline-overridable constant is one value for the whole dispatch.
    case 'overrideref':
      return { at: 'uniform', why: `override "${e.name}"` }
    case 'param': {
      const p = f.params.find((x) => x.name === e.name)
      return (p && paramUniformity(m, f, p)) ?? { at: 'unknown', why: `"${e.name}"` }
    }
    case 'varref': {
      const local = env.get(e.name)
      if (local) return local
      const b = m.bindings.find((x) => x.name === e.name)
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
        const p = f.params.find((x) => x.name === base.name)
        const stage = stageOf(f)
        if (p?.type.kind === 'struct' && stage !== undefined) {
          const known = fieldUniformity(m, p.type.name, e.field, stage)
          if (known) return known
        }
      }
      return classify(m, f, env, base)
    }
    case 'call': {
      // A derivative's own result varies by invocation by construction.
      if (DERIVATIVE_INTRINSICS.has(e.fn)) {
        return { at: 'non-uniform', why: `${e.fn}(…), which differences neighbouring invocations` }
      }
      // An INTRINSIC is a pure function of its arguments, so it is as uniform as they are — and
      // a nullary one (there are none that return a value, but the arm has to be right) has
      // nothing to read, so it claims nothing. A call into a USER function is `unknown`: its
      // body can read a module `var`, a storage buffer or a builtin this walk never sees, so
      // reading the arguments alone would PROVE uniform a call that is not one, and that proof
      // is what the barrier rule rests on.
      if (!isKnownIntrinsic(e.fn) || e.args.length === 0)
        return { at: 'unknown', why: `${e.fn}(…)` }
      return joinAll(m, f, env, e.args, `${e.fn}(…)`)
    }
    case 'binop':
    case 'compare':
    case 'logical':
      return joinAll(m, f, env, [e.a, e.b], 'the expression')
    case 'unop':
      return classify(m, f, env, e.a)
    case 'construct':
      return e.args.length === 0 ? UNKNOWN : joinAll(m, f, env, e.args, 'the expression')
    case 'index':
      return joinAll(m, f, env, [e.base, e.idx], 'the expression')
    case 'select':
      return joinAll(m, f, env, [e.cond, e.ifTrue, e.ifFalse], 'the expression')
    case 'matchExpr':
      return joinAll(
        m,
        f,
        env,
        [e.scrutinee, ...e.cases.map(([, v]) => v), e.default],
        'the expression',
      )
    // A host global: nothing is claimed.
    default:
      return UNKNOWN
  }
}

function joinAll(
  m: ModuleDecl,
  f: FuncDecl,
  env: Env,
  es: readonly Expr[],
  fallback: string,
): Known {
  let out: Known = { at: 'uniform', why: fallback }
  for (const e of es) out = joinKnown(out, classify(m, f, env, e))
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
  // Where each function's body starts. An entry starts at `uniform`; a helper starts at the
  // join of the control flow at every call of it, which the rounds below compute. A helper
  // nothing calls keeps `undefined`, which reads as `unknown` and so keeps its barrier
  // refused — a function no entry reaches is emitted by nothing, and claiming it uniform
  // would be claiming something about a caller that does not exist.
  const startAt = new Map<string, Known>()
  for (const f of m.funcs) {
    if (stageOf(f) !== undefined) startAt.set(f.name, { at: 'uniform', why: 'the entry' })
  }
  const byName = new Map(m.funcs.map((f) => [f.name, f]))

  let found: UniformityViolation[] = []
  // A fixpoint over the call graph. Each round re-walks every function at the class its
  // callers reached it under; a round that changes no start class is the last. Bounded by the
  // number of functions plus one, which is the longest chain a class can travel.
  for (let round = 0; round <= m.funcs.length; round++) {
    found = []
    let changed = false
    const record = (callee: string, at: Known): void => {
      if (!byName.has(callee)) return
      const prior = startAt.get(callee)
      const next = prior === undefined ? at : joinKnown(prior, at)
      if (prior === undefined || prior.at !== next.at) {
        startAt.set(callee, next)
        changed = true
      }
    }
    for (const f of m.funcs) {
      walkFunction(m, f, startAt.get(f.name), found, record)
    }
    if (!changed) break
  }
  return found
}

function walkFunction(
  m: ModuleDecl,
  f: FuncDecl,
  start: Known | undefined,
  found: UniformityViolation[],
  record: (callee: string, at: Known) => void,
): void {
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
      const at = flow.diverged ? join(flow.at, 'non-uniform') : flow.at
      const why = flow.diverged ? flow.diverged.why : flow.why
      record(x.fn, { at, why })
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
          cur = { ...cur, env: bind(cur, s.name, classify(m, f, cur.env, s.expr)) }
          break
        case 'var':
          cur = {
            ...cur,
            env: bind(cur, s.name, s.init ? classify(m, f, cur.env, s.init) : UNKNOWN),
          }
          break
        case 'assign':
        case 'assignOp': {
          // A write under a branch is only as uniform as the branch: the invocations that did
          // not take it keep the old value, so the two differ afterwards.
          if (s.target.op === 'varref') {
            const v = classify(m, f, cur.env, s.expr)
            const under: Known = { at: cur.at, why: cur.why }
            cur = { ...cur, env: bind(cur, s.target.name, joinKnown(v, under)) }
          }
          break
        }
        case 'if': {
          let merged: Env | undefined
          let after = cur
          let armsCond: Known = { at: 'uniform', why: cur.why }
          for (const arm of s.arms) {
            const c = classify(m, f, cur.env, arm.cond)
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
            const c = classify(m, f, outer.env, s.cond)
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
          const c = classify(m, f, cur.env, s.scrut)
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

/** `env` with `name` bound, without mutating the environment a sibling branch holds. */
function bind(flow: Flow, name: string, value: Known): Env {
  const next = new Map(flow.env)
  next.set(name, value)
  return next
}
