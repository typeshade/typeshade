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
 *  Follows `declRef` like any other field, which terminates because the call graph is a DAG
 *  (`no-recursion` is a lint rule and the backends reject a cycle).
 *
 *  @internal
 */
export function stripSpans<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripSpans(v)) as unknown as T
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'span' || k === 'nameSpan') continue
    out[k] = stripSpans(v)
  }
  return out as T
}
