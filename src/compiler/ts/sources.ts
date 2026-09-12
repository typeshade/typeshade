import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js'
import type { CompileTsSourceResult, TsCompilerDiagnostic } from './source-file.js'
import { findUseTypeshadeDirective, USE_TYPESHADE } from './directive.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { fillFunctionBody, parseSignature } from './lower/function.js'
import { TS_CODES } from './codes.js'

export interface CompileTsSourcesOptions {
  readonly entry?: string
}

function normalizeFile(spec: string): string {
  let s = spec.replace(/\\/g, '/')
  if (s.startsWith('./')) s = s.slice(2)
  if (s.endsWith('.js')) s = s.slice(0, -3) + '.ts'
  if (!s.endsWith('.ts')) s += '.ts'
  return s
}

function isExported(fn: ts.FunctionDeclaration): boolean {
  return !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
}

function parseFile(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function err(fileName: string, message: string): TsCompilerDiagnostic {
  return { message, fileName, line: 1, character: 1, category: 'error', code: TS_CODES.UNSUPPORTED }
}

function fileStubs(
  sf: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration }> {
  const out = new Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration }>()
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt)) continue
    const stub = parseSignature(stmt, sf, diagnostics)
    if (!stub) continue
    out.set(stub.name, { stub, node: stmt })
  }
  return out
}

function importsOf(
  sf: ts.SourceFile,
  fileName: string,
  exports: ReadonlyMap<string, Map<string, FuncDecl>>,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, FuncDecl> {
  const imported = new Map<string, FuncDecl>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      diagnostics.push(err(fileName, 'Imports must be named bindings from a string path.'))
      continue
    }
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.')) {
      diagnostics.push(err(fileName, `Only relative imports are supported (got "${spec}").`))
      continue
    }
    const target = normalizeFile(spec)
    const bag = exports.get(target)
    if (!bag) {
      diagnostics.push(err(fileName, `Cannot resolve "${spec}" to a "use typeshade" file.`))
      continue
    }
    const named = stmt.importClause.namedBindings
    if (!named || !ts.isNamedImports(named)) {
      diagnostics.push(err(fileName, 'Only named imports are supported: import { name } from "./file".'))
      continue
    }
    for (const el of named.elements) {
      const remote = el.propertyName?.text ?? el.name.text
      const hit = bag.get(remote)
      if (!hit) {
        diagnostics.push(err(fileName, `"${remote}" is not an exported function in ${target}.`))
        continue
      }
      imported.set(el.name.text, hit)
    }
  }
  return imported
}

export function compileTsSources(
  files: Readonly<Record<string, string>>,
  options: CompileTsSourcesOptions = {},
): CompileTsSourceResult {
  const names = Object.keys(files)
  const emptySf = parseFile('empty.ts', '')
  if (names.length === 0) {
    return { hasDirective: false, funcs: [], diagnostics: [], sourceFile: emptySf, consts: [] }
  }
  const diagnostics: TsCompilerDiagnostic[] = []
  const parsed = new Map<string, ts.SourceFile>()
  for (const raw of names) parsed.set(normalizeFile(raw), parseFile(normalizeFile(raw), files[raw]!))
  const entry = options.entry ? normalizeFile(options.entry) : [...parsed.keys()][0]!

  const stubs = new Map<string, Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration }>>()
  for (const [name, sf] of parsed) {
    if (!findUseTypeshadeDirective(sf)) {
      diagnostics.push({
        message: `Missing "${USE_TYPESHADE}" in ${name}.`,
        fileName: name,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.MISSING_DIRECTIVE,
      })
      continue
    }
    analyzeSemantics(sf, diagnostics)
    stubs.set(name, fileStubs(sf, diagnostics))
  }

  const exported = new Map<string, Map<string, FuncDecl>>()
  for (const [name, bag] of stubs) {
    const exp = new Map<string, FuncDecl>()
    for (const [fnName, rec] of bag) {
      if (isExported(rec.node)) exp.set(fnName, rec.stub)
    }
    exported.set(name, exp)
  }

  const entrySf = parsed.get(entry)
  if (!entrySf) {
    diagnostics.push(err(entry, `Entry "${entry}" is not in the source set.`))
    return { hasDirective: false, funcs: [], diagnostics, sourceFile: emptySf, consts: [] }
  }

  for (const [name, sf] of parsed) {
    const bag = stubs.get(name)
    if (!bag) continue
    const imported = importsOf(sf, name, exported, diagnostics)
    const callees = new Map<string, FuncDecl>(imported)
    for (const [fnName, rec] of bag) callees.set(fnName, rec.stub)
    for (const rec of bag.values()) fillFunctionBody(rec.node, rec.stub, sf, diagnostics, callees)
  }

  const consts = collectModuleConsts(entrySf, diagnostics)
  const entryBag = stubs.get(entry) ?? new Map()
  const imported = importsOf(entrySf, entry, exported, diagnostics)
  const funcs: FuncDecl[] = []
  const seen = new Set<string>()
  for (const stub of imported.values()) {
    if (seen.has(stub.name)) continue
    funcs.push(stub)
    seen.add(stub.name)
  }
  for (const rec of entryBag.values()) {
    if (seen.has(rec.stub.name)) continue
    funcs.push(rec.stub)
    seen.add(rec.stub.name)
  }

  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl =
        consts.length > 0
          ? emitModule({ consts, structs: [], bindings: [], funcs })
          : emitFuncs(funcs)
    } catch (e) {
      diagnostics.push({
        message: `Backend emit failed: ${e instanceof Error ? e.message : String(e)}`,
        fileName: entry,
        line: 1,
        character: 1,
        category: 'error',
        code: TS_CODES.BACKEND,
      })
    }
  }

  return { hasDirective: true, funcs, diagnostics, sourceFile: entrySf, consts, wgsl }
}
