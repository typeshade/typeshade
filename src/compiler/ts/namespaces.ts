// === `namespace` (roadmap 0.3 item T4, design #92, §26) ===
//
// A namespace is a named group of functions and constants, which is a shape the module already
// has: the members flatten to `Ns_member`, the same joining a class's method (`Ray_at`) and a
// class's static field (`K_PI`) already take. Nesting flattens transitively, so a member of
// `namespace A { export namespace B { ... } }` is `A_B_member`.
//
// What a namespace holds is what the module can hold: functions, constants and more
// namespaces. A variable, a class or an enum inside one is refused with the reason, because
// each of those already has a module-level home and giving it a second one would mean two
// spellings of one thing.

import ts from 'typescript'
import type { TsCompilerDiagnostic } from './source-file.js'
import { makeDiagnostic } from './diagnostic.js'
import { TS_CODES } from './codes.js'

/** The joining every flattened member takes: `Palette.warm` is `Palette_warm`. */
export const namespaceMemberName = (prefix: string, member: string): string => `${prefix}_${member}`

/** One statement found inside a namespace, with the prefix its emitted name takes. */
export interface NamespaceMember<T extends ts.Statement> {
  readonly prefix: string
  readonly node: T
}

/** The namespace's own name, or undefined for a shape this surface does not take: a string
 *  name (`namespace "a.b"`), a `declare` namespace, or a body that is not a block. */
function namespaceName(stmt: ts.ModuleDeclaration): string | undefined {
  if (!ts.isIdentifier(stmt.name)) return undefined
  return stmt.name.text
}

/** Walks `statements` and every namespace inside them, calling `see` for each statement with
 *  the prefix it carries (the empty string at the top level).
 *
 *  A namespace declaration is walked; every other statement is handed to `see` as it is. A
 *  shape the namespace cannot hold reports here, once, naming what to write instead. */
export function eachNamespaceStatement(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  see: (stmt: ts.Statement, prefix: string) => void,
  prefix = '',
): void {
  for (const stmt of statements) {
    if (!ts.isModuleDeclaration(stmt)) {
      see(stmt, prefix)
      continue
    }
    const name = namespaceName(stmt)
    if (name === undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          stmt.name,
          `A namespace is declared with a plain name, "namespace Palette { ... }".`,
          TS_CODES.TOP_LEVEL,
        ),
      )
      continue
    }
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          stmt.name,
          `"declare namespace ${name}" has no members to emit; declare the namespace in this file.`,
          TS_CODES.TOP_LEVEL,
        ),
      )
      continue
    }
    const inner = prefix === '' ? name : namespaceMemberName(prefix, name)
    const body = stmt.body
    if (body === undefined) continue
    if (!ts.isModuleBlock(body)) {
      // `namespace A.B { ... }` parses as a namespace whose body is the next one; both
      // spellings reach the same flattening.
      if (ts.isModuleDeclaration(body)) {
        eachNamespaceStatement([body], sourceFile, diagnostics, see, inner)
      }
      continue
    }
    eachNamespaceStatement(body.statements, sourceFile, diagnostics, see, inner)
  }
}

/** Reports a statement a namespace cannot hold. Called by the collectors, each of which knows
 *  which statements are its own. */
export function refuseNamespaceStatement(
  stmt: ts.Statement,
  prefix: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const what = ts.isClassDeclaration(stmt)
    ? 'a class'
    : ts.isEnumDeclaration(stmt)
      ? 'an enum'
      : ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
        ? 'a type'
        : ts.isVariableStatement(stmt)
          ? 'a variable'
          : 'this'
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      stmt,
      `A namespace holds functions, constants and namespaces; ${what} inside "${prefix}" has ` +
        `no flattened form. Declare it at the top level of the file.`,
      TS_CODES.TOP_LEVEL,
    ),
  )
}
