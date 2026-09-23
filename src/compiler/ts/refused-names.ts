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
// ERROR already stands inside the declaration the name resolves to, or inside a declaration
// that one reads, whose refusal is then the reason it could not be lowered either. That is
// checked, not assumed, so a path that dropped a name without saying why still reports every
// use of it — the silent version of this bug would be a statement quietly missing from a
// function whose module then compiled.
//
// Which declaration a name resolves to follows TypeScript's own lexical rule: the innermost
// enclosing block, loop header or parameter list that declares it before the use, a `var`
// anywhere in the function around it, then the file's top level, where order does not matter. A
// name declared by a `let` or `const` in a sibling block, or read before its declaration in the
// same block, is not found, and stays "Unknown identifier".

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';

/** A half-open `[start, end)` UTF-16 range in the file. */
interface Range {
  readonly start: number;
  readonly end: number;
}

const rangeOf = (node: ts.Node, sourceFile: ts.SourceFile): Range => ({
  start: node.getStart(sourceFile),
  end: node.getEnd(),
});

/** Whether a binding names `name`: the name itself, or one a destructuring pattern binds, which
 *  is a declaration of the name as much as a plain one (`const { t } = frame`). */
function binds(pattern: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(pattern)) return pattern.text === name;
  return pattern.elements.some((e) => !ts.isOmittedExpression(e) && binds(e.name, name));
}

/** The statement that declares `name` among `statements`, when one does. With `before` set,
 *  only a statement that ends before it counts (a block's `let` and `const` are not visible
 *  above their declaration). */
function declaringStatement(
  statements: readonly ts.Statement[],
  name: string,
  before?: number,
): ts.VariableStatement | undefined {
  for (const s of statements) {
    if (before !== undefined && s.getEnd() > before) continue;
    if (!ts.isVariableStatement(s)) continue;
    if (s.declarationList.declarations.some((d) => binds(d.name, name))) return s;
  }
  return undefined;
}

function declaringList(
  list: ts.ForInitializer | undefined,
  name: string,
): ts.VariableDeclarationList | undefined {
  if (list === undefined || !ts.isVariableDeclarationList(list)) return undefined;
  return list.declarations.some((d) => binds(d.name, name)) ? list : undefined;
}

/** The `var` statement that declares `name` anywhere in a function's body, outside the
 *  functions nested in it: a `var` is visible in the whole function, as TypeScript scopes it,
 *  and not only in the block it is written in. The front end refuses it and lowers it as the
 *  `let` it would have been (Rule 12.4), so a read outside that block finds nothing to bind. */
function declaringVar(body: ts.Node, name: string): ts.VariableStatement | undefined {
  let found: ts.VariableStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (
      ts.isVariableStatement(node) &&
      (node.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0 &&
      node.declarationList.declarations.some((d) => binds(d.name, name))
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** The declaration of `name` visible at `use`, innermost scope first: the statement or loop
 *  header that declares it, the parameter, or a `var` anywhere in the function. */
function visibleDeclaration(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): ts.Node | undefined {
  const at = use.getStart(sourceFile);
  for (let p: ts.Node | undefined = use.parent; p !== undefined; p = p.parent) {
    let found: ts.Node | undefined;
    if (ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      found = declaringStatement(p.statements, name, at);
    } else if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) {
      found = declaringList(p.initializer, name);
    } else if (ts.isFunctionLike(p)) {
      found =
        p.parameters.find((q) => binds(q.name, name)) ??
        ('body' in p && p.body !== undefined ? declaringVar(p.body, name) : undefined);
    } else if (ts.isSourceFile(p)) {
      found = declaringStatement(p.statements, name);
    }
    if (found !== undefined) return found;
  }
  return undefined;
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
  );

/** Every name `declaration`'s initializers read: an identifier in a value position, which is
 *  not a member name after a dot, a property key or a name the declaration binds. */
function namesRead(declaration: ts.Node): ts.Identifier[] {
  const initializers = ts.isVariableStatement(declaration)
    ? declaration.declarationList.declarations.map((d) => d.initializer)
    : ts.isVariableDeclarationList(declaration)
      ? declaration.declarations.map((d) => d.initializer)
      : ts.isParameter(declaration)
        ? [declaration.initializer]
        : [];
  const out: ts.Identifier[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isName) out.push(node);
      return;
    }
    if (ts.isTypeNode(node)) return;
    ts.forEachChild(node, visit);
  };
  for (const initializer of initializers) if (initializer !== undefined) visit(initializer);
  return out;
}

