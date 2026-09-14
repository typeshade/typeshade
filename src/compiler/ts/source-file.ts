// === TypeShade source compiler entry point ===

import ts from 'typescript'
import type { BindingDecl, ConstDecl, FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js'
import { findUseTypeshadeDirective, hasUseTypeshadeDirective, USE_TYPESHADE } from './directive.js'
import { lowerSourceFunctions } from './lower/function.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { collectBindings } from './bindings.js'
import { collectStructs, type CollectedStruct } from './structs.js'
import { TS_CODES } from './codes.js'
import { makeDiagnostic } from './diagnostic.js'

/** Options controlling compilation of a TypeShade TypeScript source string. */
export interface CompileTsSourceOptions {
  readonly fileName?: string
  readonly requireDirective?: boolean
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
  readonly wgsl?: string
}

/** Compile a TypeScript source string through the TypeShade authoring pipeline. */
export function compileTsSource(
  source: string,
  options: CompileTsSourceOptions = {},
): CompileTsSourceResult {
  const fileName = options.fileName ?? 'typeshade-input.ts'
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const diagnostics: TsCompilerDiagnostic[] = []
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
  }

  if (!hasDirective) {
    if (options.requireDirective) {
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

  analyzeSemantics(sourceFile, diagnostics)
  const structs = collectStructs(sourceFile, diagnostics)
  const bindings = collectBindings(sourceFile, diagnostics)
  const consts = collectModuleConsts(sourceFile, diagnostics)
  const funcs = lowerSourceFunctions(
    sourceFile,
    diagnostics,
    consts,
    bindings,
    structs.map((s) => s.decl),
  )
  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitModule({
        consts: [...consts],
        structs: structs.map((s) => s.decl),
        bindings: [...bindings],
        funcs: [...funcs],
      })
    } catch {
      try {
        wgsl = emitFuncs(funcs)
      } catch (e) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            undefined,
            `Backend emit failed: ${e instanceof Error ? e.message : String(e)}`,
            TS_CODES.BACKEND,
          ),
        )
      }
    }
  }

  return { hasDirective: true, funcs, diagnostics, sourceFile, consts, bindings, structs, wgsl }
}

/** Return whether a TypeScript source string opts into TypeShade with the "use typeshade" directive. */
export function isTypeshadeSource(source: string, fileName = 'check.ts'): boolean {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  return hasUseTypeshadeDirective(sf)
}
