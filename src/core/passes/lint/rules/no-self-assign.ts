import { mapStmts, type LintRule } from '../engine.js'

/** `JSON.stringify` over a node, minus the keys that record WHERE it was written.
 *
 *  A source span is provenance, and this rule asks whether two expressions MEAN the same
 *  thing. Without the replacer, `v[idx(i)] = v[idx(i)]` stopped being reported the moment
 *  calls began carrying spans: the two `idx(i)` nodes are written in different places, so
 *  their serialisations differ while the program they describe is the same self-assignment. */
const structure = (v: unknown): string =>
  JSON.stringify(v, (k, x) => (k === 'span' || k === 'nameSpan' ? undefined : (x as unknown)))

const isSelfAssign = (s: { s: string; target?: unknown; expr?: unknown }): boolean =>
  s.s === 'assign' && structure(s.target) === structure(s.expr)

/** Flag an assignment whose target and value are structurally identical (e.g. x = x),
 *  a no-op that is almost always a typo. Compared structurally, ignoring source spans. */
export const noSelfAssign: LintRule = {
  id: 'no-self-assign',
  description: 'an assignment whose target and value are identical (e.g. x = x) is a likely typo',
  severity: 'warning',
  category: 'correctness',
  create: (ctx) => ({
    Stmt(s, fn) {
      if (isSelfAssign(s)) {
        ctx.report(
          `self-assignment in fn '${fn.name}' — target and value are identical (likely typo)`,
          { fn: fn.name },
        )
      }
    },
  }),
  // auto-fix: delete the no-op self-assignment.
  fix(m) {
    let changed = false
    const funcs = m.funcs.map((f) => ({
      ...f,
      body: mapStmts(f.body, (s) => {
        if (isSelfAssign(s)) {
          changed = true
          return null
        }
        return s
      }),
    }))
    return changed ? { ...m, funcs } : null
  },
}
