// Multi-file "use typeshade" program: relative import { name } from "./file"

import ts from 'typescript'
import type { ConstDecl, FuncDecl } from '../../core/ir/nodes.js'
import { emitFuncs, emitModule } from '../../core/backends/wgsl.js'
import { hasUseTypeshadeDirective } from './directive.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import { fillFunctionBody, parseSignature } from './lower/function.js'
import { analyzeSemantics } from './semantic.js'
import { collectModuleConsts } from './module-const.js'
import { TS_CODES } from './codes.js'
import { backendDiagnostic, makeDiagnostic, syntaxDiagnostics } from './diagnostic.js'

export interface TsSourceFileInput {
  readonly fileName: string
  readonly source: string
}

export interface CompileTsSourcesResult {
  readonly funcs: readonly FuncDecl[]
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  /** Module constants declared in the ENTRY file. Collected per-entry, not per-file, because
   *  a `const` is module scope and the entry is the module: two files declaring `PI` are two
   *  modules that each have one, not one module with a duplicate. */
  readonly consts: readonly ConstDecl[]
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

/** Compile a set of `"use typeshade"` files into one WGSL module, resolving
 *  `import { name } from "./file"` between them.
 *
 *  `entry` names the file whose module constants are collected and whose position anchors a
 *  whole-module emit failure; it defaults to the first file given. Every function in every
 *  file is lowered and emitted regardless — a multi-file program is one module, and the entry
 *  selects module scope, not a reachability root. */
export function compileTsSources(
  files: readonly TsSourceFileInput[],
  entry?: string,
): CompileTsSourcesResult {
  const diagnostics: TsCompilerDiagnostic[] = []
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
    return { funcs: [], diagnostics, consts: [] }
  }

  for (const [name, sf] of parsed) {
    // The statement-level check `compileTsSource` runs on a single file (a top-level `let`,
    // an expression statement that is not the directive, and the rest). It was missing from
    // the multi-file path, so a construct rejected in a one-file program was accepted in a
    // two-file one — including in the documentation gate, which compiles every multi-file
    // fence in README.md and docs/ through this function.
    analyzeSemantics(sf, diagnostics)
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

  const entryName = entry === undefined ? [...parsed.keys()][0] : normalizePath(entry)
  const entrySf = entryName === undefined ? undefined : parsed.get(entryName)
  if (entry !== undefined && entrySf === undefined) {
    diagnostics.push(
      makeDiagnostic(
        [...parsed.values()][0] ?? emptySourceFile(files),
        undefined,
        `Entry "${entry}" is not in the source set.`,
        TS_CODES.UNSUPPORTED,
      ),
    )
  }

  // BEFORE the bodies are filled, not after. `fillFunctionBody` takes the module constants as
  // a parameter and defines each one in the lowering scope; collect them afterwards and every
  // reference to one inside a function is TS8022 "Unknown identifier". Both pre-merge
  // implementations had this order wrong — `sources.ts` collected them last too — so a
  // multi-file program simply could not use a module constant. The single-file path in
  // `source-file.ts` has always collected first, which is why it works there.
  const consts = entrySf ? collectModuleConsts(entrySf, diagnostics) : []

  const funcs: FuncDecl[] = []
  for (const [name, table] of exports) {
    const callees = fileCallees.get(name)!
    for (const rec of table.values()) {
      fillFunctionBody(rec.node, rec.stub, rec.sf, diagnostics, callees, consts)
      funcs.push(rec.stub)
    }
  }

  let wgsl: string | undefined
  if (funcs.length > 0 && !diagnostics.some((d) => d.category === 'error')) {
    try {
      // `emitModule` only when there is something for its other slots to hold. `emitFuncs` is
      // the bare-functions form the single-file path uses too, and switching unconditionally
      // would change the emitted text of every multi-file program that has no constants.
      wgsl =
        consts.length > 0
          ? emitModule({ consts, structs: [], bindings: [], funcs })
          : emitFuncs(funcs)
    } catch (e) {
      // `backendDiagnostic` (X-GIS #37's honest-failure work) rather than the message built
      // by hand here; the anchor is the resolved entry, which is what `entry` was already
      // being used for above.
      diagnostics.push(
        backendDiagnostic(entrySf ?? [...parsed.values()][0] ?? emptySourceFile(files), e),
      )
    }
  }
  return { funcs, diagnostics, consts, wgsl }
}

/** A diagnostic needs a source file to carry a position. With no parsable file left to point
 *  at — an empty `files` array — an empty one is the honest anchor. */
function emptySourceFile(files: readonly TsSourceFileInput[]): ts.SourceFile {
  return ts.createSourceFile(
    files[0]?.fileName ?? 'typeshade',
    '',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
}
