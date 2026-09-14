import type { ModuleDecl } from '../../core/ir/nodes.js'
import { emitModule } from '../../core/backends/wgsl.js'
import { emitGlslStages } from '../../core/backends/glsl.js'
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js'
import { backendDiagnostic } from './diagnostic.js'
import { evalEntry } from './eval-entry.js'

/**
 * What `compile()` returns. The one rule behind every optional field: shader text and a
 * runnable oracle exist only for a program that compiled with no error diagnostic. A caller
 * that reads `wgsl` without checking `diagnostics` gets `undefined`, never text for a program
 * that did not compile.
 */
export interface CompileResult {
  /**
   * Every diagnostic the front end and the backends produced, in the order they were found.
   * A `"use typeshade"`-less file has exactly one, `TS8001` (`MISSING_DIRECTIVE`); a parse
   * error has only `TS8030` (`SYNTAX`) entries; a backend that threw on a program the front end
   * accepted adds one `TS8015` (`BACKEND`) entry anchored on the file's first statement: an
   * `error` when the WGSL emitter threw, a `warning` when only the GLSL emitter threw on a
   * vertex+fragment module (a compute entry next to the render pair, a storage binding the
   * GLSL emulation cannot spell). A program with no `error` entry compiled.
   */
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  /**
   * The lowered IR module: the consts, structs, bindings and functions the front end built.
   * Always present. When `diagnostics` has an error the module is partial (the front end
   * stops lowering a declaration at its first error and may drop it), so it is for inspection
   * and diagnostics tooling, not for emitting.
   */
  readonly module: ModuleDecl
  /**
   * The module's WGSL. `undefined` when any diagnostic has category `error`, including a
   * `BACKEND` error from a WGSL emitter that threw. Present otherwise, even for a module with
   * no functions (a file of consts or structs emits their declarations), and kept when only
   * the GLSL emitter failed: the WGSL is the program, GLSL a second target of it.
   */
  readonly wgsl?: string
  /**
   * The module's GLSL ES 3.00 vertex and fragment programs. Present only when the module has
   * both a `@vertex` and a `@fragment` entry, no diagnostic has category `error`, and the GLSL
   * emitter took the module; a compute-only, vertex-only or fragment-only module gets
   * `undefined` here while `wgsl` is still present (the same guard `packModule` applies), and
   * so does a vertex+fragment module the GLSL backend threw on, with the throw recorded as a
   * `BACKEND` warning and `wgsl` still present.
   */
  readonly glsl?: { readonly vertex: string; readonly fragment: string }
  /**
   * Run one function of the module on the CPU oracle: `eval('fs')` calls the fragment entry
   * with no arguments, `eval('add', [1, 2])` a helper with two. When `diagnostics` has an
   * error, every call throws an `Error` naming the first error diagnostic (file, line and
   * message), so a host that ignores `diagnostics` cannot run a broken shader on the oracle.
   * It also throws for a function name the module does not have.
   */
  readonly eval: (name: string, args?: readonly unknown[]) => unknown
}

/**
 * Compile TypeShade TypeScript source into the module and generated shader outputs.
 *
 * The source must carry the `"use typeshade"` directive (`compileTsSource`'s
 * `requireDirective` default): without it the result has one `MISSING_DIRECTIVE` error and
 * nothing else. When the front end reports an error the backends are not run at all, so
 * `wgsl` and `glsl` are `undefined` and `eval` throws; a partial module is never packed into
 * shader text. When the front end reports no error, a WGSL emitter that throws anyway (a
 * literal the target cannot spell, an IR the emitter rejects) is reported as one `BACKEND`
 * error diagnostic rather than an exception, and `wgsl` and `glsl` are again `undefined`.
 * GLSL is emitted only for a module with both a vertex and a fragment entry; when the GLSL
 * emitter throws on such a module (a compute entry beside the render pair, a binding the
 * GLSL emulation cannot spell) the module has still compiled: `wgsl` stays, `glsl` is
 * `undefined`, and the throw is one `BACKEND` diagnostic with category `warning`. See
 * `CompileResult` for each field.
 */
export function compile(source: string): CompileResult {
  const r = compileTsSource(source)
  const module: ModuleDecl = {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  }
  const diagnostics = [...r.diagnostics]
  const firstError = (): TsCompilerDiagnostic | undefined =>
    diagnostics.find((d) => d.category === 'error')

  let wgsl: string | undefined
  let glsl: CompileResult['glsl']
  if (!firstError()) {
    try {
      wgsl = r.wgsl ?? emitModule(module)
    } catch (e) {
      diagnostics.push(backendDiagnostic(r.sourceFile, e))
    }
  }
  // GLSL is a second target of a module whose WGSL exists. Its emitter has no compute stage
  // and a narrower storage emulation, so it can refuse a module that compiled; that shortfall
  // is a warning that leaves `wgsl` in place, not an error that would unsay the compile.
  if (wgsl !== undefined) {
    const hasVs = module.funcs.some((f) => f.stage === 'vertex')
    const hasFs = module.funcs.some((f) => f.stage === 'fragment')
    if (hasVs && hasFs) {
      try {
        glsl = emitGlslStages(module)
      } catch (e) {
        diagnostics.push(backendDiagnostic(r.sourceFile, e, 'warning'))
      }
    }
  }

  return {
    diagnostics,
    module,
    wgsl,
    glsl,
    eval: (name, args = []) => {
      const err = firstError()
      if (err) {
        const code = err.code ? ` ${err.code}` : ''
        throw new Error(
          `Cannot evaluate "${name}": the module did not compile. ` +
            `${err.fileName}:${err.line}:${err.character}${code} ${err.message}`,
        )
      }
      return evalEntry(module, name, args)
    },
  }
}
