// ═══ Shader DSL — the neutral emit walk ═══
//
// ONE tree-walk over Expr / Stmt, shared by every backend. It is target-neutral:
// the only target-specific decisions are delegated to the Backend (type/literal/
// intrinsic spelling + the handful of divergent statement/declaration fragments
// in `backend.ts`). Backends provide those fragments; they do NOT re-implement
// the control-flow walk (no duplicated if/for/switch/return logic that can drift).

import { UnsupportedFeatureError, type Backend } from './backend.js'
import type { Expr, Stmt, ModuleDecl, ShaderType, FuncDecl } from './ir/index.js'
import { stageOf } from './ir/index.js'
import { eachExpr, eachStmtExpr } from './ir/visit.js'
import { fragmentRequires, type EmitFragment } from './fragment.js'
import { intrinsicNeedsAtomArgs } from './intrinsics.js'
import { validate } from './passes/validate.js'
import { assertCaps, assertBuiltins } from './passes/required-caps.js'
import { lowerModule } from './passes/match-lower.js'
import { selectComposite } from './passes/select-composite.js'
import { fp64Lower, type Fp64Flavor } from './passes/fp64-lower.js'
import { autoVars, optimizeAt, type OptLevel } from './passes/opt/index.js'
import { mapExpr, mapStmt } from './passes/opt/ir-transform.js'
import { reflect, type Reflection } from './reflect.js'

const pad = (depth: number): string => '  '.repeat(depth)

/** How much parenthesis an expression carries.
 *  - `'full'` (default) — every binop/unop/compare/logical is wrapped, no
 *    precedence assumed. The historical emit, byte-for-byte.
 *  - `'minimal'` — parens are omitted where operator precedence already implies
 *    the same parse. Build-time, opt-in: it changes the emitted bytes (and so
 *    every committed golden / baked artifact), never the parse tree. */
export type ParenMode = 'full' | 'minimal'

// Precedence used by 'minimal'. DELIBERATELY the INTERSECTION of what WGSL and
// GLSL ES 3.00 both define the same way — multiplicative over additive, unary
// over both. Everything else is 0, meaning "always parenthesize": WGSL does not
// give `&`/`|`/`^`, the shifts, the relational ops or `&&`/`||` a chaining
// precedence at all (mixing them without parens is a compile ERROR there, not a
// precedence question), so a table that ranked them would be inventing a rule
// one of the two targets does not have.
const PREC_UNARY = 4
const PREC_ATOM = 5
const precOf = (bop: string): number =>
  bop === '*' || bop === '/' || bop === '%' ? 3 : bop === '+' || bop === '-' ? 2 : 0

export function emitExpr(
  e: Expr,
  be: Backend,
  parens: ParenMode = 'full',
  need: 0 | typeof PREC_ATOM = 0,
): string {
  // `need` is the lowest precedence this POSITION accepts unparenthesized.
  // A binop's LEFT child accepts its own precedence (left-associative, so
  // `a-b-c` re-parses identically); its RIGHT child demands strictly more, which
  // is what keeps `a-(b-c)` and `a+(b+c)` parenthesized — reassociating those is
  // a different float result, not a spelling change.
  const go = (x: Expr, need: number): string => {
    const wrap = (s: string, prec: number): string => (prec < need ? `(${s})` : s)
    const full = parens === 'full'
    const r = (y: Expr) => go(y, full ? 0 : 1)
    switch (x.op) {
      case 'binop': {
        // Float `%` for a target whose native `%` is integer-only (GLSL ES 3.00):
        // delegate to the backend's trunc-mod spelling. Operands are forced to
        // ATOM precedence — the composed expression repeats them inside a `/`,
        // where a minimally-parenthesized `a + b` would re-associate.
        if (
          x.bop === '%' &&
          be.floatMod !== undefined &&
          ((x.a.type.kind === 'scalar' && x.a.type.scalar === 'f32') ||
            (x.a.type.kind === 'vec' && x.a.type.elem === 'f32'))
        ) {
          return be.floatMod(go(x.a, PREC_ATOM), go(x.b, PREC_ATOM))
        }
        if (full) return `(${r(x.a)} ${x.bop} ${r(x.b)})`
        const p = precOf(x.bop)
        if (p === 0) return `(${r(x.a)} ${x.bop} ${r(x.b)})`
        return wrap(`${go(x.a, p)} ${x.bop} ${go(x.b, p + 1)}`, p)
      }
      case 'unop': {
        // `-` binds tighter than any binary operator, so the operand must be an
        // ATOM to lose its parens: `-(a*b)` is not `-a*b`, and `-(-a)` would
        // spell `--a`, which is a decrement in GLSL. The same `--` hazard hides in
        // a NEGATIVE LITERAL operand — a leaf never wraps, so `-(lit -1.0)` printed
        // `--1.0` (X-GIS #2276) — hence any operand whose spelling already starts with
        // `-` is parenthesized, in both modes and on both targets.
        const inner = full ? r(x.a) : go(x.a, PREC_ATOM)
        const operand = inner.startsWith('-') ? `(${inner})` : inner
        return full ? `(-${operand})` : wrap(`-${operand}`, PREC_UNARY)
      }
      case 'compare':
        // Two vectors compare componentwise into a vector of bools; a target without an
        // operator form for that (GLSL ES 3.00) spells it through `vectorCompare`.
        if (x.a.type.kind === 'vec' && be.vectorCompare !== undefined) {
          return be.vectorCompare(x.cop, r(x.a), r(x.b))
        }
        return `(${r(x.a)} ${x.cop} ${r(x.b)})`
      case 'logical':
        return `(${r(x.a)} ${x.lop} ${r(x.b)})`
      default:
        // Leaves never wrap — every one of them already spells as a single
        // postfix/primary term. They still choose their CHILDREN's positions:
        // an argument sits inside `(…)` or after a `,`, so it accepts anything
        // (`need` 1), while a `.field` / `[i]` BASE must be a primary — the
        // corpus really does contain `((h*h)*(i-(h*2.))).y`, and `a*b.y` is a
        // different expression. The one argument position that is NOT loose is an
        // intrinsic whose SPELLING re-embeds the argument (X-GIS #2350) — see `call` below.
        return emitLeaf(
          x,
          be,
          (y) => r(y),
          (y) => go(y, full ? 0 : PREC_ATOM),
        )
    }
  }
  return go(e, need)
}

