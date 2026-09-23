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
// enclosing block, loop header or parameter list that declares it before the use, then the
// file's top level, where order does not matter. A name declared in a sibling block, or read
// before its declaration in the same block, is not found, and stays "Unknown identifier".

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

/** The declaration of `name` visible at `use`, innermost scope first: the statement or loop
 *  header that declares it, or the parameter. */
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
      found = p.parameters.find((q) => binds(q.name, name));
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

/**
 * Whether `declaration` was refused and said why: an error stands inside it, or it reads a name
 * whose own declaration was refused and said why, which is then the reason this one could not
 * be lowered either. `const u = t * 2.` after a refused `const t = a * b` binds no `u` and says
 * nothing, since its read of `t` is itself one of the reads this file keeps quiet, and without
 * following it every use of `u` read "Unknown identifier" beside the one mistake in `t`.
 * `seen` ends a walk through declarations that read each other.
 */
function refusedWithReason(
  declaration: ts.Node,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
  seen: Set<ts.Node> = new Set(),
): boolean {
  if (hasErrorWithin(rangeOf(declaration, sourceFile), sourceFile, diagnostics)) return true;
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
  const declaration = visibleDeclaration(use, name, sourceFile);
  return declaration !== undefined && refusedWithReason(declaration, sourceFile, diagnostics);
}
