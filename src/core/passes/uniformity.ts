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
//   • A BARRIER is accepted only when its control flow is DEFINITELY uniform. The rule it
//     replaces refused every branch outright, so `unknown` keeps that refusal and the
//     relaxation can only ever admit a condition this walk has proven uniform.
//
// So `unknown` is not a hedge: it is the value that keeps each caller on the safe side of its
// own question. What produces it is written down at each seed below.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js'
import { stageOf } from '../ir/nodes.js'
import { eachStmtExpr } from '../ir/visit.js'
import { DERIVATIVE_INTRINSICS, isBarrierIntrinsic } from '../intrinsics.js'
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

/** Join along control flow: two values that meet are uniform only if both were, and non-uniform
 *  as soon as either is — an invocation taking the other path already makes them differ. */
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
  /** `'derivative'` when the call needs uniform control flow for its implicit LOD,
   *  `'barrier'` when it needs it so the workgroup can rejoin. */
  readonly kind: 'derivative' | 'barrier'
  /** What made the control flow non-uniform, as a phrase a message can carry:
   *  `"uv" (a fragment input)`. */
  readonly cause: string
  /** Where the call was authored, when the IR carries it. */
  readonly span?: SourceSpan
}

/** A name the walk can say something about, with the phrase a diagnostic uses for it. */
interface Known {
  readonly at: Uniformity
  readonly why: string
}

/** How an entry parameter varies, and the phrase that names it. A struct parameter is read
 *  field by field: the struct itself is whatever its fields are, so the base is `unknown` and a
 *  `member` read below resolves to the field's own answer. */
