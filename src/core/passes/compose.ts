// ═══ Shader DSL — module composition (placeholder swap) ═══
//
// A first-class, VALIDATED replacement for the per-shader hand-rolled placeholder-swap walk
// (the polygon composer). A base module lays down `placeholder(tag)` Stmts at its variation
// seams; `composeModule(base, swaps)` replaces each with the swap's Stmt list — descending into
// if / for / switch bodies so a placeholder may sit in a nested scope.
//
// The DX win over the bespoke walk is VALIDATION (strict by default): an un-swapped placeholder
// is the silent-on-GPU (`// __placeholder`) / throws-on-CPU footgun, and a typo'd swap key
// silently no-ops — both are now a loud error at compose time instead. Pure: returns a new module.

import type { ModuleDecl, Stmt, FuncDecl } from '../ir/index.js'

/** Options for `composeModule`. The default — strict — is the one you want: an un-swapped
 *  placeholder and a typo'd swap key are both errors at compose time.
 *
 *  That strictness is the whole DX win over a hand-rolled placeholder walk, because both
 *  mistakes are otherwise SILENT in the direction that matters: an un-swapped placeholder emits
 *  a bare `// __placeholder` comment on the WGSL side and renders nothing wrong-looking, while
 *  throwing only on the CPU oracle. Turn `allowUnswapped` on only when leaving a seam open is
 *  deliberate.
 *
 *  Exported from `@xgis/shader-dsl/dev`.
 */
export interface ComposeOptions {
  /** Allow a placeholder with no matching swap to survive (emits `// __placeholder: <tag>` on the
   *  WGSL side; throws on the CPU oracle). Off by default — an un-swapped placeholder is an error. */
  readonly allowUnswapped?: boolean
}

/** Replace every `placeholder(tag)` Stmt in `stmts` with `swaps[tag]`, recursing into nested bodies.
 *  Records which tags were seen + which swaps fired (for the strict validation in composeModule). */
function swapInBody(
  stmts: readonly Stmt[],
  swaps: Record<string, readonly Stmt[]>,
  seen: Set<string>,
  used: Set<string>,
): Stmt[] {
  const out: Stmt[] = []
  for (const s of stmts) {
    if (s.s === 'placeholder') {
      seen.add(s.tag)
      const replacement = swaps[s.tag]
      if (replacement) {
        used.add(s.tag)
        out.push(...replacement)
      } else out.push(s)
      continue
    }
    if (s.s === 'if') {
      out.push({
        s: 'if',
        arms: s.arms.map((arm) => ({
          cond: arm.cond,
          body: swapInBody(arm.body, swaps, seen, used),
        })),
        elseBody: s.elseBody ? swapInBody(s.elseBody, swaps, seen, used) : undefined,
      })
      continue
    }
    if (s.s === 'for') {
      out.push({ ...s, body: swapInBody(s.body, swaps, seen, used) })
      continue
    }
    if (s.s === 'switch') {
      out.push({
        s: 'switch',
        scrut: s.scrut,
        cases: s.cases.map((c) => ({
          value: c.value,
          body: swapInBody(c.body, swaps, seen, used),
        })),
        defaultBody: s.defaultBody ? swapInBody(s.defaultBody, swaps, seen, used) : undefined,
      })
      continue
    }
    out.push(s)
  }
  return out
}

/** Compose a module by filling its placeholder statements. A base module marks its variation
 *  seams with `b.placeholder('tag')`, and this replaces each one with the statement list the
 *  swap record holds for that tag, returning a new module. Function bodies are rewritten;
 *  consts, structs and bindings are untouched.
 *
 *  It descends into `if`, `for` and `switch` bodies, so a seam may sit in a nested scope.
 *
 *  It is strict by default, which is the reason to use it over a hand-rolled walk. Both
 *  mistakes it catches are otherwise silent in the direction that matters. A placeholder left
 *  un-swapped emits a bare comment on the WGSL side and renders something that looks fine,
 *  while throwing only on the CPU oracle. A swap key that matches no placeholder, a typo, does
 *  nothing at all. Here each throws at compose time, naming the tags involved.
 *
 *  `allowUnswapped` is for the deliberate case: a seam that is meant to survive empty in this
 *  variant. It turns off the first check only; an unmatched swap key is still an error.
 *
 *  Exported from `@xgis/shader-dsl/dev`.
 *
 *  @param m - the base module carrying the placeholders.
 *  @param swaps - tag to statement list, one entry per seam to fill.
 *  @param opts - `allowUnswapped` to let a seam survive unfilled.
 *  @returns a new module with the funcs' bodies rewritten.
 *  @throws `Error` when a swap key matches no placeholder, or when a placeholder is left
 *    un-swapped and `allowUnswapped` is not set.
 *
 *  @example
 *  ```ts
 *  import { composeModule, module } from '@xgis/shader-dsl/dev'
 *
 *  const base = module({ funcs: [fn('fs_fill', {}, vec4fT, (_p, b) => b.placeholder('fill-return'))] })
 *  const composed = composeModule(base, { 'fill-return': variantFillReturnStmts })
 *  ```
 *
 *  @see {@link variantFamily} for variants that differ by more than one statement list.
 */
export function composeModule(
  m: ModuleDecl,
  swaps: Record<string, readonly Stmt[]>,
  opts?: ComposeOptions,
): ModuleDecl {
  const seen = new Set<string>()
  const used = new Set<string>()
  const funcs: FuncDecl[] = m.funcs.map((f) => ({
    ...f,
    body: swapInBody(f.body, swaps, seen, used),
  }))

  const unknownKeys = Object.keys(swaps).filter((k) => !used.has(k))
  if (unknownKeys.length) {
    throw new Error(
      `shader-dsl: composeModule swap key(s) match no placeholder: ${unknownKeys.join(', ')} (seen: ${[...seen].join(', ') || 'none'})`,
    )
  }
  if (!opts?.allowUnswapped) {
    const unswapped = [...seen].filter((t) => !used.has(t))
    if (unswapped.length) {
      throw new Error(
        `shader-dsl: composeModule left placeholder(s) un-swapped: ${unswapped.join(', ')} — provide a swap or pass { allowUnswapped: true }`,
      )
    }
  }

  return { ...m, funcs }
}
