// === TypeShade source compiler entry point ===
//
// TypeScript Source
//       |
// TS SourceFile
//       |
// "use typeshade" check
//       |
// lowerSourceFunctions -> FuncDecl[]
//
// Files that lack the directive are ordinary TypeScript and produce an empty result.

import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import {
  findUseTypeshadeDirective,
  hasUseTypeshadeDirective,
  USE_TYPESHADE,
} from './directive.js'
import { lowerSourceFunctions } from './lower/function.js'

/** Options accepted by {@link compileTsSource}. */
export interface CompileTsSourceOptions {
  /** Virtual file name used for diagnostics and SourceFile identity. */
  readonly fileName?: string
  /**
   * When true, emit an error if the source does not contain `"use typeshade";`.
   * Default: false (silent empty result).
   */
  readonly requireDirective?: boolean
}

/** Diagnostic produced by the source compiler. */
export interface TsCompilerDiagnostic {
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly character: number
  readonly category: 'error' | 'warning' | 'message'
}

/** Result of {@link compileTsSource}. */
export interface CompileTsSourceResult {
  /** Whether the source contained a `"use typeshade";` directive. */
  readonly hasDirective: boolean
  /** Functions lowered from the source into existing TypeShade IR. */
  readonly funcs: readonly FuncDecl[]
  /** Diagnostics collected while processing the source. */
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  /** The parsed TypeScript SourceFile (useful for tooling). */
  readonly sourceFile: ts.SourceFile
}

/**
 * Parse a TypeScript source string and, when it contains `"use typeshade";`,
 * lower top-level functions into TypeShade {@link FuncDecl} IR.
 *
 * @example
 * ```ts
 * const result = compileTsSource(`
 *   "use typeshade";
 *   export function transform(a: f32, b: f32): f32 {
 *     const x = a + b;
 *     return x * 2;
 *   }
 * `)
 * // result.hasDirective === true
 * // result.funcs[0].name === 'transform'
 * ```
 */
export function compileTsSource(
  source: string,
  options: CompileTsSourceOptions = {},
): CompileTsSourceResult {
  const fileName = options.fileName ?? 'typeshade-input.ts'

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  )

  const diagnostics: TsCompilerDiagnostic[] = []
  const directive = findUseTypeshadeDirective(sourceFile)
  const hasDirective = directive !== undefined

  if (!hasDirective) {
    if (options.requireDirective) {
      diagnostics.push({
        message: `Missing "${USE_TYPESHADE}" directive. Add "${USE_TYPESHADE}"; at the top level to mark this file for TypeShade compilation.`,
        fileName,
        line: 1,
        character: 1,
        category: 'error',
      })
    }
    return {
      hasDirective: false,
      funcs: [],
      diagnostics,
      sourceFile,
    }
  }

  const funcs = lowerSourceFunctions(sourceFile, diagnostics)

  return {
    hasDirective: true,
    funcs,
    diagnostics,
    sourceFile,
  }
}

/**
 * Convenience predicate: true when the source text contains a top-level
 * `"use typeshade";` directive.
 */
export function isTypeshadeSource(source: string, fileName = 'check.ts'): boolean {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  )
  return hasUseTypeshadeDirective(sf)
}
