// ═══ Shader DSL — authored source spans on the IR ═══
//
// Where an IR node came from in the TypeScript that produced it. The `"use typeshade"`
// source compiler reaches every construct it lowers through a `ts.Node`, so it has an exact
// `[start, end)` span for each one; before this module it computed that span for diagnostics
// and threw it away everywhere else, and nothing downstream could say which line of an
// author's file a statement belonged to.
//
// WHY A FIELD ON THE NODE, NOT A SIDE TABLE. `mapStmtExpr`/`mapChildren` (visit.ts) and
// `mapExpr`/`mapStmt` (passes/opt/ir-transform.ts) rebuild every node as
// `{ ...node, <rewritten children> }`, so an optional field on the original object is carried
// by that spread with no change to any pass. It is lost only where a pass builds a genuinely
// new node — exactly where there is no authored origin to carry. An identity-keyed side table
// dies at that same spread: `diagnostics/loc.ts` says so in its own header, and that is why
// its locations resolve only on the authored module. A side table the passes PROPAGATE would
// have to be threaded through every pass signature, and a new pass would opt out of it by
// forgetting a parameter.
//
// THE EMITTED BYTES CANNOT MOVE. Every emitter dispatches on the `s`/`op` tag and reads named
// fields; none enumerates keys, serializes a node or hashes one (`emitIdentity` hashes emit
// OPTIONS, not the IR). `examples/emit-goldens.test.ts` and `examples/shade-examples.test.ts`
// prove it per commit.
//
// See `docs/debugging.md` §3 for the design this implements.

import type { Expr, FuncDecl, Stmt } from './nodes.js'

/** Where an IR node came from in its authored source: the file, the exact UTF-16 offsets, and
 *  the line and character of each end for display.
 *
 *  The `"use typeshade"` source compiler fills one for every {@link Stmt} and {@link FuncDecl}
 *  it lowers, for the outermost call node lowered from each `ts.CallExpression`, and for an
 *  assignment's target. A call the front end SYNTHESISES while expanding one carries none:
 *  `random(seed)` becomes a `fract(sin(dot(…)))` tree, the array higher-order functions expand
 *  into per-element calls, and `Math.hypot` becomes `length(vec2(…))`. None of those were
 *  written anywhere. A numeric cast is NOT in that list: `f32(n)` is a call node lowered from a
 *  `ts.CallExpression` the author wrote, and it carries the span of that text like any other.
 *  What has no span is `f32(3)`, where the literal's coercion folds to a `lit` — and a `lit`
 *  has no span field at all, so there is nothing to ask about. `start` and `length` are the
 *  authority; the four line and character fields are derived from them through the parsed
 *  `ts.SourceFile`'s own line map, so a consumer that holds only the span — a debug adapter, a
 *  source-map writer — does not have to re-read the file to display it.
 *
 *  Lines and characters are **zero-based**, matching the language service
 *  (`docs/language-service-api.md` §2) and LSP. `TsCompilerDiagnostic`'s own `line` and
 *  `character` are one-based; the two conventions already coexist and the language service
 *  already converts, so this type follows the editor-facing one rather than changing the
 *  diagnostic shape.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @see {@link sourceSpanOf} for reading one back off a node.
 */
export interface SourceSpan {
  /** The compilation unit's file name: the one the caller named, or the compiler's own default
   *  when the caller named none (`compileTsSource` supplies `typeshade-input.ts`). */
  readonly file: string
  /** UTF-16 code-unit offset of the first character, into that file's text. */
  readonly start: number
  /** Length in UTF-16 code units. `start + length` is the exclusive end offset. */
  readonly length: number
  /** Zero-based line of `start`. */
  readonly line: number
  /** Zero-based UTF-16 character of `start` within its line. */
  readonly character: number
  /** Zero-based line of the exclusive end offset. */
  readonly endLine: number
  /** Zero-based UTF-16 character of the exclusive end offset within its line. */
  readonly endCharacter: number
}

/** The authored source span of an IR node, or `undefined` when it has none.
 *
 *  A node has one when it was lowered from `"use typeshade"` TypeScript and no pass has
 *  rebuilt it from scratch since. Three cases give `undefined`, and each is a real answer
 *  rather than a failure:
 *
 *  - The node was authored through the `fn()` EDSL, which has no AST to read a span from.
 *    That surface keeps its own line-level tracing ({@link setSourceTracing}, `getLoc`), which
 *    captures a stack frame's `file:line:col` — a point, not a span. Nothing here converts one
 *    into the other, because the width would have to be invented.
 *  - The node was synthesised rather than authored: the loop counter a `while` lowers to, a
 *    helper `fp64Lower` injects, a `var` `autoVars` materialises.
 *  - A pass rebuilt the node from named fields instead of spreading the original. The shared
 *    walkers all spread, so this is rare, and where it happens the rewritten node is not the
 *    statement the author wrote.
 *
 *  Reading through this function rather than the field directly is what lets a later increment
 *  widen where spans come from — more expression kinds, a fallback table for a node shape that
 *  cannot carry a field — without a breaking change.
 *
 *  Exported from `@xgis/shader-dsl`, `@xgis/shader-dsl/core/ir`.
 *
 *  @param node - the statement, expression or function declaration to ask about.
 *  @returns the span, or `undefined` when the node carries none.
 *
 *  @example
 *  ```ts
 *  import { compile, sourceSpanOf } from '@xgis/shader-dsl'
 *
 *  const { module } = compile(src)
 *  for (const s of module.funcs[0]!.body) {
 *    const span = sourceSpanOf(s)
 *    if (span) console.log(`${span.file}:${span.line + 1}:${span.character + 1}`)
 *  }
 *  ```
 *
 *  @see {@link SourceSpan} for the shape it returns.
 */
export function sourceSpanOf(node: Stmt | Expr | FuncDecl): SourceSpan | undefined {
  return (node as { readonly span?: SourceSpan }).span
}
