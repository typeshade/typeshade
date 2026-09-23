// ═══ Explicit semicolons for TypeShade source ═══
//
// TypeShade source is TypeScript, so a statement without its `;` still parses: automatic
// semicolon insertion (ECMA-262 §12.10) ends it at the line break. The shader source this
// repository ships (the examples, the `"use typeshade"` blocks in the docs, the inline sources
// in the tests) writes every `;` anyway, the way the guide spells `"use typeshade";`, and this
// file is the mechanical half of that convention: it writes the `;` a statement is missing.
//
// It reads the source with the same parser the compiler uses and inserts a `;` only at the end
// of a node that the grammar terminates with one and whose last token is not already `;`. A
// statement boundary is therefore exactly the one the parser chose, and the inserted `;` makes
// explicit what ASI already did: the program means the same thing before and after. Where ASI
// did NOT end a statement (a line that opens with `(`, `[` or a template continues the one
// above), nothing is inserted, so the rewrite cannot split an expression either.
//
// A source the parser reports a syntax error on is refused rather than rewritten: a node the
// parser recovered from is not a boundary worth writing down. The decorator on a top-level
// `export function` is a grammar check, not a parse error, so shader source parses cleanly.
//
// Host-side TypeScript in this repository keeps Prettier's `semi: false`; this pass is for
// shader source only (see `scripts/semicolons.ts` for the files it covers).

import ts from 'typescript';

/** The result of one pass: the rewritten text, or why the source was left alone. */
export type SemicolonResult =
  | { readonly ok: true; readonly text: string; readonly inserted: readonly number[] }
  | { readonly ok: false; readonly at: number; readonly message: string };

/** Kinds whose production ends with `;` (ASI may supply it). */
const STATEMENT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.IndexSignature,
]);

/** Members of an interface or a type literal: `,` or `;` both separate them. */
const TYPE_MEMBER_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.CallSignature,
  ts.SyntaxKind.ConstructSignature,
  ts.SyntaxKind.IndexSignature,
]);

/**
 * The offset a `;` belongs at for `node`, or `undefined` when the node already ends with its
 * terminator or does not take one.
 */
function missingSemicolonAt(node: ts.Node, sf: ts.SourceFile): number | undefined {
  const kind = node.kind;
  const parent = node.parent as ts.Node | undefined;
  const inTypeBody =
    parent !== undefined && (ts.isInterfaceDeclaration(parent) || ts.isTypeLiteralNode(parent));
  if (inTypeBody ? !TYPE_MEMBER_KINDS.has(kind) : !STATEMENT_KINDS.has(kind)) {
    // A body-less declaration (`declare function f(): f32`, an overload, an abstract method)
    // ends with `;` too; one with a body does not.
    const bodyless =
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.body === undefined;
    if (!bodyless) return undefined;
  }
  const last = node.getLastToken(sf);
  if (last === undefined) return undefined;
  if (last.kind === ts.SyntaxKind.SemicolonToken) return undefined;
  if (inTypeBody) {
    // A member separated by `,` has its terminator already, and a one-line body
    // (`{ view: mat4, pos: vec3 }`) closes its last member with the `}`. A member that ends
    // its line is the one ASI ended.
    if (last.kind === ts.SyntaxKind.CommaToken) return undefined;
    const next = sf.text
      .slice(node.getEnd())
      .match(/^[ \t]*(\/\/[^\n]*|\/\*[^]*?\*\/[ \t]*)?(\r?\n)?/);
    if (!next?.[2]) return undefined;
  }
  return node.getEnd();
}

/**
 * Insert every `;` the source leaves to ASI. `fileName` only picks the parser's script kind
 * (`.tsx` parses JSX). A source with a syntax error comes back as the offset and text of the
 * first one, unchanged.
 */
export function insertSemicolons(source: string, fileName = 'source.ts'): SemicolonResult {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const parseErrors = (sf as unknown as { parseDiagnostics: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if (parseErrors.length > 0) {
    const d = parseErrors[0]!;
    return {
      ok: false,
      at: d.start ?? 0,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    };
  }
  const at: number[] = [];
  const visit = (node: ts.Node): void => {
    const pos = missingSemicolonAt(node, sf);
    if (pos !== undefined) at.push(pos);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // Two nodes can end at one offset only when one of them is not a statement the other holds
  // (an `if` whose body is a bare statement is not in the list), but one `;` is all it takes.
  const unique = [...new Set(at)].sort((a, b) => a - b);
  let text = '';
  let from = 0;
  for (const pos of unique) {
    text += source.slice(from, pos) + ';';
    from = pos;
  }
  text += source.slice(from);
  return { ok: true, text, inserted: unique };
}
