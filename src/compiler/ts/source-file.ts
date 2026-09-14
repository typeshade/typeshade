// === TypeShade source compiler entry point ===

import ts from 'typescript'
import type { BindingDecl, ConstDecl, FuncDecl } from '../../core/ir/nodes.js'
import { emitModule } from '../../core/backends/wgsl.js'
import { findUseTypeshadeDirective, hasUseTypeshadeDirective, USE_TYPESHADE } from './directive.js'
import { lowerSourceFunctions } from './lower/function.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { collectBindings } from './bindings.js'
import { collectStructs, type CollectedStruct } from './structs.js'
import type { DeclaredSymbol } from './symbols.js'
import { TS_CODES } from './codes.js'
import { backendDiagnostic, makeDiagnostic, syntaxDiagnostics } from './diagnostic.js'

/** Options controlling compilation of a TypeShade TypeScript source string. */
export interface CompileTsSourceOptions {
  readonly fileName?: string
  /** When `true` (the default), a file without the `"use typeshade"` directive gets one
   * `MISSING_DIRECTIVE` error diagnostic and an otherwise empty result, so a caller cannot
   * mistake a file that never opted in for a program that compiled to nothing. Pass `false`
   * for a probe that only wants `hasDirective` (the language service's navigation and semantic
   * tokens do): the same empty result comes back with no diagnostic. */
  readonly requireDirective?: boolean
  /** When `false`, skips `packModule`/WGSL emission entirely: the front end still parses,
   * analyzes and lowers to IR, but `CompileTsSourceResult.wgsl` is always `undefined`. The
   * language service's diagnostics analysis uses this so `getDiagnostics` never produces
   * shader text (design doc §8). Defaults to `true`, the pre-existing behavior. */
  readonly emit?: boolean
  /** A pre-parsed source file to analyze instead of parsing `source` again — the language
   * service passes its own TypeScript program's `SourceFile` here so `getDiagnostics` runs on
   * the exact node identities the program already built, never a second parse (design doc §5,
   * §8). `source` must still be given (some callers, and every existing one, use it as the
   * text and never set this); when set, `source` is not re-parsed and `options.fileName` is
   * ignored in favor of `sourceFile.fileName`. */
  readonly sourceFile?: ts.SourceFile
}

/**
 * A source diagnostic produced while TypeShade analyzes or compiles TypeScript shader code.
 *
 * `line`/`character` are one-based (external consumers, including `language-service.ts`, read
 * these) and mark the start of the offending node. `start`/`length` are UTF-16 offsets into the
 * file — `node.getStart(sourceFile)` and `node.getEnd() - node.getStart(sourceFile)` — so an
 * editor can underline the whole node rather than a single character; `endLine`/`endCharacter`
 * are the one-based position of `start + length`, in the same convention as `line`/`character`.
 * A diagnostic with no node behind it (a missing directive, a whole-module backend failure) uses
 * the file's first statement as its span, or `start: 0, length: 0` when the file has none — see
 * `makeDiagnostic` in `diagnostic.ts`.
 */
export interface TsCompilerDiagnostic {
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly character: number
  readonly category: 'error' | 'warning' | 'message'
  readonly code?: string
  /** UTF-16 offset where the diagnostic's span begins. */
  readonly start: number
  /** Length of the diagnostic's span, in UTF-16 code units. */
  readonly length: number
  /** One-based line of the position `start + length`. */
  readonly endLine: number
  /** One-based character of the position `start + length`. */
  readonly endCharacter: number
}