/** Render `e` as a primary, parenthesized unless it already is one, for a template that
 *  re-embeds it in a position tighter than an argument slot (the operands of the backend's
 *  float `%` spelling, which repeats them inside a `/`). */
export function emitAtom(e: Expr, be: Backend, parens: ParenMode = 'full'): string {
  return emitExpr(e, be, parens, PREC_ATOM)
}

const isF32Typed = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32')

/** `t op= e`, or `t = floatMod(t, e)` for a float `%=` on a target whose native `%` takes
 *  integers only (GLSL ES 3.00, issue #20). The binop walk already routes a float `%` through
 *  `floatMod`; the two compound-assignment sites, here and in the `for` header, bypassed it
 *  and emitted `x %= 0.7;`, which the driver rejects while the WGSL beside it is fine. */
function assignOpText(
  s: Extract<Stmt, { readonly s: 'assignOp' }>,
  be: Backend,
  parens: ParenMode,
): string {
  const r = (x: Expr) => emitExpr(x, be, parens)
  if (s.bop === '%' && be.floatMod !== undefined && isF32Typed(s.target.type)) {
    return `${r(s.target)} = ${be.floatMod(emitAtom(s.target, be, parens), emitAtom(s.expr, be, parens))}`
  }
  return `${r(s.target)} ${s.bop}= ${r(s.expr)}`
}

/** The non-operator half of the walk. `arg` renders a child in a position that
 *  accepts any operator; `base` one that demands a primary. */
