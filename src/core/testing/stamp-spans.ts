// ═══ Shader DSL: give a hand-built module spans, so it can be stepped (test utility) ═══
//
// The stepping session stops only at statements that carry a `SourceSpan`, because a statement
// with no span has no line to show an editor (`docs/debugging.md` §3.4). That is the right rule
// and it makes hand-built IR un-steppable, which is a problem for exactly one kind of test: the
// ones whose subject cannot be written in `"use typeshade"` at all.
//
// `dpdx` is the case. It has an entry in the CPU op library and no spelling in the source
// language, so a module that reaches a GPU stub has to be built by hand, and then it cannot be
// stepped. Stamping synthetic spans is what bridges that: the spans are fictional, but the only
// thing the test asks of them is that they exist, which is precisely what a source-compiled
// module would give it.
//
// Not exported from the package: it exists for this repository's own suites, beside
// `strip-spans.ts` and `random-ir.ts`.

import type { FuncDecl, ModuleDecl, Stmt } from '../ir/nodes.js'
import type { SourceSpan } from '../ir/span.js'

/** A copy of `m` in which every statement and function carries a span.
 *
 *  One line per statement in source order, numbered from zero, in a file named `file`. The
 *  offsets are invented and no text indexes them, so a test that reads back the SOURCE at a
 *  span will get nonsense: this is for tests that need a run to stop, not for tests about what
 *  a span says. Those belong on a compiled module, where the spans are real.
 *
 *  @internal
 */
export function stampSpans(m: ModuleDecl, file = 'hand-built.shade.ts'): ModuleDecl {
  let line = 0
  const span = (): SourceSpan => {
    const l = line++
    return { file, start: l * 40, length: 20, line: l, character: 0, endLine: l, endCharacter: 20 }
  }
  const stmt = (s: Stmt): Stmt => {
    // The span goes on FIRST, so the line numbers run in the order the statements are written
    // rather than in the order the nested bodies happen to be rebuilt.
    const stamped = { ...s, span: span() } as Stmt
    if (stamped.s === 'if') {
      return {
        ...stamped,
        arms: stamped.arms.map((a) => ({ ...a, body: a.body.map(stmt) })),
        ...(stamped.elseBody ? { elseBody: stamped.elseBody.map(stmt) } : {}),
      }
    }
    if (stamped.s === 'for') {
      return {
        ...stamped,
        init: stmt(stamped.init),
        update: stmt(stamped.update),
        body: stamped.body.map(stmt),
      }
    }
    if (stamped.s === 'switch') {
      return {
        ...stamped,
        cases: stamped.cases.map((c) => ({ ...c, body: c.body.map(stmt) })),
        ...(stamped.defaultBody ? { defaultBody: stamped.defaultBody.map(stmt) } : {}),
      }
    }
    return stamped
  }
  const func = (f: FuncDecl): FuncDecl => ({ ...f, span: span(), body: f.body.map(stmt) })
  return { ...m, funcs: m.funcs.map(func) }
}
