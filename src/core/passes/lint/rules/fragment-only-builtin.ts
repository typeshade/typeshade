import type { LintRule } from '../engine.js'
import { stageOf } from '../../../ir/index.js'
import { collectFnRefs, emptyRefSet } from '../../../ir/collect-refs.js'

/** The derivative builtins (X-GIS #1654) share ONE fix: unlike the texture rows there is
 *  no drop-in same-shape alternative — a screen-space derivative simply does not
 *  exist outside a fragment invocation, so the quantity has to come from elsewhere. */
const DERIVATIVE_FIX =
  'precompute the quantity and pass it in (a per-vertex varying, a CPU-computed uniform, or finite differences of neighboring samples) — derivatives exist only in a fragment invocation'

/** The comparison reads whose level of detail is implicit share ONE fix: the `…Level` twin
 *  compares at level 0 and needs no derivatives. */
const COMPARE_FIX = (args: string): string =>
  `use textureSampleCompareLevel(${args}) — it compares at level 0 and needs no derivatives`

/** Fragment-only builtin id -> the fix its message must name. Table-driven, so a
 *  further fragment-only builtin joins by adding ONE row.
 *
 *  THIS TABLE IS THE SINGLE FIX-AUTHORITY (X-GIS #1654). It now holds four fix families —
 *  the explicit-LOD texture form, its array form (whose fix must name the layer
 *  argument), the depth comparison's `…Level` twin, and the derivatives (no same-shape
 *  alternative exists at all) — so the
 *  SD0109 catalogue hint (codes.ts) is deliberately GENERIC and points the reader at
 *  the diagnostic's own message; it is NOT a copy of any row. That replaces X-GIS #1650's
 *  "first row byte-identical to the catalogue hint / one string, two surfaces"
 *  convention, which nothing ever enforced (no test compared the two) and which
 *  X-GIS #1651's array row had already broken. Per-id hints are pinned where they are
 *  authored: this rule's tests.
 *
 *  EXPORTED since #145 so the front end's own stage walk (`FRAGMENT_ONLY_CALLS` in
 *  `compiler/ts/lower/function.ts`) can be pinned equal to it. Two hand lists in two layers
 *  stay equal only if something compares them, and each way of missing an id has already
 *  happened: `textureSample` on a `texture_cube_array` was in NEITHER table (#143 added it to
 *  both), and `textureSample` itself was in this one and not the front end's until #145, so a
 *  vertex entry sampling a `texture_2d` was answered by an SD0109 from the backend instead of
 *  by a sentence about the author's own file.
 *
 *  `src/core/spec-conformance/stage-rules.test.ts` compares this map's keys, UNIONED with the
 *  front end's set, against the ids derived from Tint's `core.def` `@stage("fragment")` rows.
 *  The union is what matters there: which of the two layers owns an id is an implementation
 *  detail, and an id falling between them is exactly how `textureSampleCubeArray` was lost. */
export const FRAGMENT_ONLY_IDS: ReadonlyMap<string, string> = new Map([
  [
    'textureSample',
    'use textureSampleLevel(tex, smp, uv, level) — an explicit LOD needs no derivatives',
  ],
  [
    'textureSampleArray',
    'use textureSampleLevel(tex, smp, uv, layer, level) — an explicit LOD needs no derivatives',
  ],
  [
    'textureSampleCubeArray',
    'use textureSampleLevel(tex, smp, dir, layer, level) — an explicit LOD needs no derivatives',
  ],
  // A bias SHIFTS the implicit level of detail, so it needs the same derivatives the plain
  // sample does (#145): Tint and a WebGL2 driver each refuse it outside a fragment stage.
  [
    'textureSampleBias',
    'use textureSampleLevel(tex, smp, uv, level) — an explicit LOD needs no derivatives',
  ],
  [
    'textureSampleBiasArray',
    'use textureSampleLevel(tex, smp, uv, layer, level) — an explicit LOD needs no derivatives',
  ],
  [
    'textureSampleBiasCubeArray',
    'use textureSampleLevel(tex, smp, dir, layer, level) — an explicit LOD needs no derivatives',
  ],
  // The depth comparisons with an implicit level of detail (#145).
  ['textureSampleCompare', COMPARE_FIX('tex, smp, uv, ref')],
  ['textureSampleCompareArray', COMPARE_FIX('tex, smp, uv, layer, ref')],
  ['textureSampleCompareCube', COMPARE_FIX('tex, smp, dir, ref')],
  ['textureSampleCompareCubeArray', COMPARE_FIX('tex, smp, dir, layer, ref')],
  ['dpdx', DERIVATIVE_FIX],
  ['dpdy', DERIVATIVE_FIX],
  ['fwidth', DERIVATIVE_FIX],
  // The coarse and fine spellings are the same quantity at a stated precision (#145).
  ['dpdxCoarse', DERIVATIVE_FIX],
  ['dpdxFine', DERIVATIVE_FIX],
  ['dpdyCoarse', DERIVATIVE_FIX],
  ['dpdyFine', DERIVATIVE_FIX],
  ['fwidthCoarse', DERIVATIVE_FIX],
  ['fwidthFine', DERIVATIVE_FIX],
])