function emitLeaf(
  e: Exclude<Expr, { op: 'binop' | 'unop' | 'compare' | 'logical' }>,
  be: Backend,
  r: (x: Expr) => string,
  base: (x: Expr) => string,
): string {
  switch (e.op) {
    case 'lit':
      return be.literal(e.value, e.type)
    case 'constref':
    case 'overrideref':
    case 'externref':
    case 'param':
    case 'varref':
      // `overrideref` (X-GIS #923) emits as the bare name on BOTH backends — the WGSL
      // `override` identifier and the GLSL `#define` macro share the declared name.
      // `externref` (X-GIS #1713) likewise: its per-target spelling was already resolved into
      // `.name` by `spellExterns` during lowering, so the walk stays target-neutral.
      //
      // A parameter this target spells as a pointer is the one name that is not itself: the
      // body wrote `self_.pos`, and WGSL reads that through `(*self_).pos`. GLSL's `inout`
      // needs no such thing, and its backend declares no `dereference`, so the set is empty
      // there and this is the bare name on both targets as before.
      return pointerParams.has(e.name) && be.dereference !== undefined
        ? be.dereference(e.name)
        : e.name
    case 'call': {
      // JavaScript Console API calls are host/debug effects. They intentionally have no target
      // source spelling yet: the GPU transport will instrument these same IR calls, while the
      // CPU/debug backend delivers them to ConsoleSink. Keeping a comment here preserves valid
      // WGSL/GLSL output without inventing a shader-side console API.
      if (e.fn.startsWith('console.')) return `/* typeshade ${e.fn} */`
      // A registry spelling that splices an argument into a tighter position — `mod`'s
      // `/` operand, `pack4x8unorm`'s `.x` base — needs it as a PRIMARY: at the loose
      // argument precedence a minimally-parenthesized `a + b` re-associates inside the
      // template, changing the parse (X-GIS #2350). The registry declares which entries do
      // that; `base` is the same ATOM rendering `.field` / `[i]` already demand, and
      // under 'full' both renderers are identical, so no emitted bytes move there.
      //
      // A module that declares its own `saturate` must CALL it. The backends rewrite an
      // intrinsic they have no native spelling for — GLSL renders `saturate(x)` as
      // `clamp(x, 0.0, 1.0)`, and `fma`, `dpdx` and `dpdy` likewise — and that rewrite keys
      // on the NAME, so such a module emitted the user's function into the GLSL and then
      // never called it: `saturate(2.)` answered with the user's arithmetic on WGSL and
      // with `clamp(2.0, 0.0, 1.0)` on GLSL, from one module, with no diagnostic. The front
      // end and both CPU backends already route the call to the declaration; this walk was
      // the last place keyed on the name alone.
      //
      // Keyed on the module's declared NAMES, not on `call.declRef`: that field is
      // documented as never read by the emit path and freely dropped by pass rewrites, so a
      // rewrite that dropped it would silently flip the emit back. A name survives every
      // pass, since a pass that removed the declaration would remove the call with it.
      const rendered = e.args.map(intrinsicNeedsAtomArgs(e.fn) ? base : r)
      // An argument the callee writes through is passed by reference on a target that spells
      // the parameter as a pointer (WGSL `&x`); on one that spells it as a qualifier the
      // argument is the l-value as written, which is what GLSL's `inout` takes.
      const callee = declaredByName.get(e.fn)
      const args =
        callee === undefined || be.reference === undefined
          ? rendered
          : rendered.map((text, i) => {
              if (callee.params[i]?.mode !== 'inout') return text
              const arg = e.args[i]!
              // A pointer this function already holds is passed straight on. Taking its
              // address again would be `&(*self_)`, which WGSL accepts and no one writes.
              if ((arg.op === 'varref' || arg.op === 'param') && pointerParams.has(arg.name)) {
                return arg.name
              }
              return be.reference!(base(arg))
            })
      return declaredFns.has(e.fn) ? `${e.fn}(${args.join(', ')})` : be.intrinsic(e.fn, args)
    }
    case 'member':
      return `${base(e.base)}.${e.field}`
    case 'construct':
      return `${be.typeName(e.type)}(${e.args.map(r).join(', ')})`
    // select(false, true, cond) — the writer owns the spelling (WGSL select() vs
    // GLSL ternary). Args passed in WGSL's (false, true, cond) order.
    case 'select':
      // A vector-of-bools condition picks per component; a target whose select is a ternary
      // (GLSL ES 3.00) spells that through `vectorSelect`.
      if (e.cond.type.kind === 'vec' && be.vectorSelect !== undefined) {
        return be.vectorSelect(r(e.ifFalse), r(e.ifTrue), r(e.cond), e.type)
      }
      return be.intrinsic('select', [r(e.ifFalse), r(e.ifTrue), r(e.cond)])
    case 'index':
      return `${base(e.base)}[${r(e.idx)}]`
    // matchExpr is consumed by the neutral pre-emit pass (passes/match-lower.ts)
    // before emit. If one leaks through, that pass was bypassed — fail loudly.
    case 'matchExpr':
      throw new Error(
        'typeshade: matchExpr Expr leaked into emitExpr — lowerModule should have hoisted it',
      )
  }
}

export function emitStmt(s: Stmt, depth: number, be: Backend, parens: ParenMode = 'full'): string {
  const p = pad(depth)
  const r = (x: Expr) => emitExpr(x, be, parens)
  switch (s.s) {
    case 'let':
      return `${p}${be.localLet(s.name, s.expr.type, r(s.expr))};`
    case 'var':
      return `${p}${be.localVar(s.name, s.type, s.init !== undefined ? r(s.init) : undefined)};`
    case 'assign':
      return `${p}${r(s.target)} = ${r(s.expr)};`
    case 'assignOp':
      return `${p}${assignOpText(s, be, parens)};`
    case 'return':
      return s.expr !== undefined ? `${p}return ${r(s.expr)};` : `${p}return;`
    case 'break':
      return `${p}break;`
    case 'continue':
      return `${p}continue;`
    case 'discard':
      return `${p}discard;`
    case 'call': {
      // A user function's dropped result is bare on both targets. A value-returning builtin,
      // and a value a pass folded the call into, take the backend's phony assignment where it
      // has one: WGSL rejects `max(a, b);` as ignoring a `@must_use` result (issue #47).
      const userFn = s.expr.op === 'call' && declaredFns.has(s.expr.fn)
      const drop = s.expr.type.kind !== 'void' && !userFn ? (be.phonyAssign ?? '') : ''
      return `${p}${drop}${r(s.expr)};`
    }
    case 'if': {
      const lines: string[] = []
      s.arms.forEach((arm, i) => {
        lines.push(`${i === 0 ? `${p}if` : `${p}} else if`} (${r(arm.cond)}) {`)
        lines.push(emitBody(arm.body, depth + 1, be, parens))
      })
      if (s.elseBody) {
        lines.push(`${p}} else {`)
        lines.push(emitBody(s.elseBody, depth + 1, be, parens))
      }
      lines.push(`${p}}`)
      return lines.filter((l) => l.length > 0).join('\n')
    }
    case 'for': {
      const init = forHeader(s.init, be, parens)
      const update = forHeader(s.update, be, parens)
      return `${p}for (${init}; ${r(s.cond)}; ${update}) {\n${emitBody(s.body, depth + 1, be, parens)}\n${p}}`
    }
    case 'placeholder':
      return `${p}${be.placeholderStmt(s.tag)}`
    case 'raw':
      return `${p}${be.rawStmt(s)}`
    case 'switch': {
      const lines: string[] = [`${p}${be.switchHead(r(s.scrut))}`]
      for (const c of s.cases) {
        // A clause may carry SEVERAL selectors, and the two targets spell that differently:
        // WGSL joins them into one label list (`case 0, 1:`), GLSL ES 3.00 stacks empty
        // labels (`case 0: case 1:`). `caseLabels` is the backend's spelling of the whole
        // `case …:` prefix; a backend that declares none gets WGSL's form, which is also the
        // single-selector spelling every backend used before.
        const labels = c.values.map((v) => be.caseLabel(v, s.scrut.type))
        const prefix = be.caseLabels?.(labels) ?? `case ${labels.join(', ')}:`
        lines.push(`${pad(depth + 1)}${prefix} {`)
        lines.push(emitBody(c.body, depth + 2, be, parens))
        // C-style backends (GLSL) fall through without a terminator — append the
        // backend's case break unless the body already ends in return/discard (which
        // would make the break unreachable). WGSL has no caseBreak (no fallthrough).
        const last = c.body[c.body.length - 1]
        if (be.caseBreak && !(last && (last.s === 'return' || last.s === 'discard'))) {
          lines.push(`${pad(depth + 2)}${be.caseBreak}`)
        }
        lines.push(`${pad(depth + 1)}}`)
      }
      lines.push(`${pad(depth + 1)}default: {`)
      if (s.defaultBody) lines.push(emitBody(s.defaultBody, depth + 2, be, parens))
      lines.push(`${pad(depth + 1)}}`)
      lines.push(`${p}}`)
      return lines.join('\n')
    }
  }
}

