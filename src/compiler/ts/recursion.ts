// === WGSL has no call stack: reject a call CYCLE at the call site that closes it ===
//
// A recursive `"use typeshade"` function compiled with zero diagnostics and emitted WGSL that
// Tint refuses (`cyclic dependency found: 'fact' -> 'fact'`) — issue #48. The repository
// already carried a `noRecursion` lint rule, but it is not in `CORE_RULES`, so `validate()`
// never ran it, and the front end ran nothing on its own call graph.
//
// WHY A FRONT-END GRAPH WALK RATHER THAN ADDING THAT RULE TO `CORE_RULES`. Two reasons, and
// the second is the one that decided it:
//
//   1. POSITION. A core-rule failure reaches `compile()` as the single `TS8015` backend
//      diagnostic anchored on the first statement — the file's `"use typeshade"` directive —
//      which tells an author that something is wrong with the file, not which call to delete.
//      Here the diagnostic lands on the offending call expression.
//   2. REACH. `noRecursion` tests `e.op === 'call' && e.fn === fn.name`: a function calling
//      ITSELF. Mutual recursion — `a` calls `b`, `b` calls `a` — is invisible to it, and
//      compiles and emits today just as readily. Tint rejects that too
//      (`cyclic dependency found: 'a' -> 'b' -> 'a'`), so a check that only saw self-calls
//      would close half of #48 and leave the other half looking fixed.
//
// The lint rule is left exactly as it is. It is direct-only by construction, and the `fn()`
// EDSL surface still has the mutual-recursion hole this closes for `"use typeshade"`; that is
// worth a separate decision about `CORE_RULES` rather than a silent widening from here.

import ts from 'typescript'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'
import type { TsCompilerDiagnostic } from './source-file.js'

/** One node of the call graph, as the caller's own compile path already knows it.
 *
 *  `resolve` is what keeps this usable from both entry points: the single-file path calls a
 *  function by the name it is declared under, while the multi-file path calls it by whatever
 *  local name the `import` bound (`module.ts` already holds that map). Passing the mapping in
 *  rather than re-deriving it here means this module never has to know about imports. */
export interface RecursionNode {
  /** The canonical graph key — the name the emitted WGSL function will carry. */
  readonly name: string
  readonly decl: ts.FunctionLikeDeclarationBase
  readonly sourceFile: ts.SourceFile
  /** A called identifier's text to the canonical name it refers to, or `undefined` when it is
   *  not a user function in this graph (an intrinsic, a constructor, an unknown name). */
  readonly resolve: (callee: string) => string | undefined
}

interface Edge {
  readonly to: string
  readonly node: ts.Node
  readonly sourceFile: ts.SourceFile
}

/** Every call this function makes to another graph node, in source order, each paired with the
 *  call expression to anchor a diagnostic on. Nested functions are not a thing the surface has,
 *  so the whole body is one scope to walk. */
function edgesOf(fn: RecursionNode): Edge[] {
  const edges: Edge[] = []
  const body = fn.decl.body
  if (!body) return edges
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const to = fn.resolve(node.expression.text)
      if (to !== undefined) edges.push({ to, node, sourceFile: fn.sourceFile })
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return edges
}

/** The cycle written the way Tint writes it: `'a' -> 'b' -> 'a'`. */
function renderCycle(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(' -> ')
}

/** A cycle's identity, independent of where the walk happened to enter it, so `a -> b -> a` and
 *  `b -> a -> b` are reported once rather than once per entry point. Rotating to the
 *  lexicographically smallest member is enough: a simple cycle has one such rotation. */
function cycleKey(names: readonly string[]): string {
  let best = 0
  for (let i = 1; i < names.length; i++) if (names[i]! < names[best]!) best = i
  return [...names.slice(best), ...names.slice(0, best)].join(' ')
}

/**
 * Report every call cycle in `nodes` as an error on the call that closes it.
 *
 * Depth-first with the usual three colours: a back-edge into a function still on the stack is
 * a cycle, and the stack slice from that function to the current one IS the cycle. Each
 * distinct cycle is reported once, at the call site that closes it — the place an author can
 * actually edit — with the whole cycle named so a two-hop one is not a mystery.
 *
 * @param nodes - the call graph, one entry per user function.
 * @param diagnostics - collector; one error is pushed per distinct cycle.
 */
export function checkRecursion(
  nodes: readonly RecursionNode[],
  diagnostics: TsCompilerDiagnostic[],
): void {
  const byName = new Map<string, RecursionNode>()
  for (const n of nodes) if (!byName.has(n.name)) byName.set(n.name, n)
  const outgoing = new Map<string, Edge[]>()
  for (const [name, n] of byName) outgoing.set(name, edgesOf(n))

  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const colour = new Map<string, number>()
  for (const name of byName.keys()) colour.set(name, WHITE)
  const stack: string[] = []
  const reported = new Set<string>()

  const visit = (name: string): void => {
    colour.set(name, GREY)
    stack.push(name)
    for (const edge of outgoing.get(name) ?? []) {
      const state = colour.get(edge.to)
      if (state === undefined) continue // not a graph node after all
      if (state === GREY) {
        const from = stack.lastIndexOf(edge.to)
        const cycle = stack.slice(from)
        const key = cycleKey(cycle)
        if (!reported.has(key)) {
          reported.add(key)
          diagnostics.push(
            makeDiagnostic(
              edge.sourceFile,
              edge.node,
              `Recursive call: ${renderCycle([...cycle, edge.to])}. WGSL has no call stack, so a function must not take part in a call cycle.`,
              TS_CODES.RECURSION,
            ),
          )
        }
        continue
      }
      if (state === WHITE) visit(edge.to)
    }
    stack.pop()
    colour.set(name, BLACK)
  }

  // Declaration order, so the diagnostics of a file with several cycles are stable.
  for (const n of nodes) if (colour.get(n.name) === WHITE) visit(n.name)
}
