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
// enclosing block, loop header or parameter list that declares it before the use (a function
// anywhere in it), a `var` anywhere in the function around it, then the file's top level, where
// order does not matter. A name declared by a `let` or `const` in a sibling block, or read before
// its declaration in the same block, is not found, and stays "Unknown identifier". A function
// and a class are declarations too: `const y = h(a)` reads `h`, and when `h` was refused (an
// async function, a signature that names a refused type) so is `y`.

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

/** The statement that declares `name` among `statements`, when one does: a variable, a class or
 *  a function. With `before` set, only a statement that ends before it counts (a block's `let`,
 *  `const` and `class` are not visible above their declaration); a function is visible in the
 *  whole block, as TypeScript hoists it. */
function declaringStatement(
  statements: readonly ts.Statement[],
  name: string,
  before?: number,
): ts.Statement | undefined {
  for (const s of statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s;
    if (before !== undefined && s.getEnd() > before) continue;
    if (ts.isClassDeclaration(s) && s.name?.text === name) return s;
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

/** The class or the import that declares `name` among `statements`: a `new` reads a class, whose
 *  constructor may be refused where it is written, and an import is a declaration of the file's
 *  top level, which a multi-file program refuses when it names no function (on the name) or
 *  resolves to no file (on the whole import), so the whole import is the declaration. */
function declaringClassOrImport(
  statements: readonly ts.Statement[],
  name: string,
): ts.Node | undefined {
  for (const s of statements) {
    if (ts.isClassDeclaration(s) && s.name?.text === name) return s;
    const bindings = ts.isImportDeclaration(s) ? s.importClause?.namedBindings : undefined;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    if (bindings.elements.some((el) => el.name.text === name)) return s;
  }
  return undefined;
}

/** The declaration of `name` visible at `use`, innermost scope first: the statement or loop
 *  header that declares it, the parameter, a `var` anywhere in the function, the class, or the
 *  import. */
function visibleDeclaration(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
): ts.Node | undefined {
  const at = use.getStart(sourceFile);
  for (let p: ts.Node | undefined = use.parent; p !== undefined; p = p.parent) {
    let found: ts.Node | undefined;
    if (ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      found =
        declaringStatement(p.statements, name, at) ?? declaringClassOrImport(p.statements, name);
    } else if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)) {
      found = declaringList(p.initializer, name);
    } else if (ts.isFunctionLike(p)) {
      found =
        p.parameters.find((q) => binds(q.name, name)) ??
        ('body' in p && p.body !== undefined ? declaringVar(p.body, name) : undefined);
    } else if (ts.isSourceFile(p)) {
      found = declaringStatement(p.statements, name) ?? declaringClassOrImport(p.statements, name);
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

/** Every name `declaration`'s initializers read, or a class's `extends` clause (the mixin it
 *  applies): an identifier in a value position, which is not a member name after a dot, a
 *  property key or a name the declaration binds. */
function namesRead(declaration: ts.Node): ts.Identifier[] {
  const initializers = ts.isVariableStatement(declaration)
    ? declaration.declarationList.declarations.map((d) => d.initializer)
    : ts.isVariableDeclarationList(declaration)
      ? declaration.declarations.map((d) => d.initializer)
      : ts.isParameter(declaration)
        ? [declaration.initializer]
        : ts.isClassDeclaration(declaration)
          ? (declaration.heritageClauses ?? []).flatMap((h) => h.types.map((t) => t.expression))
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

/** Every type name `declaration` writes: `G` in `const v: G<f32>` and in `{ x: a } as G<f32>`;
 *  of a function, the ones its signature writes, which is what a call of it is typed by. */
function typesNamed(declaration: ts.Node): string[] {
  if (ts.isFunctionLike(declaration)) {
    return [...declaration.parameters.map((p) => p.type), declaration.type].flatMap((t) =>
      t === undefined ? [] : typeNames(t),
    );
  }
  return typeNames(declaration);
}

/** The type names the declaration of a type writes for what it holds: an alias's target, and
 *  the type of each field of an interface or a class. */
function typesHeld(declaration: ts.Statement): string[] {
  if (ts.isTypeAliasDeclaration(declaration)) return typeNames(declaration.type);
  const members: readonly ts.Node[] = ts.isInterfaceDeclaration(declaration)
    ? declaration.members.filter(ts.isPropertySignature)
    : ts.isClassDeclaration(declaration)
      ? declaration.members.filter(ts.isPropertyDeclaration)
      : [];
  return members.flatMap((m) => {
    const type = (m as ts.PropertySignature | ts.PropertyDeclaration).type;
    return type === undefined ? [] : typeNames(type);
  });
}

/** Whether the interface, type alias or class the file declares as `name` holds an error, or
 *  holds a type that does (`type GF = G<f32>`, a field `g: G<f32>`): the front end refused it
 *  at its declaration (a generic one, whose sentence names the class to write, or a contract),
 *  or withheld what it holds, and it maps to no type where it is named, which says nothing
 *  there. */
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
      (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isClassDeclaration(s)) &&
      s.name?.text === name &&
      (hasErrorWithin(rangeOf(s, sourceFile), sourceFile, diagnostics) ||
        typesHeld(s).some((n) => typeRefused(n, sourceFile, diagnostics, seen))),
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
    const source =
      namespaceMemberAt(read, sourceFile) ?? visibleDeclaration(read, read.text, sourceFile);
    return (
      source !== undefined &&
      !seen.has(source) &&
      refusedWithReason(source, sourceFile, diagnostics, seen)
    );
  });
}

/** The statements of each namespace named `name` among `statements`: its block's, or the one
 *  nested declaration `namespace A.B` stands for. */
function namespaceBodies(statements: readonly ts.Statement[], name: string): ts.Statement[][] {
  const out: ts.Statement[][] = [];
  for (const s of statements) {
    if (!ts.isModuleDeclaration(s) || !ts.isIdentifier(s.name) || s.name.text !== name) continue;
    if (s.body !== undefined && ts.isModuleBlock(s.body)) out.push([...s.body.statements]);
    else if (s.body !== undefined && ts.isModuleDeclaration(s.body)) out.push([s.body]);
  }
  return out;
}

/** The statement that declares what `use` reaches through the namespaces the file declares,
 *  when `use` names one: `namespace N { export let x: f32 = 1.; }` for `N.x`, and the same
 *  through `N.M.x`. The namespace walk refuses a variable there (TS8014), and `N`, which then
 *  declares nothing a read can reach, is no value; a function there is reached the same way. */
function namespaceMemberAt(use: ts.Node, sourceFile: ts.SourceFile): ts.Statement | undefined {
  if (!ts.isIdentifier(use)) return undefined;
  let bodies = namespaceBodies(sourceFile.statements, use.text);
  for (let at: ts.Node = use; bodies.length > 0;) {
    const access = at.parent;
    if (!ts.isPropertyAccessExpression(access) || access.expression !== at) return undefined;
    const member = access.name.text;
    const inner = bodies.flatMap((b) => namespaceBodies(b, member));
    if (inner.length > 0) {
      bodies = inner;
      at = access;
      continue;
    }
    for (const b of bodies) {
      const found = declaringStatement(b, member);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return undefined;
}

/** Whether `C.K` reads a static field the class `owner` declares whose declaration holds an
 *  error: a list refused for its spread, `static K = [...A, 3.]`. The field was refused where
 *  it is written, and a read of it adds nothing (Rule 12.4). `owner` is the class's name as the
 *  module flattens it, `N_C` inside a namespace. */
export function staticFieldRefused(
  owner: string,
  member: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean {
  let found = false;
  const walk = (statements: readonly ts.Statement[], prefix: string): void => {
    for (const s of statements) {
      if (ts.isModuleDeclaration(s) && ts.isIdentifier(s.name)) {
        const inner = prefix === '' ? s.name.text : `${prefix}_${s.name.text}`;
        if (s.body !== undefined && ts.isModuleBlock(s.body)) walk(s.body.statements, inner);
        else if (s.body !== undefined && ts.isModuleDeclaration(s.body)) walk([s.body], inner);
        continue;
      }
      if (!ts.isClassDeclaration(s) || s.name === undefined) continue;
      if ((prefix === '' ? s.name.text : `${prefix}_${s.name.text}`) !== owner) continue;
      found ||= s.members.some(
        (m) =>
          ts.isPropertyDeclaration(m) &&
          m.name.getText(sourceFile) === member &&
          (ts.getModifiers(m)?.some((k) => k.kind === ts.SyntaxKind.StaticKeyword) ?? false) &&
          hasErrorWithin(rangeOf(m, sourceFile), sourceFile, diagnostics),
      );
    }
  };
  walk(sourceFile.statements, '');
  return found;
}

/**
 * Whether a report that `name` (read at `use`) is unknown would only repeat a diagnostic that
 * already stands: either the declaration `name` resolves to was refused and said why
 * (`refusedWithReason`), or an error already covers exactly `use`'s own span, where another
 * check refused the very identifier an "Unknown identifier" would name.
 */
export function unknownNameAlreadyReported(
  use: ts.Node,
  name: string,
  sourceFile: ts.SourceFile,
  diagnostics: readonly TsCompilerDiagnostic[],
): boolean {
  if (hasErrorWithin(rangeOf(use, sourceFile), sourceFile, diagnostics)) return true;
  // `N.x`, where the namespace `N` declares `x` and that declaration was refused and said why.
  const member = namespaceMemberAt(use, sourceFile);
  if (member !== undefined && refusedWithReason(member, sourceFile, diagnostics)) return true;
  const declaration = visibleDeclaration(use, name, sourceFile);
  return declaration !== undefined && refusedWithReason(declaration, sourceFile, diagnostics);
}