export function emitBody(
  body: readonly Stmt[],
  depth: number,
  be: Backend,
  parens: ParenMode = 'full',
): string {
  return body.map((s) => emitStmt(s, depth, be, parens)).join('\n')
}

// For-loop header init/update: a var/assign WITHOUT trailing `;` or indentation.
export function forHeader(s: Stmt, be: Backend, parens: ParenMode = 'full'): string {
  const r = (x: Expr) => emitExpr(x, be, parens)
  if (s.s === 'var')
    return s.init !== undefined
      ? be.localVar(s.name, s.type, r(s.init))
      : be.localVar(s.name, s.type)
  if (s.s === 'assign') return `${r(s.target)} = ${r(s.expr)}`
  if (s.s === 'assignOp') return assignOpText(s, be, parens)
  throw new Error(`typeshade: bad for-header stmt ${s.s}`)
}

// ── Module-level emit (shared driver) ──
// The module assembly pipeline, parameterised by the Backend, lives here ONCE so a
// new backend does not copy it. Per-target spelling (const/struct/binding/func) and
// the emit-time optimisation (`optimize` — the full fixpoint pipeline on both current
// backends, X-GIS #763 H1) are delegated to the Backend; the validate → assertCaps →
// autoVars → lowerModule → optimize preamble is identical for every target.

/** Run the authored module through the shared pre-emit pipeline for a backend:
 *  validate the AUTHORED shape, fail-closed on unsupported caps, then
 *  `optimize(lowerModule(autoVars(m)))`. Returns the lowered module ready for
 *  per-declaration spelling. (autoVars BEFORE lowerModule — var materialisation is
 *  backend-neutral; cse runs only inside the WGSL backend's `optimize`.) */
export function lowerForBackend(
  m: ModuleDecl,
  be: Backend,
  level?: OptLevel,
  fp64Flavor?: Fp64Flavor,
  onStage?: StageSink,
): ModuleDecl {
  // Profiling (X-GIS #2449) times the stages HERE rather than in a parallel copy of this list,
  // because a profiler that re-derives the pipeline measures whatever it drifted into. The
  // production path passes no sink and takes the untimed branch below.
  if (onStage !== undefined) return lowerTimed(m, be, level, fp64Flavor, onStage)
  // Validate the AUTHORED module before any lowering (the rules reason about the
  // pre-lower shape — e.g. matchExpr chains, placeholder swap sites).
  validate(m)
  assertCaps(be, m) // principled fail-closed gate
  assertBuiltins(be, m) // …and its builtin-vocabulary twin (X-GIS #1672)
  // matchExpr→{var slot, Stmt.switch} lowering first so the rest of the emitter stays
  // matchExpr-unaware (identity for modules with no matchExpr); fp64Lower then rewrites
  // every f64 into vec2<f32> + df64_* calls (identity for modules with no f64) — HERE,
  // before the optimizer, so every backend lowers identically and the optimizer only
  // sees ordinary vec2/f32 IR plus opaque df64_* calls. Auto-cache (cse, in the
  // WGSL backend's optimize) then hoists any input-only subexpression reused ≥2x into one
  // shared `let`, so authors write plain inline expressions and the reuse is bound for them.
  // `level` overrides the backend's default optimizer tier (used by the measurement A/B and
  // debug emit); omitted → the backend's own `optimize` (= O2 fixpoint), the production path.
  // A conditional on a struct or a fixed-length array has no operator on EITHER target, so the
  // rewrite into a helper function is neutral and runs here rather than in a backend (#113).
  const pre = spellExterns(
    selectComposite(
      fp64Lower(lowerModule(autoVars(m)), fp64Flavor ? { flavor: fp64Flavor } : undefined),
    ),
    be,
  )
  const optimized = level === undefined ? be.optimize(pre) : optimizeAt(pre, level)
  // After every tier, so a target whose spelling needs a shape the IR does not carry gets it
  // whichever optimizer ran. Identity for a backend that declares none.
  return be.postLower === undefined ? optimized : be.postLower(optimized)
}

