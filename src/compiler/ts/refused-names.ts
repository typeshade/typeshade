// === A name whose declaration was already refused says nothing more (Rule 12.4, #171) ===
//
// A declaration the front end refuses binds no name: `const y: f32 = g(x)` with a mismatched
// argument, `declare const x: f32` (not a binding type), a top-level `let x: uniform<f32>`,
// `const r = g(x)` with a missing argument. Every later read of the name then reached the
// "Unknown identifier" branch, so one mistake read as the refusal plus one more diagnostic per
// use, each naming a symbol the author did declare. A person skips them; a coding agent fixes
// them, by declaring the name a second time.
//
// The rule here is rustc's `ErrorGuaranteed` in miniature: a report is dropped only when an
// ERROR already stands inside the declaration the name resolves to. That is checked, not
// assumed, so a path that dropped a name without saying why still reports every use of it —
// the silent version of this bug would be a statement quietly missing from a function whose
// module then compiled.
//
// Which declaration a name resolves to follows TypeScript's own lexical rule: the innermost
// enclosing block, loop header or parameter list that declares it before the use, then the
// file's top level, where order does not matter. A name declared in a sibling block, or read
// before its declaration in the same block, is not found, and stays "Unknown identifier".

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'

/** A half-open `[start, end)` UTF-16 range in the file. */
interface Range {
  readonly start: number
  readonly end: number
}

const rangeOf = (node: ts.Node, sourceFile: ts.SourceFile): Range => ({
  start: node.getStart(sourceFile),
  end: node.getEnd(),
})

/** The range of the statement that declares `name` among `statements`, when one does. With
 *  `before` set, only a statement that ends before it counts (a block's `let` and `const` are
 *  not visible above their declaration). */
function declaringStatement(
  statements: readonly ts.Statement[],
  name: string,
  sourceFile: ts.SourceFile,
  before?: number,
): Range | undefined {
  for (const s of statements) {
    if (before !== undefined && s.getEnd() > before) continue
    if (!ts.isVariableStatement(s)) continue
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name) return rangeOf(s, sourceFile)
    }
  }
  return undefined
}

function declaringList(
  list: ts.ForInitializer | undefined,
  name: string,
  sourceFile: ts.SourceFile,
): Range | undefined {
  if (list === undefined || !ts.isVariableDeclarationList(list)) return undefined
  for (const d of list.declarations) {
    if (ts.isIdentifier(d.name) && d.name.text === name) return rangeOf(list, sourceFile)
  }
  return undefined
}

/** The declaration of `name` visible at `use`, innermost scope first. */
function visibleDeclaration(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): Range | undefined {
  const at = use.getStart(sourceFile)
  for (let p: ts.Node | undefined = use.parent; p !== undefined; p = p.parent) {
    let found: Range | undefined
    if (ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      found = declaringStatement(p.statements, name, sourceFile, at)
    } else if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) {
      found = declaringList(p.initializer, name, sourceFile)
    } else if (ts.isFunctionLike(p)) {
      const param = p.parameters.find((q) => ts.isIdentifier(q.name) && q.name.text === name)
      if (param !== undefined) found = rangeOf(param, sourceFile)
    } else if (ts.isSourceFile(p)) {
      found = declaringStatement(p.statements, name, sourceFile)
    }
    if (found !== undefined) return found
  }
  return undefined
}

const hasErrorWithin = (
  range: Range,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean =>
  diagnostics.some(
    (d) =>
      d.category === 'error' &&
      d.fileName === sourceFile.fileName &&
      d.start >= range.start &&
      d.start + d.length <= range.end,
  )

/**
 * Whether a report that `name` (read at `use`) is unknown would only repeat a diagnostic that
 * already stands: either the declaration `name` resolves to holds an error, so the declaration
 * was refused and said why, or an error already covers exactly `use`'s own span (the host-API
 * refusal of `Date` is `TS8012` on the very identifier an "Unknown identifier" would name).
 */
export function unknownNameAlreadyReported(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean {
  if (hasErrorWithin(rangeOf(use, sourceFile), sourceFile, diagnostics)) return true
  const declaration = visibleDeclaration(use, name, sourceFile)
  return declaration !== undefined && hasErrorWithin(declaration, sourceFile, diagnostics)
}
