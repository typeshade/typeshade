// ═══ Shader DSL — drop authored spans before comparing two IR trees (test utility) ═══
//
// `SourceSpan` says WHERE a node was written, not WHAT it means, so two spellings of the same
// program produce equal IR with different spans: `sin(a)` and `Math.sin(a)` lower to the same
// call from different offsets, and the `fn()` EDSL surface carries no span at all. A test
// whose claim is "these are the same IR" has to say so without the spans, and this is the one
// place that strips them, so the several suites making that claim cannot disagree about what
// "the same" means.
//
// Not exported from the package: it exists for this repository's own suites, beside
// `random-ir.ts`.

/** A structural copy of `value` with every `span` and `nameSpan` removed, at every depth.
 *
 *  Follows `declRef` like any other field, so the graph it walks CAN contain a cycle: a
 *  self-recursive `FuncDecl` reaches itself through the call in its own body. `no-recursion` is
 *  a lint rule rather than a structural guarantee, and a hand-built `FuncDecl` need not have
 *  been linted at all, so termination cannot rest on it. The seen map is what makes this
 *  total: each object's replacement is registered BEFORE its fields are walked, so a cycle
 *  closes onto the copy already in progress instead of recursing forever. It also makes shared
 *  subtrees shared in the copy, which is what a structural comparison wants anyway.
 *
 *  @internal
 */
export function stripSpans<T>(value: T): T {
  return strip(value, new Map<object, unknown>())
}

function strip<T>(value: T, seen: Map<object, unknown>): T {
  if (value === null || typeof value !== 'object') return value
  const hit = seen.get(value as object)
  if (hit !== undefined) return hit as T
  if (Array.isArray(value)) {
    const out: unknown[] = []
    seen.set(value as object, out)
    for (const v of value) out.push(strip(v, seen))
    return out as unknown as T
  }
  const out: Record<string, unknown> = {}
  seen.set(value as object, out)
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'span' || k === 'nameSpan') continue
    out[k] = strip(v, seen)
  }
  return out as T
}