/** Called once per pre-emit stage when profiling (X-GIS #2449). */
export type StageSink = (stage: string, ms: number) => void

/** `performance.now()` where it exists, else a coarser fallback — the package declares no
 *  ambient lib types, so this reads through globalThis. */
const nowMs = (): number => {
  const perf = (globalThis as { performance?: { now(): number } }).performance
  return perf ? perf.now() : Date.now()
}

/** `lowerForBackend`'s body with a stopwatch around each stage. It must stay step-for-step
 *  identical to the branch above — `profileEmit` asserts the two produce `irEqual` modules,
 *  so a stage added to one and not the other fails a test rather than silently mis-attributing
 *  the time. */
function lowerTimed(
  m: ModuleDecl,
  be: Backend,
  level: OptLevel | undefined,
  fp64Flavor: Fp64Flavor | undefined,
  onStage: StageSink,
): ModuleDecl {
  const step = <T>(name: string, run: () => T): T => {
    const t0 = nowMs()
    const out = run()
    onStage(name, nowMs() - t0)
    return out
  }
  step('validate', () => validate(m))
  step('assertCaps', () => assertCaps(be, m))
  step('assertBuiltins', () => assertBuiltins(be, m))
  const av = step('autoVars', () => autoVars(m))
  const lm = step('lowerModule', () => lowerModule(av))
  const f64 = step('fp64Lower', () =>
    fp64Lower(lm, fp64Flavor ? { flavor: fp64Flavor } : undefined),
  )
  const pre = step('spellExterns', () => spellExterns(f64, be))
  return step('optimize', () => (level === undefined ? be.optimize(pre) : optimizeAt(pre, level)))
}

/** Resolve each `externref` to the spelling THIS target's host uses (X-GIS #1713).
 *
 *  Done as a lowering pass rather than in `emitLeaf` because the spelling lives on the
 *  DECLARATION and the emit walk only ever sees the Expr — threading the module through
 *  the walk to look it up would widen the neutral emitter's contract for one node kind.
 *  Identity for every module with no externs, and for every extern whose host spells it
 *  the same on both targets, so nothing else changes bytes. */
function spellExterns(m: ModuleDecl, be: Backend): ModuleDecl {
  const map = new Map<string, string>()
  for (const e of m.externs ?? []) {
    const to = be.id === 'wgsl' ? e.spelling?.wgsl : e.spelling?.glsl
    if (to !== undefined && to !== e.name) map.set(e.name, to)
  }
  if (map.size === 0) return m
  const rE = (e: Expr): Expr =>
    mapExpr(e, (x) =>
      x.op === 'externref' && map.has(x.name) ? { ...x, name: map.get(x.name)! } : x,
    )
  return { ...m, funcs: m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmt(s, rE)) })) }
}

/** Assemble an ALREADY-lowered module into a target string: the declaration assembly
 *  (consts → structs → bindings → funcs, only non-empty sections), joined `\n\n` with a
 *  trailing newline. Split out of `emitModule` so the string and the reflection can be
 *  derived from the SAME lowered module (see `emitModuleWithReflection`). */
let declaredFns: ReadonlySet<string> = new Set()

/** The module's own function names that a call in it actually RESOLVES to — a declared name
 *  reached by at least one `call` carrying a `declRef` to a declaration of that name.
 *
 *  Not every declared name: an intrinsic id the front end keeps as an intrinsic must stay one.
 *  `inverseSqrt` and `atan2` are spellings a declaration does NOT win (the language's
 *  precedence rule keeps the names that were builtins first), so a module declaring
 *  `inverseSqrt` resolves `inverseSqrt(p.x)` to the intrinsic and the call carries no
 *  `declRef`. Keyed on the name alone, emit called the user's function instead: the GLSL went
 *  from `inversesqrt(p.x)` to `inverseSqrt(p.x)` while the CPU oracle still computed the
 *  intrinsic — one module, three answers.
 *
 *  Not `declRef` per call either. That field is documented as never read by the emit path and
 *  is freely dropped by pass rewrites, so a rewrite that dropped it on one call would flip that
 *  call's emit while its twin two lines up kept it. Taking the NAMES some call resolves to
 *  keeps the decision per module: a pass that drops `declRef` everywhere falls back to the
 *  intrinsic (which is what emit did before this existed), and one that drops it here and there
 *  cannot split a module's answer in two. */
