// Multi-file "use typeshade" program: relative import { name } from "./file"

import ts from 'typescript'
import type { FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs } from '../../core/backends/wgsl.js'
import { hasUseTypeshadeDirective } from './directive.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { fillFunctionBody, parseSignature } from './lower/function.js'
import { TS_CODES } from './codes.js'
import { checkRecursion, type RecursionNode } from './recursion.js'
import { backendDiagnostic, makeDiagnostic, syntaxDiagnostics } from './diagnostic.js'
import type { DeclaredSymbol } from './symbols.js'

export interface TsSourceFileInput {
  readonly fileName: string
  readonly source: string
}

export interface CompileTsSourcesResult {
  readonly funcs: readonly FuncDecl[]
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  /** What the front end declared while lowering the ENTRY file (`entry`, or the first file
   *  given), as `CompileTsSourceResult.symbols` records it. One file only: a `DeclaredSymbol`
   *  span is a UTF-16 offset, which means nothing without the file it indexes, and this result
   *  names no source file. Empty when nothing was lowered. */
  readonly symbols: readonly DeclaredSymbol[]
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
  const symbols: DeclaredSymbol[] = []
  const parsed = new Map<string, ts.SourceFile>()
  const exports = new Map<
    string,
    Map<string, { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }>
  >()

  for (const f of files) {
    const name = normalizePath(f.fileName)
    const sf = ts.createSourceFile(name, f.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    parsed.set(name, sf)
    if (!hasUseTypeshadeDirective(sf)) {
      diagnostics.push(
        makeDiagnostic(
          sf,
          undefined,
          `File "${name}" is missing "use typeshade".`,
          TS_CODES.MISSING_DIRECTIVE,
        ),
      )
    }
  }

  // A file TypeScript could not parse takes the whole program down: nothing is lowered or
  // emitted, and the parse errors, each naming its file, are the diagnostics (see
  // `compileTsSource`).
  const syntax = [...parsed.values()].flatMap((sf) => syntaxDiagnostics(sf))
  if (syntax.length > 0) {
    diagnostics.push(...syntax)
    return { funcs: [], diagnostics, symbols }
  }

  for (const [name, sf] of parsed) {
    const table = new Map<
      string,
      { stub: FuncDecl; node: ts.FunctionDeclaration; sf: ts.SourceFile }
    >()
    for (const stmt of sf.statements) {
      if (!ts.isFunctionDeclaration(stmt)) continue
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
      const stub = parseSignature(stmt, sf, diagnostics)
      if (!stub) continue
      if (table.has(stub.name)) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            `Duplicate function "${stub.name}" in "${name}".`,
            TS_CODES.DUPLICATE_SYMBOL,
          ),
        )
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
      if (
        !stmt.importClause ||
        !stmt.moduleSpecifier ||
        !ts.isStringLiteral(stmt.moduleSpecifier)
      ) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            'Import must be `import { name } from "./file"`.',
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
      const target = resolveSpecifier(name, spec)
      const targetTable = exports.get(target)
      if (!targetTable) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            `Cannot resolve import "${spec}" from "${name}" (looked for "${target}").`,
            TS_CODES.UNSUPPORTED,
          ),
        )
        continue
      }
      const bindings = stmt.importClause.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) {
        diagnostics.push(
          makeDiagnostic(
            sf,
            stmt,
            'Default / namespace import is not supported. Use `import { name } from "./file"`.',
            TS_CODES.UNSUPPORTED,
          ),
        )
        continue
      }
      for (const el of bindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text
        const local = el.name.text
        const rec = targetTable.get(imported)
        if (!rec) {
          diagnostics.push(
            makeDiagnostic(
              sf,
              el,
              `"${target}" has no function "${imported}".`,
              TS_CODES.UNSUPPORTED,
            ),
          )
          continue
        }
        if (rec.stub && (rec.stub as { exported?: boolean }).exported === false) {
          diagnostics.push(
            makeDiagnostic(
              sf,
              el,
              `"${imported}" is not exported from "${target}".`,
              TS_CODES.UNSUPPORTED,
            ),
          )
          continue
        }
        callees.set(local, rec.stub)
      }
    }
  }

  const funcs: FuncDecl[] = []
  const graph: RecursionNode[] = []
  // Only the entry file feeds the symbol table, since a span alone cannot say which file it
  // indexes. `parsed` is keyed by `normalizePath`, so the caller's spelling of `entry` has to be
  // normalized before it is looked up: `'./main.ts'` and `'main.ts'` name the same file, and
  // handing back another file's offsets for one of the two spellings is the exact hazard the
  // one-file rule exists to prevent. (The emit-failure anchor below keeps its own pre-existing
  // raw-`entry` lookup; changing which file an emit failure is reported against is not this
  // change's business.)
  const normalizedEntry = entry !== undefined ? normalizePath(entry) : undefined
  const symbolFile =
    (normalizedEntry !== undefined && parsed.has(normalizedEntry) ? normalizedEntry : undefined) ??
    [...parsed.keys()][0]
  for (const [name, table] of exports) {
    const callees = fileCallees.get(name)!
    for (const rec of table.values()) {
      // Positional: `fillFunctionBody`'s consts/bindings/structs keep their defaults here.
      const sink = name === symbolFile ? symbols : undefined
      fillFunctionBody(
        rec.node,
        rec.stub,
        rec.sf,
        diagnostics,
        callees,
        undefined,
        undefined,
        undefined,
        sink,
      )
      funcs.push(rec.stub)
      // The graph key is the EMITTED name, not the local one: across files the same function
      // reaches its callers under whatever name each `import` bound it to, and a cycle is a
      // cycle in the emitted WGSL. `callees` is already that mapping, per file.
      graph.push({
        name: rec.stub.name,
        decl: rec.node,
        sourceFile: rec.sf,
        resolve: (callee: string) => callees.get(callee)?.name,
      })
    }
  }
  // A call cycle emits WGSL Tint refuses (#48). Across files it can be spelled through an
  // import, which is exactly why the resolver above goes through `callees`.
  checkRecursion(graph, diagnostics)
  void entry

  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      wgsl = emitFuncs(funcs)
    } catch (e) {
      const anchor =
        (entry ? parsed.get(entry) : undefined) ??
        [...parsed.values()][0] ??
        ts.createSourceFile(
          files[0]?.fileName ?? 'typeshade',
          '',
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        )
      diagnostics.push(backendDiagnostic(anchor, e))
    }
  }
  return { funcs, diagnostics, symbols, wgsl }
}
