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

/** Options for {@link composeModule}. The default is strict: a placeholder that receives no
 *  swap and a swap key that matches no placeholder are both errors at compose time.
 *
 *  Strictness matters because a placeholder left in place is easy to miss. The WGSL emitter
 *  writes it as a bare `// __placeholder: <tag>` comment and the shader still compiles and
 *  renders, while the GLSL emitter and {@link compileModule} (the same module evaluated on the
 *  CPU in double precision) throw only when they reach it. Set `allowUnswapped` only when
 *  leaving a placeholder open is deliberate.
 *
 *  Exported from `@xgis/shader-dsl`.
 */
export interface ComposeOptions {
  /** Let a placeholder with no matching swap stay in the module. The WGSL emitter writes it as
   *  the comment `// __placeholder: <tag>`; the GLSL emitter and {@link compileModule} throw when
   *  they reach it. Off by default, where an un-swapped placeholder is a compose-time error. */
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

/** Compose a module by filling its placeholder statements. A base module marks each place where
 *  its builds differ with `b.placeholder('tag')`, and `composeModule` replaces each one with the
 *  statement list `swaps` holds under that tag, returning a new module. Function bodies are
 *  rewritten; consts, structs and bindings are copied unchanged.
 *
 *  It descends into `if`, `for` and `switch` bodies, so a placeholder may sit in a nested scope.
 *
 *  It is strict by default. A placeholder that receives no swap is otherwise easy to miss: the
 *  WGSL emitter writes it as a bare `// __placeholder: <tag>` comment and the shader still
 *  compiles, while the GLSL emitter and {@link compileModule} (the same module evaluated on the
 *  CPU in double precision) throw only when they reach it. A swap key that matches no
 *  placeholder, such as a typo, would do nothing at all. Here each case throws at compose time
 *  and names the tags involved.
 *
 *  `allowUnswapped` is for the deliberate case: a placeholder that is meant to stay empty in
 *  this build. It turns off the first check only; a swap key that matches no placeholder is
 *  still an error.
 *
 *  Exported from `@xgis/shader-dsl`.
 *
 *  @param m - the base module carrying the placeholders.
 *  @param swaps - tag to statement list, one entry per placeholder to fill.
 *  @param opts - `allowUnswapped` to let a placeholder stay unfilled.
 *  @returns a new module with the function bodies rewritten; `m` is not modified.
 *  @throws `Error` when a swap key matches no placeholder, or when a placeholder is left
 *    un-swapped and `allowUnswapped` is not set.
 *
 *  @example
 *  ```ts
 *  import { composeModule, fn, module, f32, f32T, type Stmt } from '@xgis/shader-dsl'
 *
 *  const base = module({
 *    funcs: [fn('shade', {}, f32T, (_p, b) => b.placeholder('result'))],
 *  })
 *  const returnConstant = (v: number): Stmt => ({ s: 'return', expr: f32(v).expr })
 *  const composed = composeModule(base, { result: [returnConstant(1)] })
 *  ```
 *
 *  @see {@link variantFamily} for a family of modules that differ by more than one statement list.
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