/** A fragment-only builtin must not be reachable from a VERTEX or COMPUTE entry.
 *
 *  `textureSample` derives its mip level from screen-space derivatives, which exist
 *  only in a fragment invocation — WGSL therefore rejects it in any other stage, and
 *  the failure surfaces as an opaque naga/driver error far from the call site. The
 *  derivative builtins themselves (`dpdx` / `dpdy` / `fwidth`, X-GIS #1654) are fragment-only
 *  for the same reason.
 *
 *  Reachability is the call-graph closure from each non-fragment entry over the
 *  module's own fns (collectFnRefs — the collector stageScope also uses), so a builtin
 *  buried two helpers deep is caught too. A helper reachable only from a fragment
 *  entry is fine; one reachable from BOTH is flagged, because it is emitted into the
 *  vertex/compute stage as well (pinned by a dual-entry test, X-GIS #1654). A module with no
 *  non-fragment entry (helper-only / runtime-composed) is silent by construction.
 *
 *  `raw` Stmts: collectFnRefs cannot see a call made inside raw WGSL text (its
 *  documented contract), so a raw-only edge makes this rule UNDER-report — never
 *  mis-report: IR edges are real calls, so every flagged violation is true whatever
 *  raw contains. Deliberately NOT bailed on raw, unlike dce-fns / stageScope: those
 *  TRANSFORM the module and need the complete graph to act safely; a diagnostic only
 *  needs its positives sound, and bailing would silence true catches in any module
 *  that merely carries an unrelated raw Stmt. Both behaviors are pinned by tests. */
export const fragmentOnlyBuiltin: LintRule = {
  id: 'fragment-only-builtin',
  description: 'a fragment-only builtin must not be reachable from a vertex or compute entry',
  severity: 'error',
  category: 'correctness',
  create: (ctx) => {
    const byName = new Map(ctx.module.funcs.map((f) => [f.name, f]))
    const entries = ctx.module.funcs.filter((f) => {
      const stage = stageOf(f)
      return stage === 'vertex' || stage === 'compute'
    })
    // Call-graph closure from the non-fragment entries.
    const reachable = new Set(entries.map((f) => f.name))
    const stack = [...entries]
    while (stack.length > 0) {
      const refs = emptyRefSet()
      collectFnRefs(stack.pop()!, refs)
      for (const name of refs.calls) {
        const f = byName.get(name)
        if (f && !reachable.has(name)) {
          reachable.add(name)
          stack.push(f)
        }
      }
    }
    return {
      Expr(e, fn) {
        if (e.op !== 'call' || !reachable.has(fn.name)) return
        const fix = FRAGMENT_ONLY_IDS.get(e.fn)
        if (fix === undefined) return
        ctx.report(`${e.fn} is fragment-only in WGSL — ${fix}`, {
          fn: fn.name,
          node: e,
          code: 'SD0109',
          hint: fix,
        })
      },
    }
  },
}
