// === TypeShade source compiler entry point ===

import ts from 'typescript'
import type { ConstDecl, FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js'
import {
  findUseTypeshadeDirective,
  hasUseTypeshadeDirective,
  USE_TYPESHADE,
} from './directive.js'
import { lowerSourceFunctions } from './lower/function.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { TS_CODES } from './codes.js'

export interface CompileTsSourceOptions {
  readonly fileName?: string
  readonly requireDirective?: boolean
}

export interface TsCompilerDiagnostic {
  readonly message: string
  readonly fileName: string
  readonly line: number
  readonly character: number
  readonly category: 'error' | 'warning' | 'message'
  readonly code?: string
}

export interface CompileTsSourceResult {
  readonly hasDirective: boolean
  readonly funcs: readonly FuncDecl[]
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  readonly sourceFile: ts.SourceFile
  readonly consts: readonly ConstDecl[]
  readonly wgsl?: string
}

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

  if (!hasDirective) {
    if (options.requireDirective) {
      diagnostics.push({
        message: `Missing "${USE_TYPESHADE}" directive. Add "${USE_TYPESHADE}"; at the top level to mark this file for TypeShade compilation.`,
        fileName,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.MISSING_DIRECTIVE,
      })
    }
    return { hasDirective: false, funcs: [], diagnostics, sourceFile, consts: [] }
  }

  analyzeSemantics(sourceFile, diagnostics)
  const consts = collectModuleConsts(sourceFile, diagnostics)
  const funcs = lowerSourceFunctions(sourceFile, diagnostics, consts)
  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl =
        consts.length > 0
          ? emitModule({ consts, structs: [], bindings: [], funcs: [...funcs] })
          : emitFuncs(funcs)
    } catch (e) {
      diagnostics.push({
        message: `Backend emit failed: ${e instanceof Error ? e.message : String(e)}`,
        fileName,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.BACKEND,
      })
    }
  }

  return { hasDirective: true, funcs, diagnostics, sourceFile, consts, wgsl }
}

export function isTypeshadeSource(source: string, fileName = 'check.ts'): boolean {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  return hasUseTypeshadeDirective(sf)
}