function paramUniformity(
  m: ModuleDecl,
  f: FuncDecl,
  p: FuncDecl['params'][number],
): Known | undefined {
  if (stageOf(f) === undefined) return undefined
  if (p.builtin !== undefined) {
    return UNIFORM_BUILTINS.has(p.builtin)
      ? { at: 'uniform', why: `"${p.name}" (@builtin(${p.builtin}), uniform across the group)` }
      : { at: 'non-uniform', why: `"${p.name}" (@builtin(${p.builtin}))` }
  }
  if (p.location !== undefined) {
    return {
      at: 'non-uniform',
      why: `"${p.name}" (a ${stageOf(f)} input at @location(${String(p.location)}))`,
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

/** Every local name in `f`, classified by the JOIN of its initialiser and every assignment to
 *  it. Order-insensitive, so a `var` written inside a loop needs no fixpoint: joining all of
 *  its writes is already the answer any of them could reach. A name whose writes this walk
 *  cannot classify lands on `unknown`, which is what both callers want for it. */
function localEnv(m: ModuleDecl, f: FuncDecl): Map<string, Known> {
  const env = new Map<string, Known>()
  // Two passes: the first seeds every name at `uniform` so a read inside a later expression
  // resolves, the second joins the writes. A name read before this walk has classified it is
  // read as `unknown` (below), never as something stronger.
  const writes: { name: string; expr: Expr }[] = []
  const collect = (s: Stmt): void => {
    if (s.s === 'let' || (s.s === 'var' && s.init !== undefined)) {
      writes.push({ name: s.name, expr: s.s === 'let' ? s.expr : s.init! })
    } else if ((s.s === 'assign' || s.s === 'assignOp') && s.target.op === 'varref') {
      writes.push({ name: s.target.name, expr: s.expr })
    }
    eachStmtExpr(s, () => undefined, collect)
  }
  for (const s of f.body) collect(s)
  // A write whose value mentions a name written later is resolved on a second sweep, which is
  // enough for the straight-line shapes an author writes; a cycle settles at `unknown`.
  for (let round = 0; round < 2; round++) {
    for (const w of writes) {
      const at = classify(m, f, env, w.expr)
      const prev = env.get(w.name)
      env.set(w.name, {
        at: prev === undefined ? at.at : join(prev.at, at.at),
        why: at.at === 'non-uniform' ? `"${w.name}", which comes from ${at.why}` : `"${w.name}"`,
      })
    }
  }
  return env
}

/** How one expression varies. */
function classify(m: ModuleDecl, f: FuncDecl, env: Map<string, Known>, e: Expr): Known {
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
      // so it stays `unknown` rather than claiming either answer.
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
      // A derivative's own result varies by invocation by construction. Every other call is
      // as uniform as its arguments — including a call into a helper, whose body this walk
      // does not enter; an argument-only answer can only be weaker than the truth, never
      // stronger, because a helper can introduce non-uniformity but cannot remove it.
      if (DERIVATIVE_INTRINSICS.has(e.fn)) {
        return { at: 'non-uniform', why: `${e.fn}(…), which differences neighbouring invocations` }
      }
      return joinAll(m, f, env, e.args, `${e.fn}(…)`)
    }
    case 'binop':
    case 'compare':
    case 'logical':
      return joinAll(m, f, env, [e.a, e.b], 'the expression')
    case 'unop':
      return classify(m, f, env, e.a)
    case 'construct':
      return joinAll(m, f, env, e.args, 'the expression')
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
    // A texture read, a host global: nothing is claimed.
    default:
      return { at: 'unknown', why: 'the expression' }
  }
}

function joinAll(
  m: ModuleDecl,
  f: FuncDecl,
  env: Map<string, Known>,
  es: readonly Expr[],
  fallback: string,
): Known {
  let at: Uniformity = 'uniform'
  let why = fallback
  for (const e of es) {
    const k = classify(m, f, env, e)
    // The first thing that makes it vary is the one the message names: it is the value the
    // author would change, and naming the last would point past it.
    if (k.at === 'non-uniform' && at !== 'non-uniform') why = k.why
    at = join(at, k.at)
  }
  return { at, why }
}

/** Every derivative and barrier call in `m` whose control flow this walk has an answer about.
 *
 *  A `derivative` violation is reported only when the enclosing conditions are DEFINITELY
 *  non-uniform; a `barrier` one whenever they are not definitely uniform. See the header for
 *  why the two thresholds differ. */
export function uniformityViolations(m: ModuleDecl): UniformityViolation[] {
  const found: UniformityViolation[] = []
  for (const f of m.funcs) {
    const env = localEnv(m, f)
    const walk = (stmts: readonly Stmt[], at: Uniformity, why: string): void => {
      for (const s of stmts) {
        // Every Expr this statement holds, checked for a call under the control flow it is in.
        eachStmtExpr(
          s,
          (e) => checkExpr(e, at, why),
          () => undefined,
        )
        switch (s.s) {
          case 'if': {
            for (const arm of s.arms) {
              const c = classify(m, f, env, arm.cond)
              walk(arm.body, join(at, c.at), c.at === 'non-uniform' ? c.why : why)
            }
            // The `else` runs under the negation of every arm's condition, so it is exactly as
            // uniform as the arms are.
            if (s.elseBody) {
              let c: Known = { at: 'uniform', why }
              for (const arm of s.arms) {
                const k = classify(m, f, env, arm.cond)
                if (k.at === 'non-uniform' && c.at !== 'non-uniform') c = k
                else c = { at: join(c.at, k.at), why: c.why }
              }
              walk(s.elseBody, join(at, c.at), c.at === 'non-uniform' ? c.why : why)
            }
            break
          }
          case 'switch': {
            const c = classify(m, f, env, s.scrut)
            const inner = join(at, c.at)
            const w = c.at === 'non-uniform' ? c.why : why
            for (const cse of s.cases) walk(cse.body, inner, w)
            if (s.defaultBody) walk(s.defaultBody, inner, w)
            break
          }
          case 'for': {
            // A loop body runs under its condition. §17's constant bound makes that uniform,
            // which is the shape a reduction with a barrier in it needs.
            const c = classify(m, f, env, s.cond)
            walk(s.body, join(at, c.at), c.at === 'non-uniform' ? c.why : why)
            break
          }
          default:
            break
        }
      }
    }
    const checkExpr = (e: Expr, at: Uniformity, why: string): void => {
      if (e.op === 'call') {
        if (DERIVATIVE_INTRINSICS.has(e.fn) && at === 'non-uniform') {
          found.push({ fn: f.name, callee: e.fn, kind: 'derivative', cause: why, span: e.span })
        } else if (isBarrierIntrinsic(e.fn) && at !== 'uniform') {
          found.push({
            fn: f.name,
            callee: e.fn,
            kind: 'barrier',
            cause: at === 'non-uniform' ? why : `${why}, which this compiler cannot prove uniform`,
            span: e.span,
          })
        }
      }
      for (const c of childExprs(e)) checkExpr(c, at, why)
    }
    walk(f.body, 'uniform', 'the enclosing condition')
  }
  return found
}

/** The direct children of an Expr. `mapChildren` rebuilds and `eachExpr` walks with no payload;
 *  this walk carries a control-flow class down, so it needs the children alone. */
function childExprs(e: Expr): readonly Expr[] {
  switch (e.op) {
    case 'binop':
    case 'compare':
    case 'logical':
      return [e.a, e.b]
    case 'unop':
      return [e.a]
    case 'call':
    case 'construct':
      return e.args
    case 'member':
      return [e.base]
    case 'index':
      return [e.base, e.idx]
    case 'select':
      return [e.cond, e.ifTrue, e.ifFalse]
    case 'matchExpr':
      return [e.scrutinee, ...e.cases.map(([, v]) => v), e.default]
    default:
      return []
  }
}