function resolvedOwnFns(lowered: ModuleDecl): ReadonlySet<string> {
  const declared = new Set(lowered.funcs.map((f) => f.name))
  if (declared.size === 0) return declared
  const resolved = new Set<string>()
  for (const f of lowered.funcs) {
    for (const s of f.body) {
      eachStmtExpr(s, (e: Expr) => {
        eachExpr(e, (x: Expr) => {
          if (x.op === 'call' && x.declRef !== undefined && declared.has(x.fn)) resolved.add(x.fn)
        })
      })
    }
  }
  return resolved
}

/** Run `emit` with the module's own function names in scope, so a call to one of them is
 *  rendered as a call rather than as the intrinsic of that name.
 *
 *  Scoped state rather than a parameter, and the reason is structural: the rewrite has to be
 *  visible inside `Backend.emitFunc`, which each backend implements by calling `emitBody`
 *  with its own singleton — `glsl.ts` does it in three places — so a wrapped backend object
 *  is discarded one level in and a threaded argument would have to reach through every
 *  backend's function signature. Emit is synchronous and single-threaded, and the restore is
 *  in a `finally`, so the window cannot leak into an unrelated emit. If this is the wrong
 *  trade, the alternative is widening `emitBody`/`emitExpr`/`emitFunc` to carry the set. */
export function withDeclaredFns<T>(lowered: ModuleDecl, emit: () => T): T {
  const previous = declaredFns
  const previousDecls = declaredByName
  declaredFns = resolvedOwnFns(lowered)
  declaredByName = new Map(lowered.funcs.map((f) => [f.name, f]))
  try {
    return emit()
  } finally {
    declaredFns = previous
    declaredByName = previousDecls
  }
}

/** The declarations behind {@link withDeclaredFns}'s names, so a call can be rendered against
 *  its callee's parameter modes: an argument for an `inout` parameter is passed by reference on
 *  a target that spells the parameter as a pointer. Same scoping, same reason. */
let declaredByName: ReadonlyMap<string, FuncDecl> = new Map()

/** The parameters of the function being emitted that the target spells as a POINTER, so a read
 *  of one inside the body is dereferenced. Empty for every backend that spells an `inout`
 *  parameter as a qualifier, and for every function that has none.
 *
 *  Scoped the same way and for the same reason as {@link withDeclaredFns}: the set has to be
 *  visible inside the shared expression walk, which each backend reaches through its own
 *  `emitFunc`. */
let pointerParams: ReadonlySet<string> = new Set()

/** Run `emit` with `f`'s pointer-spelled parameters in scope. A backend calls this from its
 *  `emitFunc` around the body, and one that spells `inout` as a qualifier need not call it at
 *  all: with no {@link Backend.dereference} the set is never consulted. */
export function withPointerParams<T>(be: Backend, f: FuncDecl, emit: () => T): T {
  const previous = pointerParams
  pointerParams =
    be.dereference === undefined
      ? new Set()
      : new Set(f.params.filter((p) => p.mode === 'inout').map((p) => p.name))
  try {
    return emit()
  } finally {
    pointerParams = previous
  }
}

function assembleLowered(lowered: ModuleDecl, be: Backend, parens: ParenMode = 'full'): string {
  return withDeclaredFns(lowered, () => assembleParts(lowered, be, parens))
}

function assembleParts(lowered: ModuleDecl, be: Backend, parens: ParenMode = 'full'): string {
  const parts: string[] = []

  // X-GIS #923 — specialization-constant declarations lead the module (WGSL `override`
  // lines): they are module-scope constants a later const/fn may reference. Skipped
  // when the module declares none, so override-free emit stays byte-identical.
  if (lowered.overrides?.length && be.emitOverride)
    parts.push(lowered.overrides.map((o) => be.emitOverride!(o)).join('\n'))
  if (lowered.consts.length) parts.push(lowered.consts.map((c) => be.emitConst(c)).join('\n'))
  if (lowered.structs.length) parts.push(lowered.structs.map((s) => be.emitStruct(s)).join('\n\n'))
  // Module variables (roadmap 0.2 item 5) sit between the structs they may be typed by and
  // the bindings; a backend with no spelling for one fails closed rather than dropping it.
  if (lowered.vars?.length) {
    if (!be.emitModuleVar)
      throw new UnsupportedFeatureError(
        `backend '${be.id}' has no module-scope variables (var<workgroup>, var<private>)`,
      )
    parts.push(lowered.vars.map((v) => be.emitModuleVar!(v)).join('\n'))
  }
  if (lowered.bindings.length) parts.push(lowered.bindings.map((b) => be.emitBinding(b)).join('\n'))
  if (lowered.funcs.length)
    parts.push(lowered.funcs.map((f) => be.emitFunc(f, parens)).join('\n\n'))
  return parts.join('\n\n') + '\n'
}

