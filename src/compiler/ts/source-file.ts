// ═══ TypeShade source compiler entry point (Phase 1) ═══
//
// TypeScript Source
//       ↓
// TS SourceFile
//       ↓
// "use typeshade" 확인
//       ↓
// TypeShade compilation unit (later phases produce FuncDecl[])
//
// Files that lack the directive are treated as ordinary TypeScript and
// produce an empty result. This module is the only public entry for the
// source-compiler path; later phases (type mapping, expression/statement/
// function lowering) plug in behind compileTsSource.

import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import {
  findUseTypeshadeDirective,
  hasUseTypeshadeDirective,
  USE_TYPESHADE,
} from './directive.js'

/** Options accepted by {@link compileTsSource}. */
export interface CompileTsSourceOptions {
  /** Virtual file name used for diagnostics and SourceFile identity. */
  readonly fileName?: string
  /**
   * When true, throw if the source does not contain `"use typeshade";`.
   * Default: false (silent empty result).
   */
  readonly requireDirective?: boolean
}

/** Diagnostic produced by the source compiler (Phase 1 surface). */
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
  /**
   * Functions lowered from the source.
   * Phase 1 always returns an empty array; later phases fill this.
   */
  readonly funcs: readonly FuncDecl[]
  /** Diagnostics collected while processing the source. */
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  /** The parsed TypeScript SourceFile (useful for later phases / tooling). */
  readonly sourceFile: ts.SourceFile
}

/**
 * Parse a TypeScript source string and, when it contains `"use typeshade";`,
 * prepare it as a TypeShade compilation unit.
 *
 * Phase 1 responsibilities only:
 *   1. Create a SourceFile from the text.
 *   2. Detect the `"use typeshade";` directive.
 *   3. Return a structured result (empty funcs for now).
 *
 * Later phases will walk the AST after the directive and lower eligible
 * function declarations into the existing TypeShade IR (`FuncDecl`).
 *
 * @example
 * ```ts
 * const result = compileTsSource(`
 *   "use typeshade";
 *   export function add(a: f32, b: f32): f32 {
 *     return a + b;
 *   }
 * `)
 * // result.hasDirective === true
 * // result.funcs === []          // filled in Phase 5+
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

  // Phase 1 stops here. The directive is present; later phases will lower
  // the remaining top-level FunctionDeclarations into FuncDecl[].
  return {
    hasDirective: true,
    funcs: [],
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
