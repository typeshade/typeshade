// === `namespace` (roadmap 0.3 item T4, design #92, §26) ===
//
// A namespace is a named group of functions and constants, which is a shape the module already
// has: the members flatten to `Ns_member`, the same joining a class's method (`Ray_at`) and a
// class's static field (`K_PI`) already take. Nesting flattens transitively, so a member of
// `namespace A { export namespace B { ... } }` is `A_B_member`.
//
// What a namespace holds is what the module can hold: functions, constants, classes (#107) and
// more namespaces. A variable, an enum or a type inside one is refused with the reason, because
// each of those already has a module-level home and giving it a second one would mean two
// spellings of one thing. A statement that declares nothing is told to move into a function, as
// it is at the top level.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';

/** The joining every flattened member takes: `Palette.warm` is `Palette_warm`. */
export const namespaceMemberName = (prefix: string, member: string): string =>
  `${prefix}_${member}`;

/** What a namespace declares, for the sentence that refuses anything else in one. */
const NAMESPACE_HOLDS = 'a namespace holds functions, constants, classes and namespaces';

/** One statement found inside a namespace, with the prefix its emitted name takes. */
export interface NamespaceMember<T extends ts.Statement> {
  readonly prefix: string;
  readonly node: T;
}

/** The namespace's own name, or undefined for a shape this surface does not take: a string
 *  name (`namespace "a.b"`), a `declare` namespace, or a body that is not a block. */
function namespaceName(stmt: ts.ModuleDeclaration): string | undefined {
  if (!ts.isIdentifier(stmt.name)) return undefined;
  return stmt.name.text;
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
      see(stmt, prefix);
      continue;
    }
    const name = namespaceName(stmt);
    if (name === undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          stmt.name,
          `A namespace is declared with a plain name, "namespace Palette { ... }".`,
          TS_CODES.TOP_LEVEL,
        ),
      );
      continue;
    }
    if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          stmt.name,
          `"declare namespace ${name}" has no members to emit; declare the namespace in this file.`,
          TS_CODES.TOP_LEVEL,
        ),
      );
      continue;
    }
    const inner = prefix === '' ? name : namespaceMemberName(prefix, name);
    const body = stmt.body;
    if (body === undefined) continue;
    if (!ts.isModuleBlock(body)) {
      // `namespace A.B { ... }` parses as a namespace whose body is the next one; both
      // spellings reach the same flattening.
      if (ts.isModuleDeclaration(body)) {
        eachNamespaceStatement([body], sourceFile, diagnostics, see, inner);
      }
      continue;
    }
    eachNamespaceStatement(body.statements, sourceFile, diagnostics, see, inner);
  }
}

/** The sentence for a statement that declares nothing, where a file or a namespace declares
 *  things: `where` is "at the top level" or `inside "N"`, and `holds` what that place declares.
 *  The statement is named by the keyword it is written with (Rule 12.1), not by TypeScript's name
 *  for the node, `IfStatement` (or `LastStatement` for a `debugger`), which is no word the author
 *  wrote. One a function body runs is told to move there; one a body refuses too says only why
 *  it is refused here. */
export function statementRefusal(
  stmt: ts.Statement,
  sourceFile: ts.SourceFile,
  where: string,
  holds: string,
): string {
  const written = stmt.getText(sourceFile).replace(/\s+/g, ' ').replace(/;$/, '');
  const shown = written.length <= 60 ? written : `${written.slice(0, 60)}…`;
  const runs = (what: string, fix = ' Move it into a function.'): string =>
    `${what} ${where} runs nowhere; ${holds}.${fix}`;
  switch (stmt.kind) {
    case ts.SyntaxKind.ExpressionStatement:
      return runs(`"${shown}"`);
    case ts.SyntaxKind.IfStatement:
      return runs('An "if" statement');
    case ts.SyntaxKind.SwitchStatement:
      return runs('A "switch" statement');
    case ts.SyntaxKind.ForStatement:
      return runs('A "for" loop');
    case ts.SyntaxKind.ForOfStatement:
      return runs('A "for…of" loop');
    case ts.SyntaxKind.WhileStatement:
      return runs('A "while" loop');
    case ts.SyntaxKind.Block:
      return runs('A block, "{ … }",');
    case ts.SyntaxKind.ReturnStatement:
      return runs('A "return" statement');
    case ts.SyntaxKind.DoStatement:
      return runs('A "do…while" loop', '');
    case ts.SyntaxKind.ForInStatement:
      return runs('A "for…in" loop', '');
    case ts.SyntaxKind.TryStatement:
      return runs('A "try" statement', '');
    case ts.SyntaxKind.ThrowStatement:
      return runs('A "throw" statement', '');
    case ts.SyntaxKind.BreakStatement:
      return runs('A "break" statement', '');
    case ts.SyntaxKind.ContinueStatement:
      return runs('A "continue" statement', '');
    case ts.SyntaxKind.LabeledStatement:
      return runs(`A labelled statement, "${(stmt as ts.LabeledStatement).label.text}:",`, '');
    case ts.SyntaxKind.DebuggerStatement:
      return runs('A "debugger" statement', ' Remove it.');
    case ts.SyntaxKind.EmptyStatement:
      return runs('An empty statement, ";",', ' Remove it.');
  }
  if (ts.isImportEqualsDeclaration(stmt)) {
    const ref = stmt.moduleReference;
    return ts.isExternalModuleReference(ref)
      ? `"${shown}" is a CommonJS import; a shader file imports each function by name, ` +
          `import { f } from ${ref.expression.getText(sourceFile)}.`
      : `"${shown}" is an import alias; a shader file names "${ref.getText(sourceFile)}" ` +
          `where it reads it.`;
  }
  return `"${shown}" has no place ${where}; ${holds}.`;
}

/** Reports a statement a namespace cannot hold. Called by the collectors, each of which knows
 *  which statements are its own. */
export function refuseNamespaceStatement(
  stmt: ts.Statement,
  prefix: string,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  // semantic.ts refuses a `try`, a `throw` and a `for…in` wherever they stand, in both compile
  // paths, and that sentence is the one (Rule 12.4).
  if (ts.isTryStatement(stmt) || ts.isThrowStatement(stmt) || ts.isForInStatement(stmt)) return;
  const what = ts.isClassDeclaration(stmt)
    ? 'a class'
    : ts.isEnumDeclaration(stmt)
      ? 'an enum'
      : ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)
        ? 'a type'
        : ts.isVariableStatement(stmt)
          ? 'a variable'
          : undefined;
  // A statement that declares nothing is named by its keyword, as at the top level, and told to
  // move into a function: the top level of the file would refuse it too. Its namespace is
  // written as the author writes it, `A.B`, not flattened.
  const written: string[] = [];
  for (let at: ts.Node | undefined = stmt.parent; at !== undefined; at = at.parent) {
    if (ts.isModuleDeclaration(at)) written.unshift(at.name.text);
  }
  diagnostics.push(
    makeDiagnostic(
      sourceFile,
      stmt,
      what === undefined
        ? statementRefusal(stmt, sourceFile, `inside "${written.join('.')}"`, NAMESPACE_HOLDS)
        : `A namespace holds functions, constants, classes and namespaces; ${what} inside ` +
            `"${prefix}" has no flattened form. Declare it at the top level of the file.`,
      TS_CODES.TOP_LEVEL,
    ),
  );
}