/** Every type name `node` writes: `G` in `G<f32>` and in `uniform<G<f32>>`. */
function typeNames(node: ts.Node, out: string[] = []): string[] {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) out.push(node.typeName.text);
  ts.forEachChild(node, (child) => void typeNames(child, out));
  return out;
}

/** Every type name `declaration`'s annotations write: `G` in `const v: G<f32>`. */
function typesNamed(declaration: ts.Node): string[] {
  const annotations = ts.isVariableStatement(declaration)
    ? declaration.declarationList.declarations.map((d) => d.type)
    : ts.isVariableDeclarationList(declaration)
      ? declaration.declarations.map((d) => d.type)
      : ts.isParameter(declaration)
        ? [declaration.type]
        : [];
  return annotations.flatMap((a) => (a === undefined ? [] : typeNames(a)));
}

/** Whether the interface or type alias the file declares as `name` holds an error, or is an
 *  alias of one that does (`type GF = G<f32>`): the front end refused it at its declaration (a
 *  generic one, whose sentence names the class to write, or a contract), and it maps to no type
 *  where it is named, which says nothing there. */
function typeRefused(
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
  seen: Set<string> = new Set(),
): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  return sourceFile.statements.some(
    (s) =>
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
      s.name.text === name &&
      (hasErrorWithin(rangeOf(s, sourceFile), sourceFile, diagnostics) ||
        (ts.isTypeAliasDeclaration(s) &&
          typeNames(s.type).some((n) => typeRefused(n, sourceFile, diagnostics, seen)))),
  );
}

/**
 * Whether `declaration` was refused and said why: an error stands inside it, it names a type
 * whose declaration was refused and said why (`const v: G<f32>` for a generic interface `G`), or
 * it reads a name whose own declaration was refused and said why, which is then the reason this
 * one could not be lowered either. `const u = t * 2.` after a refused `const t = a * b` binds no
 * `u` and says nothing, since its read of `t` is itself one of the reads this file keeps quiet,
 * and without following it every use of `u` read "Unknown identifier" beside the one mistake in
 * `t`. `seen` ends a walk through declarations that read each other.
 */
function refusedWithReason(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
  seen: Set<ts.Node> = new Set(),
): boolean {
  if (hasErrorWithin(rangeOf(declaration, sourceFile), sourceFile, diagnostics)) return true;
  if (typesNamed(declaration).some((name) => typeRefused(name, sourceFile, diagnostics))) {
    return true;
  }
  seen.add(declaration);
  return namesRead(declaration).some((read) => {
    const source = visibleDeclaration(read, read.text, sourceFile);
    return (
      source !== undefined &&
      !seen.has(source) &&
      refusedWithReason(source, sourceFile, diagnostics, seen)
    );
  });
}

/** The statement that declares `member` in a namespace the file declares as `name`, when one
 *  does: `namespace N { export let x: f32 = 1.; }` for `N.x`. The namespace walk refuses a
 *  variable there (TS8014), and `N`, which then declares nothing a read can reach, is no value. */
function namespaceMember(
  sourceFile: ts.SourceFile,
  name: string,
  member: string,
): ts.VariableStatement | undefined {
  for (const s of sourceFile.statements) {
    if (!ts.isModuleDeclaration(s) || !ts.isIdentifier(s.name) || s.name.text !== name) continue;
    if (s.body === undefined || !ts.isModuleBlock(s.body)) continue;
    const found = declaringStatement(s.body.statements, member);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Whether a report that `name` (read at `use`) is unknown would only repeat a diagnostic that
 * already stands: either the declaration `name` resolves to was refused and said why
 * (`refusedWithReason`), or an error already covers exactly `use`'s own span (the host-API
 * refusal of `Date` is `TS8012` on the very identifier an "Unknown identifier" would name).
 */
export function unknownNameAlreadyReported(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean {
  if (hasErrorWithin(rangeOf(use, sourceFile), sourceFile, diagnostics)) return true;
  // `N.x`, where the namespace `N` declares `x` and that declaration was refused and said why.
  const access = use.parent;
  if (ts.isPropertyAccessExpression(access) && access.expression === use) {
    const member = namespaceMember(sourceFile, name, access.name.text);
    if (member !== undefined && refusedWithReason(member, sourceFile, diagnostics)) return true;
  }
  const declaration = visibleDeclaration(use, name, sourceFile);
  return declaration !== undefined && refusedWithReason(declaration, sourceFile, diagnostics);
}