/** The result of compiling a TypeShade TypeScript source string, including IR and optional WGSL. */
export interface CompileTsSourceResult {
  readonly hasDirective: boolean
  readonly funcs: readonly FuncDecl[]
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  readonly sourceFile: ts.SourceFile
  readonly consts: readonly ConstDecl[]
  readonly bindings: readonly BindingDecl[]
  readonly structs: readonly CollectedStruct[]
  /** Every name the front end declared while lowering `sourceFile`, with the `ShaderType` it
   *  gave it and the UTF-16 span of the declared name: the table an editor answers "what type
   *  is this symbol" from, since TypeScript infers plain `number` for a numeric literal that
   *  the compiler types `f32`. Empty when nothing was lowered (no directive, a parse error).
   *  A side output: nothing here feeds lowering, the IR or emitted text. See `DeclaredSymbol`. */
  readonly symbols: readonly DeclaredSymbol[]
  readonly wgsl?: string
}

/**
 * Compile a TypeScript source string through the TypeShade authoring pipeline.
 *
 * A source without the `"use typeshade"` directive returns `hasDirective: false`, no
 * functions and one `MISSING_DIRECTIVE` error (unless `options.requireDirective` is `false`).
 * `wgsl` is present only when the file lowered at least one function with no error diagnostic
 * and `options.emit` is not `false`; a backend that throws on such a module is reported as a
 * `BACKEND` error diagnostic and leaves `wgsl` undefined.
 */
export function compileTsSource(
  source: string,
  options: CompileTsSourceOptions = {},
): CompileTsSourceResult {
  const sourceFile =
    options.sourceFile ??
    ts.createSourceFile(
      options.fileName ?? 'typeshade-input.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )
  const diagnostics: TsCompilerDiagnostic[] = []
  const symbols: DeclaredSymbol[] = []
  const directive = findUseTypeshadeDirective(sourceFile)
  const hasDirective = directive !== undefined
  const empty = {
    hasDirective: false,
    funcs: [],
    diagnostics,
    sourceFile,
    consts: [],
    bindings: [],
    structs: [] as CollectedStruct[],
    symbols,
  }

  if (!hasDirective) {
    if (options.requireDirective ?? true) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          undefined,
          `Missing "${USE_TYPESHADE}" directive. Add "${USE_TYPESHADE}"; at the top level to mark this file for TypeShade compilation.`,
          TS_CODES.MISSING_DIRECTIVE,
        ),
      )
    }
    return empty
  }

  // A file TypeScript could not parse is not lowered. The tree it hands back is the parser's
  // recovery, not the author's program: lowering it produced a cascade of misleading TypeShade
  // diagnostics at best and, for `vec4(3.14`, a clean WGSL emit at worst. Its parse errors are
  // the whole answer.
  const syntax = syntaxDiagnostics(sourceFile)
  if (syntax.length > 0) {
    diagnostics.push(...syntax)
    return { ...empty, hasDirective: true }
  }

  analyzeSemantics(sourceFile, diagnostics)
  const structs = collectStructs(sourceFile, diagnostics, symbols)
  const bindings = collectBindings(sourceFile, diagnostics, symbols)
  const consts = collectModuleConsts(sourceFile, diagnostics, symbols)
  const funcs = lowerSourceFunctions(
    sourceFile,
    diagnostics,
    consts,
    bindings,
    structs.map((s) => s.decl),
    symbols,
  )
  let wgsl: string | undefined
  const shouldEmit = options.emit ?? true
  if (shouldEmit && funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitModule({
        consts: [...consts],
        structs: structs.map((s) => s.decl),
        bindings: [...bindings],
        funcs: [...funcs],
      })
    } catch (e) {
      // No fallback to emitFuncs(funcs): it emits the functions without the consts, structs
      // and bindings they reference, which is not this module's WGSL. The throw is the answer.
      diagnostics.push(backendDiagnostic(sourceFile, e))
    }
  }

  return {
    hasDirective: true,
    funcs,
    diagnostics,
    sourceFile,
    consts,
    bindings,
    structs,
    symbols,
    wgsl,
  }
}

/** Return whether a TypeScript source string opts into TypeShade with the "use typeshade" directive. */
export function isTypeshadeSource(source: string, fileName = 'check.ts'): boolean {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  return hasUseTypeshadeDirective(sf)
}