/** A transform that runs inside module emit. Plugins are passed to `emitModule` and
 *  `emitGlslModule` through {@link EmitOptions} as `{ plugins: [...] }`. The core emit knows
 *  nothing about what a plugin does. The plugins shipped with the package (`mangle`, `minify`,
 *  `prune`, `obfuscate` and others) live on the `typeshade/emit-prod` subpath, so an
 *  application that emits at runtime and never imports them does not bundle them.
 *
 *  A plugin has two hooks, both optional. `transformIR` receives the module after every
 *  lowering and optimisation pass has run, and returns a module the backend can spell into
 *  source text. `transformText` receives the assembled source string and returns the string
 *  to use in its place.
 *
 *  The hooks fire in stages across all plugins: every plugin's `transformIR` runs, in `plugins`
 *  order, before the module is assembled; then every plugin's `transformText` runs, in
 *  `plugins` order, on the assembled string.
 *
 *  @example
 *  ```ts
 *  const banner: EmitPlugin = {
 *    name: 'banner',
 *    transformText: (code) => `// generated\n${code}`,
 *  }
 *  const wgsl = emitModule(MODULE, { plugins: [banner] })
 *  ``` */
export interface EmitPlugin {
  /** The plugin's name, used in error messages and diagnostics. */
  readonly name: string
  /** How this plugin appears in the identity string that {@link emitIdentity} computes for an
   *  emit configuration. When it is unset, `name` is used. Set it when the plugin's own options
   *  change the emitted bytes, so that two configurations of the same plugin produce different
   *  identities: `minify({a})` and `minify({b})` would otherwise be the same string. None of the
   *  plugins shipped with the package set it. */
  readonly identity?: string
  /** Rewrites the module after every lowering and optimisation pass. The result must be
   *  deterministic for a given module: the GLSL vertex and fragment stages are emitted by
   *  separate calls that must agree on every shared name. */
  readonly transformIR?: (lowered: ModuleDecl) => ModuleDecl
  /** Rewrites the assembled source string. */
  readonly transformText?: (code: string) => string
}

/** Options accepted by `emitModule` and `emitGlslModule`. Every field is optional; an
 *  omitted or empty options object gives the plain emit.
 *
 *  @example
 *  ```ts
 *  import { obfuscate } from 'typeshade/emit-prod'
 *
 *  const wgsl = emitModule(MODULE, { plugins: obfuscate(), parens: 'minimal' })
 *  ``` */
export interface EmitOptions {
  /** Plugins to run around the assembly, in order. See {@link EmitPlugin} for the hook
   *  sequence. */
  readonly plugins?: readonly EmitPlugin[]
  /** How many parentheses the emitted expressions carry. `'full'` is the default and wraps
   *  every operator. `'minimal'` omits a paren wherever operator precedence already implies
   *  the same parse. Pair it with `{ plugins: obfuscate() }` for the smallest shipped shader.
   *
   *  `'minimal'` omits a paren only where WGSL and GLSL ES 3.00 define the same precedence:
   *  `*`, `/` and `%` over `+` and `-` over unary `-`. The relational, logical, bitwise and
   *  shift operators stay wrapped on purpose, because WGSL gives them no chaining precedence
   *  at all, so mixing them unparenthesised is a compile error there and ranking them would
   *  invent a rule one target lacks.
   *
   *  It never reassociates. `a + (b + c)` keeps its parens, because in floating point that is
   *  a different number from `a + b + c`. */
  readonly parens?: ParenMode
  /** Which arithmetic primitives back the emulated-double helper functions that f64 lowering
   *  injects. `'float'` is the default. `'integer'` writes the primitives in integer bit
   *  arithmetic, which a fast-math compiler pass cannot reassociate, and injects no `_fp64`
   *  guard binding. See {@link Fp64Flavor} for when to choose each. */
  readonly fp64Flavor?: Fp64Flavor
}

/** Fold every plugin's `transformIR` over the lowered module, in `plugins`
 *  order. Shared by the WGSL driver below and the GLSL backend's own assembly. */
export function applyIRPlugins(lowered: ModuleDecl, opts?: EmitOptions): ModuleDecl {
  let m = lowered
  for (const p of opts?.plugins ?? []) if (p.transformIR) m = p.transformIR(m)
  return m
}

/** Fold every plugin's `transformText` over the emitted string, in `plugins` order. */
export function applyTextPlugins(code: string, opts?: EmitOptions): string {
  let c = code
  for (const p of opts?.plugins ?? []) if (p.transformText) c = p.transformText(c)
  return c
}

/** The backend's directive header, ready to PREPEND (X-GIS #1670). `modulePreamble` returns
 *  bare directive lines with no trailing separator (backend.ts — one contract for every
 *  target); this driver's slot puts a blank line between them and the first declaration,
 *  and contributes nothing at all when the module directs nothing, so an enables-free
 *  emit stays byte-identical. */
function directiveHeader(be: Backend, m: ModuleDecl): string {
  const pre = be.modulePreamble?.(m) ?? ''
  return pre ? `${pre}\n\n` : ''
}

