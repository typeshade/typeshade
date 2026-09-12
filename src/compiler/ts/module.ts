// Multi-file "use typeshade" program: relative import { name } from "./file"

import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs } from '../../core/backends/wgsl.js'
import { hasUseTypeshadeDirective } from './directive.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { fillFunctionBody, parseSignature } from './lower/function.js'

export interface TsSourceFileInput {
  readonly fileName: string
  readonly source: string
}

export interface CompileTsSourcesResult {
  readonly funcs: readonly FuncDecl[]
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  readonly wgsl?: string
}

function normalizePath(p: string): string {
  const parts: string[] = []
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function resolveSpecifier(fromFile: string, spec: string): string {
  const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
  let target = spec.startsWith('.') ? (dir ? `${dir}/${spec}` : spec) : spec
  if (!target.endsWith('.ts')) target += '.ts'
  return normalizePath(target)
}

export function compileTsSources(
  files: readonly TsSourceFileInput[],
  entry?: string,
): CompileTsSourcesResult {
  const diagnostics: TsCompilerDiagnostic[] = []
  const parsed = new Map<string, ts.SourceFile>()
  const exports = new Map<string, Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }>>()

  for (const f of files) {
    const name = normalizePath(f.fileName)
    const sf = ts.createSourceFile(name, f.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    parsed.set(name, sf)
    if (!hasUseTypeshadeDirective(sf)) {
      diagnostics.push({
        message: `File "${name}" is missing "use typeshade".`,
        fileName: name,
        line: 1,
        character: 1,
        category: 'error',
      })
    }
  }

  for (const [name, sf] of parsed) {
    const table = new Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }>()
    for (const stmt of sf.statements) {
      if (!ts.isFunctionDeclaration(stmt)) continue
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      const stub = parseSignature(stmt, sf, diagnostics)
      if (!stub) continue
      if (table.has(stub.name)) {
        diagnostics.push({
          message: `Duplicate function "${stub.name}" in "${name}".`,
          fileName: name,
          line: 1,
          character: 1,
          category: 'error',
        })
        continue
      }
      table.set(stub.name, { stub, node: stmt, sf })
      ;(stub as { exported?: boolean }).exported = exported
    }
    exports.set(name, table)
  }

  const fileCallees = new Map<string, Map<string, FuncDecl>>()
  for (const [name, table] of exports) {
    const callees = new Map<string, FuncDecl>()
    for (const [fn, rec] of table) callees.set(fn, rec.stub)
    fileCallees.set(name, callees)
  }

  for (const [name, sf] of parsed) {
    const callees = fileCallees.get(name)!
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) continue
      if (!stmt.importClause || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) {
        diagnostics.push({
          message: 'Import must be `import { name } from "./file"`.',
          fileName: name,
          line: 1,
          character: 1,
          category: 'error',
        })
        continue
      }
      const spec = stmt.moduleSpecifier.text
      if (!spec.startsWith('.')) {
        diagnostics.push({
          message: `Only relative imports are supported (got "${spec}").`,
          fileName: name,
          line: 1,
          character: 1,
          category: 'error',
        })
        continue
      }
      const target = resolveSpecifier(name, spec)
      const targetTable = exports.get(target)
      if (!targetTable) {
        diagnostics.push({
          message: `Cannot resolve import "${spec}" from "${name}" (looked for "${target}").`,
          fileName: name,
          line: 1,
          character: 1,
          category: 'error',
        })
        continue
      }
      const bindings = stmt.importClause.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) {
        diagnostics.push({
          message: 'Default / namespace import is not supported. Use `import { name } from "./file"`.',
          fileName: name,
          line: 1,
          character: 1,
          category: 'error',
        })
        continue
      }
      for (const el of bindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text
        const local = el.name.text
        const rec = targetTable.get(imported)
        if (!rec) {
          diagnostics.push({
            message: `"${target}" has no function "${imported}".`,
            fileName: name,
            line: 1,
            character: 1,
            category: 'error',
          })
          continue
        }
        if (rec.stub && (rec.stub as { exported?: boolean }).exported === false) {
          diagnostics.push({
            message: `"${imported}" is not exported from "${target}".`,
            fileName: name,
            line: 1,
            character: 1,
            category: 'error',
          })
          continue
        }
        callees.set(local, rec.stub)
      }
    }
  }

  const funcs: FuncDecl[] = []
  for (const [name, table] of exports) {
    const callees = fileCallees.get(name)!
    for (const rec of table.values()) {
      fillFunctionBody(rec.node, rec.stub, rec.sf, diagnostics, callees)
      funcs.push(rec.stub)
    }
  }
  void entry

  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitFuncs(funcs)
    } catch (e) {
      diagnostics.push({
        message: `Backend emit failed: ${e instanceof Error ? e.message : String(e)}`,
        fileName: entry ?? files[0]?.fileName ?? 'typeshade',
        line: 1,
        character: 1,
        category: 'error',
      })
    }
  }
  return { funcs, diagnostics, wgsl }
}
