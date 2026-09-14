import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js'
import type { CompileTsSourceResult, TsCompilerDiagnostic } from './source-file.js'
import { findUseTypeshadeDirective, USE_TYPESHADE } from './directive.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { fillFunctionBody, parseSignature } from './lower/function.js'
import { TS_CODES } from './codes.js'
import { backendDiagnostic, makeDiagnostic, syntaxDiagnostics } from './diagnostic.js'
import type { DeclaredSymbol } from './symbols.js'

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

function err(sourceFile: ts.SourceFile, message: string): TsCompilerDiagnostic {
  return makeDiagnostic(sourceFile, undefined, message, TS_CODES.UNSUPPORTED)
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
  exports: ReadonlyMap<string, Map<string, FuncDecl>>,
  diagnostics: TsCompilerDiagnostic[],
): Map<string, FuncDecl> {
  const imported = new Map<string, FuncDecl>()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          stmt,
          'Imports must be named bindings from a string path.',
          TS_CODES.UNSUPPORTED,
        ),
      )
      continue
    }
    const spec = stmt.moduleSpecifier.text
    if (!spec.startsWith('.')) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          stmt,
          `Only relative imports are supported (got "${spec}").`,
          TS_CODES.UNSUPPORTED,
        ),
      )
      continue
    }
    const target = normalizeFile(spec)
    const bag = exports.get(target)
    if (!bag) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          stmt,
          `Cannot resolve "${spec}" to a "use typeshade" file.`,
          TS_CODES.UNSUPPORTED,
        ),
      )
      continue
    }
    const named = stmt.importClause.namedBindings
    if (!named || !ts.isNamedImports(named)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          stmt,
          'Only named imports are supported: import { name } from "./file".',
          TS_CODES.UNSUPPORTED,
        ),
      )
      continue
    }
    for (const el of named.elements) {
      const remote = el.propertyName?.text ?? el.name.text
      const hit = bag.get(remote)
      if (!hit) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            el,
            `"${remote}" is not an exported function in ${target}.`,
            TS_CODES.UNSUPPORTED,
          ),
        )
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
    return {
      hasDirective: false,
      funcs: [],
      diagnostics: [],
      sourceFile: emptySf,
      consts: [],
      bindings: [],
      structs: [],
      symbols: [],
    }
  }
  const diagnostics: TsCompilerDiagnostic[] = []
  // `symbols` spans index `sourceFile`, the entry file, so only the entry file is recorded.
  const symbols: DeclaredSymbol[] = []
  const parsed = new Map<string, ts.SourceFile>()
  for (const raw of names)
    parsed.set(normalizeFile(raw), parseFile(normalizeFile(raw), files[raw]!))
  const entry = options.entry ? normalizeFile(options.entry) : [...parsed.keys()][0]!

  // A file TypeScript could not parse takes the whole set down: nothing is lowered or emitted,
  // and the parse errors, each naming its file, are the diagnostics (see `compileTsSource`).
  const syntax = [...parsed.values()].flatMap((sf) => syntaxDiagnostics(sf))
  if (syntax.length > 0) {
    diagnostics.push(...syntax)
    const entryFile = parsed.get(entry)
    return {
      hasDirective: entryFile !== undefined && findUseTypeshadeDirective(entryFile) !== undefined,
      funcs: [],
      diagnostics,
      sourceFile: entryFile ?? emptySf,
      consts: [],
      bindings: [],
      structs: [],
      symbols,
    }
  }

  const stubs = new Map<string, Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration }>>()
  for (const [name, sf] of parsed) {
    if (!findUseTypeshadeDirective(sf)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          undefined,
          `Missing "${USE_TYPESHADE}" in ${name}.`,
          TS_CODES.MISSING_DIRECTIVE,
        ),
      )
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
    diagnostics.push(err(parseFile(entry, ''), `Entry "${entry}" is not in the source set.`))
    return {
      hasDirective: false,
      funcs: [],
      diagnostics,
      sourceFile: emptySf,
      consts: [],
      bindings: [],
      structs: [],
      symbols,
    }
  }

  for (const [name, sf] of parsed) {
    const bag = stubs.get(name)
    if (!bag) continue
    const imported = importsOf(sf, exported, diagnostics)
    const callees = new Map<string, FuncDecl>(imported)
    for (const [fnName, rec] of bag) callees.set(fnName, rec.stub)
    // Positional: `fillFunctionBody`'s consts/bindings/structs keep their defaults here.
    const sink = name === entry ? symbols : undefined
    for (const rec of bag.values())
      fillFunctionBody(
        rec.node,
        rec.stub,
        sf,
        diagnostics,
        callees,
        undefined,
        undefined,
        undefined,
        sink,
      )
  }

  const consts = collectModuleConsts(entrySf, diagnostics, symbols)
  const entryBag = stubs.get(entry) ?? new Map()
  const imported = importsOf(entrySf, exported, diagnostics)
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
      diagnostics.push(backendDiagnostic(entrySf, e))
    }
  }

  return {
    hasDirective: true,
    funcs,
    diagnostics,
    sourceFile: entrySf,
    consts,
    bindings: [],
    structs: [],
    symbols,
    wgsl,
  }
}