/** Emit a ModuleDecl to a target string: shared preamble (`lowerForBackend`) then the
 *  declaration assembly (consts → structs → bindings → funcs, only non-empty sections),
 *  joined `\n\n` with a trailing newline. Each backend's public module entry
 *  (`emitModule` for WGSL) routes through here, so the assembly lives once.
 *  `opts.plugins` run staged around the assembly (all transformIR, then all transformText). */
export function emitModule(m: ModuleDecl, be: Backend, opts?: EmitOptions): string {
  const lowered = applyIRPlugins(lowerForBackend(m, be, undefined, opts?.fp64Flavor), opts)
  // The `enable`-directive header (X-GIS #628) is derived from the AUTHORED module's opt-in
  // caps (m.enables) — the lowering passes rebuild the module object and do not carry
  // it — and prepended to the assembled declarations. '' for enables-free modules, so
  // their emit stays byte-identical.
  return directiveHeader(be, m) + applyTextPlugins(assembleLowered(lowered, be, opts?.parens), opts)
}

/** Emit a ModuleDecl as a header-less FRAGMENT for `be` (X-GIS #1711) — the declaration
 *  assembly without the directive header and, unless `entryPoints` is true, without the
 *  stage entry points. The directives come back as `preamble` lines for the composer to
 *  merge rather than being concatenated into source it would have to strip.
 *
 *  WGSL needs no header/body split beyond this: its only preamble is the `enable`
 *  directives, and it has no stage wrapper — an entry is an ordinary function with an
 *  attribute. GLSL's split is genuinely structural and lives in `emitGlslFragment`.
 *
 *  Unlike `emitFuncs`, this runs the whole pre-emit pipeline (`validate` → `assertCaps` →
 *  `assertBuiltins` → lowering → optimize), so a fragment cannot silently skip the gates
 *  a whole-module emit enforces. That is the reason to prefer it over hand-concatenating
 *  per-declaration emitters. */
export function emitModuleFragment(
  m: ModuleDecl,
  be: Backend,
  opts?: EmitOptions & { entryPoints?: boolean },
): EmitFragment {
  const lowered = applyIRPlugins(lowerForBackend(m, be, undefined, opts?.fp64Flavor), opts)
  const entries = lowered.funcs.filter((f) => stageOf(f) !== undefined)
  const kept =
    opts?.entryPoints === true
      ? lowered.funcs
      : lowered.funcs.filter((f) => stageOf(f) === undefined)
  const pre = be.modulePreamble?.(m) ?? ''
  return {
    source: applyTextPlugins(assembleLowered({ ...lowered, funcs: kept }, be, opts?.parens), opts),
    preamble: pre ? pre.split('\n').filter((l) => l !== '') : [],
    declares: {
      functions: kept.filter((f) => stageOf(f) === undefined).map((f) => f.name),
      structs: lowered.structs.map((s) => s.name),
      bindings: lowered.bindings.map((b) => b.name),
      consts: lowered.consts.map((c) => c.name),
      overrides: (lowered.overrides ?? []).map((o) => o.name),
      entryPoints: entries.map((f) => f.name),
    },
    requires: fragmentRequires(lowered, kept, be.id === 'wgsl' ? 'wgsl' : 'glsl'),
  }
}

/** Emit a ModuleDecl at an explicit optimization level (O0/O1/O2) instead of the
 *  backend's default. `emitModuleAt(m, be, 'O2')` is byte-identical to `emitModule(m, be)`
 *  (both run the full fixpoint); O0 emits the naive lowered module. Used by the emit-size
 *  measurement (measure.ts) to A/B the optimizer and for debug builds. NOTE: the GLSL
 *  backend assembles uniform UBOs via its own emitGlslModule, so this WGSL-style assembly
 *  is for the WGSL backend (and any backend whose bindings need no special assembly). */
export function emitModuleAt(m: ModuleDecl, be: Backend, level: OptLevel): string {
  return directiveHeader(be, m) + assembleLowered(lowerForBackend(m, be, level), be)
}

/** Emit a ModuleDecl AND recover its pipeline reflection, BOTH derived from the SAME
 *  lowered module (`lowerForBackend(m, be)`) so the emitted string and the reflection
 *  metadata cannot desync. `.code` is byte-identical to `emitModule(m, be)`; `.reflection`
 *  is `reflect()` of the lowered module — equal to `reflect(m)` for f64-free modules
 *  (autoVars/lowerModule/cse rewrite only function BODIES). For a module using f64,
 *  fp64Lower rewrites decl TYPES too (f64 → vec2<f32>), but the BYTE layout is unchanged
 *  by construction — typeLayout gives f64 the same {size 8, align 8} as its lowered
 *  vec2<f32> slot — so reflect(m) and this reflection still report identical offsets;
 *  only the reported type STRING differs ('f64' vs 'vec2<f32>'). */
export function emitModuleWithReflection(
  m: ModuleDecl,
  be: Backend,
): { code: string; reflection: Reflection } {
  const lowered = lowerForBackend(m, be)
  return {
    code: directiveHeader(be, m) + assembleLowered(lowered, be),
    reflection: reflect(lowered),
  }
}
