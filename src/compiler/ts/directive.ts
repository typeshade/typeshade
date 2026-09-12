// ═══ "use typeshade" directive detection ═══
//
// Phase 1: detect the directive that marks a TypeScript source file (or a
// top-level statement) as a TypeShade compilation unit.
//
// The directive is the string literal expression statement:
//
//   "use typeshade";
//
// It must appear as a top-level ExpressionStatement whose expression is a
// StringLiteral with the exact text "use typeshade". Leading/trailing
// whitespace inside the quotes is not accepted; case is significant.
//
// Files without the directive are ordinary TypeScript and are ignored by
// the TypeShade source compiler.

import ts from 'typescript'

/** The exact string the directive must carry. */
export const USE_TYPESHADE = 'use typeshade'

/**
 * Returns true when `node` is a top-level `"use typeshade";` statement.
 *
 * Accepts both single- and double-quoted string literals. Does not accept
 * template literals or concatenated expressions.
 */
export function isUseTypeshadeDirective(node: ts.Node): boolean {
  if (!ts.isExpressionStatement(node)) return false
  const expr = node.expression
  if (!ts.isStringLiteral(expr)) return false
  return expr.text === USE_TYPESHADE
}

/**
 * Scan the top-level statements of a SourceFile and return the first
 * `"use typeshade";` directive, or `undefined` if none is present.
 *
 * Only direct children of the SourceFile are examined (no nested scopes).
 */
export function findUseTypeshadeDirective(
  sourceFile: ts.SourceFile,
): ts.ExpressionStatement | undefined {
  for (const stmt of sourceFile.statements) {
    if (isUseTypeshadeDirective(stmt)) {
      return stmt as ts.ExpressionStatement
    }
  }
  return undefined
}

/**
 * True when the SourceFile contains at least one top-level `"use typeshade";`.
 */
export function hasUseTypeshadeDirective(sourceFile: ts.SourceFile): boolean {
  return findUseTypeshadeDirective(sourceFile) !== undefined
}
